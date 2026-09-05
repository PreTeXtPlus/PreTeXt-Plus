import { createConsumer } from "@rails/actioncable";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { seedDocFromState } from "@pretextbook/web-editor";
import { reportCollabIncident } from "./reportIncident";

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
 * Relay watchdog: the channel broadcasts to every subscriber *including the
 * sender*, so this client's own awareness heartbeat comes back to it every
 * AWARENESS_HEARTBEAT_MS. That makes inbound traffic a liveness signal for the
 * whole relay even in a session of one, and its absence the one symptom that
 * distinguishes "nobody is typing" from "broadcasts are going nowhere" -- the
 * August 2026 outage, where solid_cable's listener thread had died in a Puma
 * worker and every HTTP request kept succeeding. See `startWatchdog`.
 *
 * @typedef {Object} ProviderConfig
 * @property {string} projectId
 * @property {string} [csrfToken]
 * @property {{name: string, color: string}} user
 * @property {(status: "ready"|"stalled") => void} [onRelayStatusChange]
 */

const AWARENESS_HEARTBEAT_MS = 15000; // y-protocols expires peers after 30s
const COMPACTION_INTERVAL_MS = 60000;
const COMPACTION_MIN_UPDATES = 20;
// How often the watchdog looks, and how much silence it takes to call the relay
// stalled. Two and a half missed heartbeats: long enough that one dropped
// message or a slow poll is not an incident, short enough that a user is still
// looking at the screen when the banner appears.
const RELAY_WATCHDOG_MS = 10000;
const RELAY_SILENCE_MS = AWARENESS_HEARTBEAT_MS * 2.5;

export class YCableProvider {
  /** @param {ProviderConfig} config */
  constructor({ projectId, csrfToken, user, onRelayStatusChange }) {
    this.projectId = projectId;
    this.csrfToken = csrfToken;
    this.user = user;
    this.onRelayStatusChange = onRelayStatusChange ?? (() => {});
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
    // Coalescing state for scheduleResync.
    this.resyncInFlight = false;
    this.resyncQueued = false;
    /** @type {Array<{type: string, payload: string, id?: number, sender?: string}>} */
    this.buffered = [];
    this.consumer = null;
    this.subscription = null;
    this.intervals = [];
    // Watchdog state. `relayStatus` is "ready" until proven otherwise, so a
    // session that never stalls never mentions the relay to anyone.
    this.relayStatus = "ready";
    this.lastInboundAt = 0;
    this.stalledSince = null;
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

    this.startWatchdog();

    // Best-effort presence cleanup; if it doesn't get out, peers expire us
    // after the awareness timeout anyway.
    this.onPageHide = () => {
      removeAwarenessStates(this.awareness, [this.awareness.clientID], "pagehide");
    };
    window.addEventListener("pagehide", this.onPageHide);
  }

  // ── Relay watchdog ─────────────────────────────────────────────────────────

  /**
   * Watches for the relay going quiet, and keeps the session usable when it
   * does.
   *
   * The signal is plain silence. Our own awareness heartbeat is echoed back to
   * us by the channel every AWARENESS_HEARTBEAT_MS, so a healthy relay cannot be
   * quiet for RELAY_SILENCE_MS no matter how idle the humans are; a quiet relay
   * is a broken one. That is what makes this catch the failure that HTTP checks
   * cannot see, in a session of one as readily as in a session of five.
   *
   * While stalled it re-fetches over HTTP on every tick. This is not just
   * bookkeeping: when the relay dies the way it died in August, the *broadcast*
   * leg is what's gone -- `doc_update` still reaches the server and is still
   * appended to `project_doc_updates` -- so peers' edits are all still there to
   * be read. Polling turns a silently diverging session into a slow one.
   * @returns {void}
   */
  startWatchdog() {
    this.lastInboundAt = Date.now();

    // A hidden tab has its timers throttled, our heartbeat included, so silence
    // measured across a spell in the background says nothing about the relay.
    this.onVisibilityChange = () => {
      if (document.visibilityState === "visible") this.lastInboundAt = Date.now();
    };
    document.addEventListener("visibilitychange", this.onVisibilityChange);

    this.intervals.push(
      setInterval(() => this.checkRelay(), RELAY_WATCHDOG_MS),
    );
  }

  /** @returns {void} */
  checkRelay() {
    if (this.destroyed) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    const silentFor = Date.now() - this.lastInboundAt;
    if (silentFor < RELAY_SILENCE_MS) return;

    if (this.relayStatus === "ready") {
      this.relayStatus = "stalled";
      this.stalledSince = this.lastInboundAt;
      this.onRelayStatusChange("stalled");
      reportCollabIncident({
        kind: "relay_stalled",
        projectId: this.projectId,
        csrfToken: this.csrfToken,
        detail: "No cable message received since the last awareness heartbeat echo.",
        silentForSeconds: Math.round(silentFor / 1000),
      });
    }

    // Every tick while stalled, not just on the transition: this is the session's
    // only remaining path to peers' edits.
    this.scheduleResync();
  }

  /**
   * Any inbound cable message is proof the relay is delivering. Called for every
   * message, including ones buffered before the session is ready.
   * @returns {void}
   */
  noteInbound() {
    this.lastInboundAt = Date.now();
    if (this.relayStatus !== "stalled") return;

    const silentFor = this.stalledSince ? Date.now() - this.stalledSince : null;
    this.relayStatus = "ready";
    this.stalledSince = null;
    this.onRelayStatusChange("ready");
    reportCollabIncident({
      kind: "relay_recovered",
      projectId: this.projectId,
      csrfToken: this.csrfToken,
      silentForSeconds: silentFor ? Math.round(silentFor / 1000) : undefined,
    });
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
    document.removeEventListener("visibilitychange", this.onVisibilityChange ?? (() => {}));
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
            this.noteInbound();
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
    } else if (message.type === "resync") {
      // An update too large for the cable transport to carry (see
      // ProjectDocChannel::MAX_BROADCAST_BYTES). It is already persisted, so pull it
      // over HTTP. The sender already has it locally and can skip.
      if (typeof message.id === "number" && message.id > this.maxUpdateId) {
        this.maxUpdateId = message.id;
        this.updatesSinceCompaction += 1;
      }
      if (message.sender !== this.sender) this.scheduleResync();
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

  /**
   * Catch up over HTTP, coalescing concurrent requests: a burst of oversized updates
   * (a paste storm, or several peers converting divisions at once) would otherwise
   * fire one full document fetch each. A fetch already in flight may have started
   * before the newest update landed, so a resync arriving mid-flight queues exactly
   * one more pass rather than being dropped.
   * @returns {void}
   */
  scheduleResync() {
    if (this.resyncInFlight) {
      this.resyncQueued = true;
      return;
    }
    this.resyncInFlight = true;
    this.fetchAndApply()
      .catch((error) => console.error("Failed to resync collaborative doc:", error))
      .finally(() => {
        this.resyncInFlight = false;
        if (this.resyncQueued) {
          this.resyncQueued = false;
          this.scheduleResync();
        }
      });
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
