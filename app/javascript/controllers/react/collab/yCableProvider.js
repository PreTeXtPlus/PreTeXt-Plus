import { createConsumer } from "@rails/actioncable";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { seedDocFromState } from "@pretextbook/web-editor";

/**
 * Yjs provider over ActionCable + the project-doc HTTP endpoints.
 *
 * Transport model: every document update a client makes is POSTed over the
 * cable (`doc_update`), which the server appends to `project_doc_updates` and
 * relays to all subscribers. A joining (or reconnecting) client fetches
 * `GET /projects/:id/doc` — the last compacted snapshot plus all appended
 * updates — and applies everything; CRDT merges are idempotent and
 * commutative, so overlap with live traffic is harmless. Awareness (cursors,
 * names) relays over the same channel but is never persisted.
 *
 * First-time seeding is a compare-and-set: the client builds the doc from the
 * project JSON it already loaded and POSTs it to `doc/seed`; the server
 * accepts exactly one seed per project (409 for the losers, who then fetch
 * the winner's state). This is what prevents the classic two-clients-seed-
 * independently duplication.
 *
 * Compaction: the leader (lowest awareness clientID) periodically PUTs the
 * full doc state with the highest update id it has incorporated; the server
 * swaps the snapshot and deletes only rows up to that id.
 *
 * @typedef {Object} ProviderConfig
 * @property {string} projectId
 * @property {string} [csrfToken]
 * @property {{name: string, color: string}} user
 */

const AWARENESS_HEARTBEAT_MS = 15000; // y-protocols expires peers after 30s
const COMPACTION_INTERVAL_MS = 60000;
const COMPACTION_MIN_UPDATES = 20;

export class YCableProvider {
  /** @param {ProviderConfig} config */
  constructor({ projectId, csrfToken, user }) {
    this.projectId = projectId;
    this.csrfToken = csrfToken;
    this.user = user;
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
    // Per-tab identity for filtering our own cable echoes (we still read the
    // row `id` off them for compaction bookkeeping). Not crypto.randomUUID:
    // that's secure-context-only, and dev/test servers run plain HTTP.
    this.sender = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    this.maxUpdateId = 0;
    this.updatesSinceCompaction = 0;
    this.ready = false;
    this.destroyed = false;
    this.hasConnectedOnce = false;
    /** @type {Array<{type: string, payload: string, id?: number, sender?: string}>} */
    this.buffered = [];
    this.consumer = null;
    this.subscription = null;
    this.intervals = [];
  }

  /**
   * Join the session. `seedStateFactory` builds the CollabDocState from the
   * already-loaded project JSON, used only when this client wins the seed race.
   * Resolves when the doc holds the current server state and live sync is on.
   * @param {() => import("@pretextbook/web-editor").CollabDocState} seedStateFactory
   * @returns {Promise<void>}
   */
  async connect(seedStateFactory) {
    // Outbound: every local transaction (Monaco binding, bridge, docinfo...)
    // goes to the server. Applies *by this provider* (snapshot, seed echo,
    // remote updates) carry `this` as origin and stay local.
    this.doc.on("update", (update, origin) => {
      if (origin === this || this.destroyed) return;
      this.perform("doc_update", { payload: toBase64(update) });
    });

    this.awareness.on("update", ({ added, updated, removed }, origin) => {
      if (origin === this || this.destroyed) return;
      const changed = [...added, ...updated, ...removed];
      if (!changed.includes(this.awareness.clientID)) return;
      this.perform("awareness", {
        payload: toBase64(
          encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]),
        ),
      });
    });

    // Subscribe first and buffer, so nothing broadcast between our state
    // fetch and the subscription confirmation is lost.
    await this.subscribe();
    await this.loadOrSeed(seedStateFactory);
    this.ready = true;
    for (const message of this.buffered.splice(0)) this.receive(message);

    // Presence heartbeat: rebroadcast our state so peers' 30s expiry never
    // fires while we're alive (awareness is unpersisted, so newcomers learn
    // about us from this too).
    this.intervals.push(
      setInterval(() => {
        this.perform("awareness", {
          payload: toBase64(
            encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]),
          ),
        });
      }, AWARENESS_HEARTBEAT_MS),
    );

    this.intervals.push(
      setInterval(() => this.maybeCompact(), COMPACTION_INTERVAL_MS),
    );

    // Best-effort presence cleanup; if it doesn't get out, peers expire us
    // after the awareness timeout anyway.
    this.onPageHide = () => {
      removeAwarenessStates(this.awareness, [this.awareness.clientID], "pagehide");
    };
    window.addEventListener("pagehide", this.onPageHide);
  }

  /** True when this client should run session-wide chores (autosave, compaction). */
  isLeader() {
    let min = this.awareness.clientID;
    this.awareness.getStates().forEach((_state, clientId) => {
      if (clientId < min) min = clientId;
    });
    return min === this.awareness.clientID;
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener("pagehide", this.onPageHide ?? (() => {}));
    this.intervals.forEach(clearInterval);
    this.intervals = [];
    removeAwarenessStates(this.awareness, [this.awareness.clientID], "destroy");
    this.subscription?.unsubscribe();
    this.consumer?.disconnect();
    this.awareness.destroy();
    this.doc.destroy();
  }

  // ── Cable plumbing ─────────────────────────────────────────────────────────

  subscribe() {
    return new Promise((resolve, reject) => {
      this.consumer = createConsumer();
      let settled = false;
      this.subscription = this.consumer.subscriptions.create(
        { channel: "ProjectDocChannel", project_id: this.projectId },
        {
          connected: () => {
            if (!settled) {
              settled = true;
              this.hasConnectedOnce = true;
              resolve();
              return;
            }
            // Reconnected after a drop: re-fetch the persisted state to close
            // the gap (idempotent to apply over live traffic).
            this.fetchAndApply().catch((error) =>
              console.error("Failed to resync collaborative doc:", error),
            );
          },
          rejected: () => {
            if (!settled) {
              settled = true;
              reject(new Error("Collaboration subscription rejected"));
            }
          },
          received: (message) => {
            if (!this.ready) {
              this.buffered.push(message);
              return;
            }
            this.receive(message);
          },
        },
      );
    });
  }

  perform(action, data) {
    this.subscription?.perform(action, { ...data, sender: this.sender });
  }

  receive(message) {
    if (message.type === "update") {
      if (typeof message.id === "number" && message.id > this.maxUpdateId) {
        this.maxUpdateId = message.id;
        this.updatesSinceCompaction += 1;
      }
      if (message.sender !== this.sender) {
        Y.applyUpdate(this.doc, fromBase64(message.payload), this);
      }
    } else if (message.type === "awareness") {
      if (message.sender !== this.sender) {
        applyAwarenessUpdate(this.awareness, fromBase64(message.payload), this);
      }
    }
  }

  // ── HTTP persistence ───────────────────────────────────────────────────────

  get docUrl() {
    return `/projects/${this.projectId}/doc`;
  }

  async loadOrSeed(seedStateFactory) {
    const info = await this.fetchDocInfo();
    if (info.seeded) {
      this.applyDocInfo(info);
      return;
    }

    // Build the seed in a scratch doc so a lost race leaves this.doc pristine.
    const seedDoc = new Y.Doc();
    seedDocFromState(seedDoc, seedStateFactory());
    const seedUpdate = Y.encodeStateAsUpdate(seedDoc);
    seedDoc.destroy();

    const res = await fetch(`${this.docUrl}/seed`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ snapshot: toBase64(seedUpdate) }),
    });
    if (res.status === 201) {
      Y.applyUpdate(this.doc, seedUpdate, this);
    } else if (res.status === 409) {
      // Another client seeded first; adopt its state.
      this.applyDocInfo(await this.fetchDocInfo());
    } else {
      throw new Error(`Seeding collaborative doc failed: ${res.status}`);
    }
  }

  async fetchDocInfo() {
    const res = await fetch(this.docUrl, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Failed to load collaborative doc: ${res.status}`);
    return res.json();
  }

  applyDocInfo(info) {
    if (info.snapshot) {
      Y.applyUpdate(this.doc, fromBase64(info.snapshot), this);
    }
    for (const update of info.updates ?? []) {
      Y.applyUpdate(this.doc, fromBase64(update.payload), this);
      if (update.id > this.maxUpdateId) {
        this.maxUpdateId = update.id;
        this.updatesSinceCompaction += 1;
      }
    }
  }

  async fetchAndApply() {
    this.applyDocInfo(await this.fetchDocInfo());
  }

  async maybeCompact() {
    if (this.destroyed || !this.isLeader()) return;
    if (this.updatesSinceCompaction < COMPACTION_MIN_UPDATES) return;
    const throughId = this.maxUpdateId;
    const snapshot = toBase64(Y.encodeStateAsUpdate(this.doc));
    const res = await fetch(this.docUrl, {
      method: "PUT",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ snapshot, through_update_id: throughId }),
    }).catch(() => null);
    if (res?.ok) this.updatesSinceCompaction = 0;
  }

  jsonHeaders() {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-CSRF-Token": this.csrfToken,
    };
  }
}

const toBase64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (encoded) =>
  Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
