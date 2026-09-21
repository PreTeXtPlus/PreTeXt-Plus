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
 * full doc state together with the log rows that state carries; the server
 * swaps the snapshot and deletes exactly the rows it named. Which rows those
 * are has to be *known*, not inferred from an id range -- see `noteApplied`.
 *
 * Lost updates: a Yjs update that reaches nobody is not a missing keystroke, it
 * is a poisoned stream. Yjs integrates a peer's inserts in causal order, so one
 * gap parks every later insert from that peer in `doc.store.pendingStructs`,
 * unapplied -- while their deletes of text that predates the gap go on applying
 * normally (`readAndApplyDeleteSet` only defers deletes whose target item is
 * itself unknown). The visible result is an author's replacements vanishing
 * while their deletions stick, across every line they touched after the drop.
 * Three guards below, because a drop has three ways to happen:
 *
 *   * The broadcast leg drops it. solid_cable's listener polls
 *     `solid_cable_messages` with `id > last_id` and advances `last_id` as it
 *     reads; those ids come from a sequence, and a sequence value is allocated
 *     before COMMIT, so a row that commits late is passed over and delivered to
 *     nobody, ever. Every `doc_update` therefore carries a per-tab `seq`, and a
 *     peer that sees one skipped pulls the durable log over HTTP (`noteSeq`).
 *   * The send leg drops it. ActionCable's `perform` returns false and discards
 *     the message when the socket is not open, and reconnecting only ever
 *     *pulled* state. Undelivered updates are queued and flushed on reconnect
 *     (`sendDocUpdate`, `flushPendingSends`).
 *   * Compaction destroys it. The server deletes the log rows a compacting
 *     client says it has merged, so a client that claims too much erases an
 *     update for everyone. The claim is the exact set of row ids whose payloads
 *     are in the snapshot (`appliedUpdateIds`), never a range: a range has to be
 *     *inferred* to be complete, and nothing on this side can do that soundly.
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
// How many undelivered `doc_update` messages to hold before giving up on
// replaying them one by one. Past this the queue is dropped and the reconnect
// sends one full state update instead: far bigger, but a single idempotent
// message that covers every send this tab missed, however long it was off the
// air. Generous, because replaying is much the cheaper of the two.
const MAX_PENDING_SENDS = 200;
// How many merged row ids to carry before giving up on naming them exactly. A
// compacting leader clears its set every COMPACTION_INTERVAL_MS, so only a tab
// that has spent a long session never leading can approach this; past it the tab
// stops claiming anything until its next full fetch rebuilds the set, which
// costs a slightly longer update log and nothing else.
const MAX_TRACKED_UPDATE_IDS = 10000;

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
    // Monotonic per-tab counter stamped on every outbound `doc_update` and
    // echoed back by the channel. A peer reads it to tell "that tab has been
    // quiet" apart from "one of that tab's updates never arrived" -- the only
    // difference between the two, from a receiver's side, is the number it did
    // not see. See `noteSeq`.
    this.outboundSeq = 0;
    /** @type {Map<string, number>} Highest `seq` seen from each peer tab. */
    this.lastSeqBySender = new Map();
    /** @type {Array<{payload: string, seq: number}>} Sends the socket refused. */
    this.pendingSends = [];
    // Set when `pendingSends` overflowed: the queue is dropped and the next
    // flush resends the whole doc in its place.
    this.resendFullState = false;
    /**
     * The update-log rows whose payloads this client has actually applied, and
     * so the exact set it may ask the server to delete at compaction. Null once
     * it has grown past MAX_TRACKED_UPDATE_IDS, meaning "cannot name it any
     * more" -- the next full fetch rebuilds it.
     * @type {Set<number> | null}
     */
    this.appliedUpdateIds = new Set();
    // The highest row id heard of, applied or not. Drives the compaction
    // trigger only.
    this.maxSeenUpdateId = 0;
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
      this.sendDocUpdate(update);
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
            // Push before pulling, and on the first connect as well as later
            // ones: `connect` starts listening for local doc updates before the
            // subscription confirms, so this tab can already be holding edits
            // that exist nowhere else.
            this.flushPendingSends();
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

  /**
   * @returns {boolean} false when ActionCable had no open socket to hand the
   *   message to. It discards the message in that case and says so only through
   *   this return value, which for a `doc_update` is the difference between a
   *   delivered edit and one that exists in this tab alone.
   */
  perform(action, data) {
    return this.subscription?.perform(action, { ...data, sender: this.sender }) ?? false;
  }

  /**
   * Hand a local update to the relay, keeping it if the relay will not take it.
   *
   * Once anything is queued, everything queues until the flush drains it. That
   * is cheaper than it looks: sending the newer update first would leave a hole
   * in this tab's `seq` run, and every peer would answer that hole with a full
   * fetch of the update log.
   * @param {Uint8Array} update
   * @returns {void}
   */
  sendDocUpdate(update) {
    if (this.resendFullState) return; // the queued full state will carry it
    const message = { payload: toBase64(update), seq: (this.outboundSeq += 1) };
    if (this.pendingSends.length === 0 && this.perform("doc_update", message)) return;
    this.pendingSends.push(message);
    if (this.pendingSends.length > MAX_PENDING_SENDS) {
      this.pendingSends = [];
      this.resendFullState = true;
    }
  }

  /**
   * Send whatever the socket refused while it was down.
   *
   * A partial flush is fine: the queue keeps what it could not send, in order,
   * and the next `connected` picks up where this left off.
   * @returns {void}
   */
  flushPendingSends() {
    if (this.destroyed) return;
    if (this.resendFullState) {
      // One update carrying the whole doc, standing in for a queue too long to
      // replay. It is well past MAX_BROADCAST_BYTES, so peers will pull it over
      // HTTP rather than read it off the cable -- the path oversized updates
      // already take.
      const payload = toBase64(Y.encodeStateAsUpdate(this.doc));
      if (this.perform("doc_update", { payload, seq: (this.outboundSeq += 1) })) {
        this.resendFullState = false;
      }
      return;
    }
    while (this.pendingSends.length > 0) {
      if (!this.perform("doc_update", this.pendingSends[0])) return;
      this.pendingSends.shift();
    }
  }

  receive(message) {
    if (message.type === "update") {
      this.noteSeq(message);
      this.noteSeen(message.id);
      if (message.sender !== this.sender) {
        Y.applyUpdate(this.doc, fromBase64(message.payload), this);
      }
      // Reached only if the apply did not throw; our own echo is ours already.
      this.noteApplied(message.id);
    } else if (message.type === "resync") {
      // An update too large for the cable transport to carry (see
      // ProjectDocChannel::MAX_BROADCAST_BYTES). It is already persisted, so pull it
      // over HTTP. The sender already has it locally and can skip.
      this.noteSeq(message);
      this.noteSeen(message.id);
      if (message.sender === this.sender) {
        this.noteApplied(message.id);
      } else {
        // Deliberately not `noteApplied`: the content arrives with the fetch,
        // and until it does, telling the server we have merged this far would
        // license it to delete a row we have never read.
        this.scheduleResync();
      }
    } else if (message.type === "awareness") {
      if (message.sender !== this.sender) {
        applyAwarenessUpdate(this.awareness, fromBase64(message.payload), this);
      }
    }
  }

  /**
   * Note that update-log row `id` exists. Drives the compaction trigger only --
   * "enough has happened to be worth snapshotting" is a fair thing to judge
   * from what we have heard about.
   * @param {unknown} id
   * @returns {void}
   */
  noteSeen(id) {
    if (typeof id !== "number" || id <= this.maxSeenUpdateId) return;
    this.maxSeenUpdateId = id;
    this.updatesSinceCompaction += 1;
  }

  /**
   * Note that this client now holds the *content* of update-log row `id`. This
   * set, and nothing derived from it, is what compaction offers the server.
   *
   * It used to be a high-water mark, which was unsound in a way no other guard
   * here catches. `project_doc_updates.id` comes from a sequence shared with
   * every project, so a hole in one project's ids means nothing and a mark
   * cannot be checked for one; and a row can be missing from a `GET /doc`
   * ordered by id, because a sequence hands out ids before the commits a reader
   * needs to see. Apply a later row and the mark moves past the missing one.
   *
   * Neither `noteSeq` nor `isDocComplete` closes that. If the missing row was
   * the last thing its sender sent, no later `seq` ever arrives to reveal the
   * hole; and nothing in the doc causally depends on that row, so Yjs has
   * nothing pending and reports a complete document. The mark would then license
   * the server to delete the one remaining copy.
   *
   * Naming the rows exactly removes the inference: a row this client never read
   * is simply not in the set, so it cannot be asked for.
   * @param {unknown} id
   * @returns {void}
   */
  noteApplied(id) {
    if (typeof id !== "number" || this.appliedUpdateIds === null) return;
    this.appliedUpdateIds.add(id);
    if (this.appliedUpdateIds.size > MAX_TRACKED_UPDATE_IDS) {
      this.appliedUpdateIds = null;
      this.scheduleResync();
    }
  }

  /**
   * Watch a peer tab's update sequence for a hole.
   *
   * `seq` is incremented by one tab and nobody else, so a number missing here is
   * an update that left that tab and reached this one's relay never -- most
   * likely skipped by solid_cable's poller, which advances past a row whose id
   * was allocated before a commit that had not landed when it read. Nothing on
   * the server can see that happen; this is the only witness.
   *
   * The row itself is still in `project_doc_updates`, so the repair is the
   * catch-up fetch that already exists. The report is what makes a drop
   * countable rather than a mystery a month later.
   *
   * This catches a drop early, but it is not what makes compaction safe -- a
   * drop of a sender's *last* update leaves no later `seq` to be missing. See
   * `noteApplied`.
   * @param {{sender?: string, seq?: unknown}} message
   * @returns {void}
   */
  noteSeq({ sender, seq }) {
    if (sender === this.sender || typeof seq !== "number") return;
    const last = this.lastSeqBySender.get(sender);
    if (last === undefined || seq > last) this.lastSeqBySender.set(sender, seq);
    if (last === undefined || seq <= last + 1) return;

    this.scheduleResync();
    reportCollabIncident({
      kind: "update_gap",
      projectId: this.projectId,
      csrfToken: this.csrfToken,
      detail: `Skipped ${seq - last - 1} update(s) from a peer tab; pulling the update log.`,
    });
  }

  /**
   * True when the doc has integrated everything it has been handed.
   *
   * Yjs parks an update whose causal predecessor is missing in
   * `store.pendingStructs`, and a delete naming an item it has never seen in
   * `store.pendingDs`. Either means this client is missing an update, and --
   * the part that makes this worth checking -- that it is missing it silently:
   * the withheld text simply reads as though nobody ever typed it, while
   * deletions around it apply normally. Anything that treats this doc as the
   * truth for the whole session has to ask first.
   * @returns {boolean}
   */
  isDocComplete() {
    const store = this.doc.store;
    return !store.pendingStructs && !store.pendingDs;
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
    // A fetch is a fresh, complete answer about which rows the server holds, so
    // it is also where a client that lost track of its claim set gets one back.
    if (this.appliedUpdateIds === null) this.appliedUpdateIds = new Set();
    for (const update of info.updates ?? []) {
      Y.applyUpdate(this.doc, fromBase64(update.payload), this);
      this.noteSeen(update.id);
      this.noteApplied(update.id);
    }
  }

  async fetchAndApply() {
    this.applyDocInfo(await this.fetchDocInfo());
  }

  /**
   * Catch up over HTTP and wait for it. `scheduleResync` is the fire-and-forget
   * form; a caller about to persist the doc on the session's behalf needs to
   * know whether the fetch landed before it decides.
   * @returns {Promise<void>}
   */
  async resyncNow() {
    try {
      await this.fetchAndApply();
    } catch (error) {
      console.error("Failed to resync collaborative doc:", error);
    }
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
    // A doc still holding unintegrated updates is missing something. Snapshotting
    // it would make a state that is authoritative and incomplete at once the one
    // every future client starts from. Waiting costs a minute; the resync that
    // fills the hole is already scheduled.
    if (!this.isDocComplete()) return;
    if (this.appliedUpdateIds === null || this.appliedUpdateIds.size === 0) return;

    // Snapshot and claim are taken together, and the claim is spelled out in
    // full, so what the server deletes is exactly what this snapshot carries.
    // Rows that land while the request is in flight are not in `merged` and stay
    // claimed for next time.
    const merged = [...this.appliedUpdateIds];
    const snapshot = toBase64(Y.encodeStateAsUpdate(this.doc));
    const res = await fetch(this.docUrl, {
      method: "PUT",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ snapshot, merged_update_ids: merged }),
    }).catch(() => null);
    if (!res?.ok) return;
    for (const id of merged) this.appliedUpdateIds?.delete(id);
    this.updatesSinceCompaction = 0;
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
