import { createConsumer } from "@rails/actioncable";
import * as Y from "yjs";
import { ActionCableProvider } from "yrby-client";
import { seedDocFromState } from "@pretextbook/web-editor";
import { reportCollabIncident } from "./reportIncident";

/**
 * Yjs provider for a project's collaborative editing session.
 *
 * The transport is yrby's `ActionCableProvider`, which speaks the y-websocket
 * sync protocol against a server that holds the document (see
 * ProjectDocChannel). That is the whole reason this file is short. A join, a
 * reconnect or a resync sends this client's *state vector* and is answered with
 * exactly the updates it lacks, computed by the side that has them; every local
 * update is held until the server acknowledges having recorded it. Nothing here
 * has to work out what it might be missing, which is what the previous version
 * of this file spent four hundred lines failing to do soundly.
 *
 * What is left is the three things the protocol does not cover, because they
 * are about this application rather than about the document:
 *
 *   * **Seeding.** A brand-new session has to decide the document's first
 *     content, and only one client may. The seed is POSTed to `doc/seed` and
 *     deliberately *not* applied locally -- the handshake hands it back, so
 *     every client including the seeder reaches the document one way.
 *   * **The relay watchdog.** ActionCable can stop delivering while every HTTP
 *     request keeps succeeding: in the August 2026 outage solid_cable's listener
 *     thread had died inside a Puma worker. Nothing on the server can see that;
 *     this client can, because the channel echoes its own awareness back to it.
 *     See `startWatchdog`.
 *   * **Periodic resync.** The one gap a live socket can still hide. solid_cable
 *     polls `solid_cable_messages` by id and a sequence hands out ids before the
 *     commits behind them land, so a row can be passed over and delivered to
 *     nobody -- with the socket perfectly healthy, so no reconnect ever fires.
 *     Re-running the handshake costs a state vector (tens of bytes) and, when
 *     nothing is missing, an empty answer.
 *
 * @typedef {Object} ProviderConfig
 * @property {string} projectId
 * @property {string} [csrfToken]
 * @property {{name: string, color: string}} user
 * @property {(status: "ready"|"stalled") => void} [onRelayStatusChange]
 */

// y-protocols expires a peer after 30s and refreshes our own awareness entry
// once it is 15s old, so a live session cannot be quiet for longer than that.
const AWARENESS_HEARTBEAT_MS = 15000;
// How often the watchdog looks, and how much silence it takes to call the relay
// stalled. Two and a half missed heartbeats: long enough that one dropped
// message or a slow poll is not an incident, short enough that a user is still
// looking at the screen when the banner appears.
const RELAY_WATCHDOG_MS = 10000;
const RELAY_SILENCE_MS = AWARENESS_HEARTBEAT_MS * 2.5;
// How often to re-run the sync handshake on a socket that has not dropped.
// Measured server-side at ~17ms for a book-sized document, nearly all of it
// reading the snapshot out of Postgres, so this is affordable per client but
// not free -- it buys the repair for a broadcast lost under a healthy socket,
// which nothing else here would ever notice.
const RESYNC_INTERVAL_MS = 30000;

export class YCableProvider {
  /** @param {ProviderConfig} config */
  constructor({ projectId, csrfToken, user, onRelayStatusChange }) {
    this.projectId = projectId;
    this.csrfToken = csrfToken;
    this.user = user;
    this.onRelayStatusChange = onRelayStatusChange ?? (() => {});
    this.doc = new Y.Doc();
    this.provider = null;
    this.consumer = null;
    /** @type {import("y-protocols/awareness").Awareness | null} */
    this.awareness = null;
    this.destroyed = false;
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
    await this.seed(seedStateFactory);

    this.consumer = createConsumer();
    this.provider = new ActionCableProvider(
      this.doc,
      this.watchedConsumer(this.consumer),
      "ProjectDocChannel",
      { project_id: this.projectId },
    );
    this.awareness = this.provider.awareness;
    // Presence identity. Set before connecting so our first awareness frame
    // already carries it, and so PresenceAvatars never sees a nameless peer.
    this.awareness.setLocalStateField("user", this.user);

    this.provider.connect();
    await this.provider.whenSynced;
    if (this.destroyed) return;

    this.startWatchdog();
    this.intervals.push(
      setInterval(() => this.resync(), RESYNC_INTERVAL_MS),
    );
  }

  /**
   * Offer this client's view of the project as the document's first content.
   *
   * Exactly one offer is accepted; a 409 means somebody seeded first and this
   * client simply joins. The seed is built in a scratch doc and never applied
   * to `this.doc`: applying it here would make it a local edit, which the
   * handshake would then push back to a server that already has it, and would
   * leave the seeder reaching the document by a path no other client uses.
   *
   * A failure is not fatal. The document may already exist, and if it does not,
   * the session joins an empty one rather than refusing to open -- which is
   * recoverable, where a duplicated seed is not.
   * @param {() => import("@pretextbook/web-editor").CollabDocState} seedStateFactory
   * @returns {Promise<void>}
   */
  async seed(seedStateFactory) {
    const seedDoc = new Y.Doc();
    seedDocFromState(seedDoc, seedStateFactory());
    const state = toBase64(Y.encodeStateAsUpdate(seedDoc));
    seedDoc.destroy();

    try {
      await fetch(`/projects/${this.projectId}/doc/seed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": this.csrfToken,
        },
        body: JSON.stringify({ state }),
      });
    } catch (error) {
      console.error("Failed to offer a seed for the collaborative doc:", error);
    }
  }

  /**
   * Wrap the cable consumer so every inbound message also feeds the watchdog.
   *
   * The provider owns its subscription, and the watchdog needs to see the
   * traffic on it. Wrapping the mixin's `received` is the one seam that does
   * not require reaching into the provider's internals.
   * @param {ReturnType<typeof createConsumer>} consumer
   * @returns {{subscriptions: {create: Function}}}
   */
  watchedConsumer(consumer) {
    return {
      subscriptions: {
        create: (channel, mixin) =>
          consumer.subscriptions.create(channel, {
            ...mixin,
            received: (message) => {
              this.noteInbound();
              mixin?.received?.(message);
            },
          }),
      },
    };
  }

  // ── Relay watchdog ─────────────────────────────────────────────────────────

  /**
   * Watch for the relay going quiet, and keep the session usable when it does.
   *
   * The signal is plain silence. Our own awareness frame is echoed back to us by
   * the channel, and y-protocols refreshes our awareness entry once it is 15s
   * old, so a healthy relay cannot be quiet for RELAY_SILENCE_MS however idle
   * the humans are; a quiet relay is a broken one. That is what makes this catch
   * the failure HTTP checks cannot see, in a session of one as readily as in a
   * session of five.
   *
   * While stalled it re-runs the handshake every tick. That is not just
   * bookkeeping: when the relay died in August the *broadcast* leg was what had
   * gone -- updates still reached the server and were still recorded -- so peers'
   * edits were all there to be read. Re-syncing turns a silently diverging
   * session into a slow one.
   * @returns {void}
   */
  startWatchdog() {
    this.lastInboundAt = Date.now();

    // A hidden tab has its timers throttled, the awareness refresh included, so
    // silence measured across a spell in the background says nothing about the
    // relay.
    this.onVisibilityChange = () => {
      if (document.visibilityState === "visible") this.lastInboundAt = Date.now();
    };
    document.addEventListener("visibilitychange", this.onVisibilityChange);

    this.intervals.push(setInterval(() => this.checkRelay(), RELAY_WATCHDOG_MS));
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

    // Every tick while stalled, not just on the transition: this is the
    // session's only remaining path to peers' edits.
    this.resync();
  }

  /**
   * Any inbound cable message is proof the relay is delivering.
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

  /**
   * Re-run the sync handshake on a socket that has not dropped.
   *
   * `onConnect` is what the provider calls when the transport comes up: it
   * sends SyncStep1, re-announces our presence, and replays anything the server
   * has not acknowledged. All three are idempotent, which is what makes it safe
   * to call on a live connection.
   * @returns {void}
   */
  resync() {
    if (this.destroyed) return;
    this.provider?.session?.onConnect();
  }

  /**
   * True when this client should run session-wide chores (the autosave that
   * writes the doc out as project source).
   *
   * The lowest awareness clientID, which is arbitrary but agreed on by every
   * tab. Leaving this here is temporary: the whole idea of electing a browser
   * to persist on the session's behalf goes away once the server projects the
   * document into the project's divisions itself, which is the next change.
   * @returns {boolean}
   */
  isLeader() {
    if (!this.awareness) return false;
    const ids = [...this.awareness.getStates().keys()];
    if (ids.length === 0) return true;
    return Math.min(...ids) === this.awareness.clientID;
  }

  destroy() {
    this.destroyed = true;
    document.removeEventListener("visibilitychange", this.onVisibilityChange ?? (() => {}));
    this.intervals.forEach(clearInterval);
    this.intervals = [];
    // Tears down the subscription and the Awareness it created, after flushing
    // a presence removal so peers drop our cursor immediately.
    this.provider?.destroy();
    this.consumer?.disconnect();
    this.doc.destroy();
  }
}

const toBase64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};
