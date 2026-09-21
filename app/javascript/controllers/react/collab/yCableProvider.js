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
 * Compaction: the leader (see `isLeader`) periodically PUTs the full doc state
 * together with the log rows that state carries; the server swaps the snapshot
 * and deletes exactly the rows it named. Which rows those are has to be *known*,
 * not inferred from an id range -- see `noteApplied`.
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
 *   * The send leg drops it, in either of two ways. `perform` returns false and
 *     discards the message when the socket is not open; and when it is open it
 *     returns true for a message the socket has merely *buffered*, which a
 *     connection that then dies discards without telling anyone. Reconnecting
 *     only ever pulled state, so both were permanent. Updates are now held in
 *     an outbox until the server echoes them back, and re-sent on reconnect
 *     (`sendDocUpdate`, `noteAcked`, `resendUnacked`).
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
// How many unacknowledged `doc_update` messages to keep for replay. The outbox
// normally holds one or two -- an echo comes back in a round trip -- and only
// grows while this tab is off the air or the relay has stopped echoing. Past
// this the oldest are dropped and the reconnect sends one full state update
// instead: far bigger, but a single idempotent message that covers everything
// that can no longer be replayed exactly.
const MAX_OUTBOX = 200;
// How many merged row ids to carry before giving up on naming them exactly. A
// compacting leader clears its set every COMPACTION_INTERVAL_MS, so only a tab
// that has spent a long session never leading can approach this; past it the tab
// stops claiming anything until its next full fetch rebuilds the set, which
// costs a slightly longer update log and nothing else.
const MAX_TRACKED_UPDATE_IDS = 10000;
// How long after a local edit a tab still counts as one somebody is working in.
// Long enough to cover reading, thinking and scrolling -- the point is to tell an
// author's tab from one left open on a second monitor, not to track keystrokes --
// and re-evaluated on the awareness heartbeat, so it moves in 15s steps.
const WRITER_ACTIVE_MS = 120000;

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
    /**
     * Updates this tab has produced and the server has not yet echoed back,
     * oldest first. An echo is the only evidence of delivery there is: `perform`
     * reports that ActionCable handed the bytes to a socket, which a connection
     * dying moments later discards without a word.
     * @type {Array<{payload: string, seq: number}>}
     */
    this.outbox = [];
    // Highest seq handed to a socket, and highest the server has echoed. They
    // differ by whatever is in flight; on reconnect the first is rewound to the
    // second, because a socket that died took everything it had not acknowledged
    // with it.
    this.sentThrough = 0;
    this.ackedThrough = 0;
    // Set when the outbox overflowed and the exact replay was lost with it.
    this.outboxTruncated = false;
    /**
     * The update-log rows whose payloads this client has actually applied, and
     * so the exact set it may ask the server to delete at compaction. Null once
     * it has grown past MAX_TRACKED_UPDATE_IDS, meaning "cannot name it any
     * more" -- the next full fetch rebuilds it.
     * @type {Set<number> | null}
     */
    this.appliedUpdateIds = new Set();
    /**
     * Which snapshot this client's document was built from, as the server names
     * it. Fixed-width UTC, so `<` orders two of them. Null until one is applied.
     * @type {string | null}
     */
    this.snapshotVersion = null;
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
    // What this tab last told its peers about its own fitness to write for the
    // session, and the local clock reading that `active` is derived from. See
    // `publishWriterState`.
    this.writerState = null;
    this.lastLocalEditAt = 0;
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
      // Anything not applied by us is somebody typing in this tab, which is what
      // `active` means. Cheap on the keystroke path: publishing is a no-op
      // unless the boolean actually flipped.
      this.lastLocalEditAt = Date.now();
      this.publishWriterState();
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
    this.publishWriterState();

    // Presence heartbeat: rebroadcast our state so peers' 30s expiry never
    // fires while we're alive (awareness is unpersisted, so newcomers learn
    // about us from this too).
    this.intervals.push(
      setInterval(() => {
        // Also the clock for `active` lapsing: nothing else fires when a tab
        // simply stops being edited.
        this.publishWriterState();
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
      // Immediately, not on the next heartbeat: a tab going to the background is
      // exactly when the session wants to hand the writing to somebody else, and
      // this tab's timers are about to be throttled.
      this.publishWriterState();
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
      this.publishWriterState();
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
    this.publishWriterState();
    reportCollabIncident({
      kind: "relay_recovered",
      projectId: this.projectId,
      csrfToken: this.csrfToken,
      silentForSeconds: silentFor ? Math.round(silentFor / 1000) : undefined,
    });
  }

  /**
   * Tell peers how well placed this tab is to write for the session, when that
   * has changed.
   *
   * Three booleans, each computed by a tab about itself. Not a timestamp,
   * because ranking tabs by one means trusting another machine's clock; not a
   * precomputed rank, because that would put this policy into data that outlives
   * the deploy which chose it. Every peer sees the same three booleans and
   * applies the same `writerScore` to them, so they agree.
   * @returns {void}
   */
  publishWriterState() {
    if (this.destroyed) return;
    const next = {
      visible: typeof document === "undefined" || document.visibilityState === "visible",
      active: Date.now() - this.lastLocalEditAt < WRITER_ACTIVE_MS,
      stalled: this.relayStatus === "stalled",
    };
    const current = this.writerState;
    if (
      current &&
      current.visible === next.visible &&
      current.active === next.active &&
      current.stalled === next.stalled
    ) {
      return;
    }
    this.writerState = next;
    this.awareness.setLocalStateField("writer", next);
  }

  /**
   * True when this client should run session-wide chores (autosave, compaction).
   *
   * The job goes to the best-placed tab rather than -- as it used to -- the one
   * whose randomly assigned Yjs clientID happened to sort lowest. That number
   * says nothing about a tab, and it handed the session's writing to whichever
   * tab drew the low card: in practice, often a collaborator's window left open
   * on another desktop while the author worked. Two things go wrong when it
   * does. A backgrounded tab has its timers throttled to about once a minute, so
   * the session's 10s autosave quietly becomes a 60s one and the project's
   * source sits further behind the doc than anyone intends. And a tab whose
   * relay has stalled is the one *least* likely to hold the session's current
   * state, yet nothing stopped it writing that state out for everybody.
   *
   * So: healthy before stalled, foreground before background, being typed in
   * before idle, and the old clientID comparison only to break a tie -- it is
   * arbitrary, but every tab computes the same arbitrary answer, which is all a
   * tie-break has to do.
   *
   * Tabs can briefly disagree, while a change to one tab's booleans is still in
   * flight. That is safe in the direction it fails: disagreement needs two tabs
   * to hold different views of the *same* published booleans, which makes "both
   * of us lead" reachable and "neither of us leads" essentially not. Two leaders
   * means two PATCHes derived from the same shared doc, and Rails does not even
   * touch `source_updated_at` for a write that changes nothing.
   * @returns {boolean}
   */
  isLeader() {
    const states = this.awareness.getStates();
    let bestId = this.awareness.clientID;
    let bestScore = writerScore(states.get(bestId));
    states.forEach((state, clientId) => {
      const score = writerScore(state);
      if (score < bestScore || (score === bestScore && clientId < bestId)) {
        bestScore = score;
        bestId = clientId;
      }
    });
    return bestId === this.awareness.clientID;
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
            this.resendUnacked();
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
   *
   *   Only an explicit `false` is read as a refusal, rather than anything
   *   falsy. `Connection#send` returns a real boolean today (pinned by
   *   actionCableContract.test.mjs), but the asymmetry is deliberate: a version
   *   that returned `undefined` on success would, under a truthiness test,
   *   queue every update and drain none -- a tab that silently stops
   *   collaborating -- while the same drift read this way costs nothing.
   */
  perform(action, data) {
    if (!this.subscription) return false;
    return this.subscription.perform(action, { ...data, sender: this.sender }) !== false;
  }

  /**
   * Put a local update in the outbox and try to send it.
   *
   * It stays there until the server echoes it back. Dropping it at `perform`
   * would trust a return value that means "the socket took these bytes", not
   * "the server has them" -- and a socket that dies with bytes buffered
   * discards them silently, which is a lost edit with nothing anywhere to
   * suggest one happened.
   * @param {Uint8Array} update
   * @returns {void}
   */
  sendDocUpdate(update) {
    this.outbox.push({ payload: toBase64(update), seq: (this.outboundSeq += 1) });
    if (this.outbox.length > MAX_OUTBOX) {
      this.outbox.shift();
      this.outboxTruncated = true;
    }
    this.drainOutbox();
  }

  /**
   * Hand the socket everything it has not been given yet, oldest first.
   *
   * Stops at the first refusal and keeps the rest: sending a newer update past
   * a refused older one would leave a hole in this tab's `seq` run, and every
   * peer would answer that hole with a fetch of the whole update log.
   * @returns {void}
   */
  drainOutbox() {
    if (this.destroyed) return;
    for (const message of this.outbox) {
      if (message.seq <= this.sentThrough) continue;
      if (!this.perform("doc_update", message)) return;
      this.sentThrough = message.seq;
    }
  }

  /**
   * Re-send whatever the last socket never acknowledged.
   *
   * Rewinding `sentThrough` to `ackedThrough` is the whole point: those updates
   * were handed to a socket that has since died, and nothing distinguishes the
   * ones it managed to flush from the ones it dropped on the floor. Re-sending
   * a delivered update costs a duplicate row that compaction collects; not
   * re-sending a dropped one costs somebody their edit.
   * @returns {void}
   */
  resendUnacked() {
    if (this.destroyed) return;
    this.sentThrough = this.ackedThrough;
    if (this.outboxTruncated) {
      // One update carrying the whole doc, standing in for an outbox too long to
      // replay. Well past MAX_BROADCAST_BYTES, so peers pull it over HTTP rather
      // than read it off the cable -- the path oversized updates already take.
      this.outboxTruncated = false;
      this.outbox = [
        {
          payload: toBase64(Y.encodeStateAsUpdate(this.doc)),
          seq: (this.outboundSeq += 1),
        },
      ];
    }
    this.drainOutbox();
  }

  /**
   * Note that the server has our update `seq`, and stop holding it.
   *
   * The channel creates the `project_doc_updates` row before it broadcasts, so
   * an echo is proof of persistence and not merely of arrival. A lost echo only
   * costs a duplicate on the next reconnect, which is the right way round.
   * @param {unknown} seq
   * @returns {void}
   */
  noteAcked(seq) {
    if (typeof seq !== "number" || seq <= this.ackedThrough) return;
    this.ackedThrough = seq;
    while (this.outbox.length > 0 && this.outbox[0].seq <= seq) this.outbox.shift();
  }

  receive(message) {
    if (message.type === "update") {
      this.noteSeq(message);
      this.noteSeen(message.id);
      if (message.sender === this.sender) this.noteAcked(message.seq);
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
        this.noteAcked(message.seq);
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
      // Our own seed is now the snapshot; the response names it, so the seeder
      // starts level with the log without fetching back the bytes it just sent.
      this.snapshotVersion = (await res.json().catch(() => ({}))).snapshot_version ?? null;
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
    // Recorded whether or not there were bytes to apply. It identifies the
    // server's snapshot, and a doc row carrying no snapshot is still one this
    // client is level with -- tying this to `info.snapshot` would leave the
    // version null, which reads as "behind" and fetches the whole document on
    // every save from then on.
    if (info.snapshot_version) this.snapshotVersion = info.snapshot_version;
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
   * Ask what is persisted, without reading it. A few hundred bytes, so this is
   * affordable on every save where a full fetch is not.
   * @returns {Promise<{seeded: boolean, snapshot_version: string|null, update_ids: number[]}>}
   */
  async fetchDocStatus() {
    const res = await fetch(`${this.docUrl}/status`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Failed to read collaborative doc status: ${res.status}`);
    return res.json();
  }

  /**
   * Whether this client holds everything the durable log currently holds.
   *
   * The question `isDocComplete` cannot answer. Yjs only knows an update is
   * missing when something it *does* hold depends on it; an update nothing
   * depends on -- the last one a peer sent before going quiet, say -- leaves
   * both pending stores empty, and the client looks, to itself, perfectly
   * healthy while its document is silently behind. The server is the only party
   * that can see the difference, and this is it asking.
   *
   * Two ways to be behind: working from a snapshot older than the current one,
   * or missing a row that sits on top of it. Both are checked, because
   * compaction moves rows into the snapshot and either alone would miss half of
   * the traffic. A client that can no longer name the rows it has applied
   * counts as behind -- it cannot show otherwise, and a needless fetch is the
   * cheap mistake here.
   *
   * A row that commits *after* this answer is not a gap: a save that precedes a
   * write is a save of the state before it, which is what saves are.
   *
   * "unknown" is a third answer and not a synonym for "behind". The repair for
   * being behind is fetching the whole document, which is the most expensive
   * request this client makes; spending it because the *cheap* request just
   * failed gets the response exactly backwards, and would do so once per
   * autosave for as long as the network stayed unhappy.
   * @returns {Promise<"level" | "behind" | "unknown">}
   */
  async compareWithLog() {
    let status;
    try {
      status = await this.fetchDocStatus();
    } catch (error) {
      console.error("Failed to read collaborative doc status:", error);
      return "unknown";
    }
    if (!status.seeded) return "level";
    const version = status.snapshot_version;
    if (version && (this.snapshotVersion === null || this.snapshotVersion < version)) {
      return "behind";
    }
    if (this.appliedUpdateIds === null) return "behind";
    const hasEveryRow = (status.update_ids ?? []).every((id) =>
      this.appliedUpdateIds.has(id),
    );
    return hasEveryRow ? "level" : "behind";
  }

  /**
   * Bring this client level with the durable log, and say whether that worked.
   *
   * The re-check runs against a *fresh* status rather than the one that found
   * the gap: compaction may have moved rows into a new snapshot while the fetch
   * was in flight, and judging the result by the older answer would report a
   * client that is now perfectly current as still behind.
   * @returns {Promise<boolean>}
   */
  async catchUpWithLog() {
    const before = await this.compareWithLog();
    if (before === "level") return true;
    // Not reachable is not the same as behind, and must not buy a full fetch.
    if (before === "unknown") return false;
    await this.resyncNow();
    return (await this.compareWithLog()) === "level";
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

/**
 * How poorly suited a tab is to doing the session's writing; lowest leads. See
 * `YCableProvider#isLeader` for why these three and in this order.
 *
 * A peer that has published nothing is ranked as an ordinary background tab
 * rather than excluded. It is either mid-join or running a bundle from before
 * this field existed, and in a session where it is the only other candidate,
 * ranking it last would be worse than ranking it roughly.
 * @param {{writer?: {visible?: boolean, active?: boolean, stalled?: boolean}}} [state]
 * @returns {number}
 */
const writerScore = (state) => {
  const writer = state?.writer;
  if (!writer) return 3;
  return (writer.stalled ? 4 : 0) + (writer.visible ? 0 : 2) + (writer.active ? 0 : 1);
};

const toBase64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (encoded) =>
  Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
