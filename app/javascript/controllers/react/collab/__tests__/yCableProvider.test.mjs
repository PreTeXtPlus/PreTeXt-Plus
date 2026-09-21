import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";

// The provider only needs `seedDocFromState` from the editor package, and
// loading that package for real drags in React, Monaco and a stylesheet.
vi.mock("@pretextbook/web-editor", () => ({ seedDocFromState: vi.fn() }));
vi.mock("@rails/actioncable", () => ({ createConsumer: vi.fn() }));
vi.mock("../reportIncident", () => ({ reportCollabIncident: vi.fn() }));

const { YCableProvider } = await import("../yCableProvider.js");
const { reportCollabIncident } = await import("../reportIncident.js");

/**
 * A provider with a stand-in subscription, so `perform` can be made to succeed
 * or fail the way a real socket does. Nothing here calls `connect`: the
 * bookkeeping under test is driven directly.
 */
const makeProvider = ({ socketOpen = true } = {}) => {
  const provider = new YCableProvider({
    projectId: "project-1",
    csrfToken: "csrf",
    user: { name: "Ada", color: "#123456" },
  });
  const socket = { open: socketOpen };
  const sent = [];
  provider.subscription = {
    perform: (action, data) => {
      if (!socket.open) return false;
      sent.push({ action, ...data });
      return true;
    },
  };
  return { provider, socket, sent };
};

const peerMessage = (overrides) => ({
  type: "update",
  sender: "peer-tab",
  ...overrides,
});

beforeEach(() => {
  vi.mocked(reportCollabIncident).mockClear();
});

describe("a Yjs update that reaches nobody", () => {
  // The failure this whole module guards against, in the smallest form that
  // shows it: an author replaces a number, one of the two updates is lost, and
  // the peer ends up with the deletion applied and the replacement missing --
  // silently, and for every later insert from that author too.
  const authorAndPeerWithAGap = () => {
    const author = new Y.Doc();
    author.getText("t").insert(0, "x = 5");
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(author));

    const updates = [];
    author.on("update", (update) => updates.push(update));
    author.getText("t").delete(4, 1); // backspace the 5
    author.getText("t").insert(4, "7"); // type the 7
    author.getText("t").insert(5, "!"); // keep typing

    Y.applyUpdate(peer, updates[0]);
    Y.applyUpdate(peer, updates[2]); // updates[1] never arrives
    return { author, peer, updates };
  };

  it("applies the author's delete but withholds every later insert", () => {
    const { author, peer } = authorAndPeerWithAGap();

    expect(author.getText("t").toString()).toBe("x = 7!");
    expect(peer.getText("t").toString()).toBe("x = ");
  });

  it("is visible as an incomplete doc, and heals when the gap is filled", () => {
    const { peer, updates } = authorAndPeerWithAGap();
    const { provider } = makeProvider();
    provider.doc.destroy();
    provider.doc = peer;

    expect(provider.isDocComplete()).toBe(false);

    Y.applyUpdate(peer, updates[1]);
    expect(provider.isDocComplete()).toBe(true);
    expect(peer.getText("t").toString()).toBe("x = 7!");
  });
});

describe("outbound updates", () => {
  const ack = (provider, seq) =>
    provider.receive({ type: "update", sender: provider.sender, id: seq, seq });

  it("stamps a monotonic seq on each update", () => {
    const { provider, sent } = makeProvider();

    provider.sendDocUpdate(new Uint8Array([1]));
    provider.sendDocUpdate(new Uint8Array([2]));

    expect(sent.map((m) => m.seq)).toEqual([1, 2]);
    expect(sent.every((m) => m.action === "doc_update")).toBe(true);
  });

  it("treats anything but an explicit refusal as handed to the socket", () => {
    const { provider } = makeProvider();
    // Only `false` means ActionCable turned the message away. Reading any falsy
    // value that way would re-send every update on every reconnect.
    provider.subscription = { perform: () => undefined };

    provider.sendDocUpdate(new Uint8Array([1]));

    expect(provider.sentThrough).toBe(1);
  });

  it("holds an update until the server echoes it back", () => {
    const { provider } = makeProvider();

    provider.sendDocUpdate(new Uint8Array([1]));
    provider.sendDocUpdate(new Uint8Array([2]));
    // Handed to the socket is not delivered: `perform` reports that ActionCable
    // took the bytes, which a connection dying moments later discards silently.
    expect(provider.outbox.map((m) => m.seq)).toEqual([1, 2]);

    ack(provider, 1);
    expect(provider.outbox.map((m) => m.seq)).toEqual([2]);

    ack(provider, 2);
    expect(provider.outbox).toEqual([]);
  });

  it("re-sends what the dead socket never acknowledged", () => {
    const { provider, sent } = makeProvider();
    provider.sendDocUpdate(new Uint8Array([1]));
    provider.sendDocUpdate(new Uint8Array([2]));
    ack(provider, 1); // only the first came back
    sent.length = 0;

    provider.resendUnacked();

    // The hole this closes: the socket accepted 2 and `perform` said so, then
    // the connection died with it still buffered. Nothing else would ever have
    // sent it again, and the author's edit would exist in this tab alone.
    expect(sent.map((m) => m.seq)).toEqual([2]);
  });

  it("does not re-send what the server already acknowledged", () => {
    const { provider, sent } = makeProvider();
    provider.sendDocUpdate(new Uint8Array([1]));
    ack(provider, 1);
    sent.length = 0;

    provider.resendUnacked();

    expect(sent).toEqual([]);
  });

  it("keeps an update the socket refuses and sends it on reconnect, in order", () => {
    const { provider, socket, sent } = makeProvider({ socketOpen: false });

    provider.sendDocUpdate(new Uint8Array([1]));
    provider.sendDocUpdate(new Uint8Array([2]));
    expect(sent).toEqual([]);

    socket.open = true;
    provider.resendUnacked();

    expect(sent.map((m) => m.seq)).toEqual([1, 2]);
    expect(sent.map((m) => Buffer.from(m.payload, "base64")[0])).toEqual([1, 2]);
  });

  it("sends the older update first when the socket returns mid-stream", () => {
    const { provider, socket, sent } = makeProvider({ socketOpen: false });

    provider.sendDocUpdate(new Uint8Array([1])); // refused
    socket.open = true;
    provider.sendDocUpdate(new Uint8Array([2])); // takes the backlog with it

    // Order matters more than promptness here: a seq gap of this tab's own
    // making would send every peer off to fetch the whole update log.
    expect(sent.map((m) => m.seq)).toEqual([1, 2]);
  });

  it("keeps what it could not send when a drain is interrupted", () => {
    const { provider, socket, sent } = makeProvider({ socketOpen: false });

    provider.sendDocUpdate(new Uint8Array([1]));
    provider.sendDocUpdate(new Uint8Array([2]));
    let allowed = 1;
    provider.subscription.perform = (action, data) => {
      if (allowed-- <= 0) return false;
      sent.push({ action, ...data });
      return true;
    };
    socket.open = true;
    provider.resendUnacked();

    expect(sent.map((m) => m.seq)).toEqual([1]);
    expect(provider.outbox.map((m) => m.seq)).toEqual([1, 2]);
    expect(provider.sentThrough).toBe(1);
  });

  it("replaces an overflowing outbox with one full state update", () => {
    const { provider, socket, sent } = makeProvider({ socketOpen: false });
    provider.doc.getText("t").insert(0, "the whole document");

    for (let i = 0; i < 250; i++) provider.sendDocUpdate(new Uint8Array([i % 256]));
    expect(provider.outboxTruncated).toBe(true);

    socket.open = true;
    provider.resendUnacked();

    expect(sent).toHaveLength(1);
    expect(provider.outboxTruncated).toBe(false);
    // Whatever the outbox held, the state it produced is what the peers need.
    const caughtUp = new Y.Doc();
    Y.applyUpdate(caughtUp, new Uint8Array(Buffer.from(sent[0].payload, "base64")));
    expect(caughtUp.getText("t").toString()).toBe("the whole document");
  });

  it("keeps sending live while the outbox is over its cap", () => {
    const { provider, sent } = makeProvider();
    // A relay whose broadcast leg has died still accepts updates; it just stops
    // echoing them. Letting the overflow stop this tab sending would turn a
    // one-way outage into a silent one.
    for (let i = 0; i < 250; i++) provider.sendDocUpdate(new Uint8Array([1]));

    expect(provider.outboxTruncated).toBe(true);
    expect(sent).toHaveLength(250);
    expect(provider.sentThrough).toBe(250);
  });
});

describe("seq gap detection", () => {
  it("pulls the update log and reports when a peer's seq skips", () => {
    const { provider } = makeProvider();
    const resync = vi.spyOn(provider, "scheduleResync").mockImplementation(() => {});

    provider.noteSeq(peerMessage({ seq: 7 }));
    expect(resync).not.toHaveBeenCalled();

    provider.noteSeq(peerMessage({ seq: 9 }));

    expect(resync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportCollabIncident).mock.calls[0][0]).toMatchObject({
      kind: "update_gap",
      projectId: "project-1",
    });
  });

  it("stays quiet for a contiguous run, and for our own echoes", () => {
    const { provider } = makeProvider();
    const resync = vi.spyOn(provider, "scheduleResync").mockImplementation(() => {});

    provider.noteSeq(peerMessage({ seq: 1 }));
    provider.noteSeq(peerMessage({ seq: 2 }));
    provider.noteSeq(peerMessage({ seq: 3 }));
    // Out-of-order delivery of something already seen is not a gap.
    provider.noteSeq(peerMessage({ seq: 2 }));
    provider.noteSeq({ type: "update", sender: provider.sender, seq: 99 });

    expect(resync).not.toHaveBeenCalled();
    expect(reportCollabIncident).not.toHaveBeenCalled();
  });

  it("tracks each peer tab separately", () => {
    const { provider } = makeProvider();
    const resync = vi.spyOn(provider, "scheduleResync").mockImplementation(() => {});

    provider.noteSeq(peerMessage({ sender: "tab-a", seq: 1 }));
    provider.noteSeq(peerMessage({ sender: "tab-b", seq: 8 }));
    provider.noteSeq(peerMessage({ sender: "tab-a", seq: 2 }));

    expect(resync).not.toHaveBeenCalled();
  });
});

describe("compaction bookkeeping", () => {
  const compact = async (provider) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await provider.maybeCompact();
    vi.unstubAllGlobals();
    return fetchMock;
  };

  it("does not claim a row whose content it has not read", () => {
    const { provider } = makeProvider();
    vi.spyOn(provider, "scheduleResync").mockImplementation(() => {});

    provider.receive(
      peerMessage({ id: 10, seq: 1, payload: toBase64(new Y.Doc()) }),
    );
    expect([...provider.appliedUpdateIds]).toEqual([10]);

    // An oversized update is announced, not carried: its content only arrives
    // with the fetch that the announcement schedules.
    provider.receive(peerMessage({ type: "resync", id: 11, seq: 2 }));

    expect(provider.maxSeenUpdateId).toBe(11);
    expect([...provider.appliedUpdateIds]).toEqual([10]);
  });

  it("names the rows it claims one by one, never a range", async () => {
    const { provider } = makeProvider();
    vi.spyOn(provider, "scheduleResync").mockImplementation(() => {});
    provider.receive(
      peerMessage({ id: 10, seq: 1, payload: toBase64(new Y.Doc()) }),
    );
    provider.receive(peerMessage({ type: "resync", id: 11, seq: 2 }));
    provider.updatesSinceCompaction = 50;

    const fetchMock = await compact(provider);

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.merged_update_ids).toEqual([10]);
    expect(body).not.toHaveProperty("through_update_id");
  });

  it("leaves a row it never read out of the claim, whatever its id", async () => {
    const { provider } = makeProvider();
    // The case no other guard here catches: row 10 was the last thing its sender
    // ever sent, so no later `seq` reveals it missing, and nothing in the doc
    // depends on it, so the doc reports itself complete. A high-water mark taken
    // from row 11 would have asked the server to delete row 10 as well.
    provider.receive(
      peerMessage({ id: 11, seq: 1, payload: toBase64(new Y.Doc()) }),
    );
    expect(provider.isDocComplete()).toBe(true);
    provider.updatesSinceCompaction = 50;

    const fetchMock = await compact(provider);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.merged_update_ids).toEqual([11]);
    expect(body.merged_update_ids).not.toContain(10);
  });

  it("stops claiming rows it can no longer name, until a fetch rebuilds the set", async () => {
    const { provider } = makeProvider();
    vi.spyOn(provider, "scheduleResync").mockImplementation(() => {});
    for (let id = 1; id <= 10001; id++) provider.noteApplied(id);
    expect(provider.appliedUpdateIds).toBeNull();

    provider.updatesSinceCompaction = 50;
    expect(await compact(provider)).not.toHaveBeenCalled();

    provider.applyDocInfo({ snapshot: null, updates: [] });
    expect([...provider.appliedUpdateIds]).toEqual([]);
  });

  it("keeps a row that landed while the compaction request was in flight", async () => {
    const { provider } = makeProvider();
    provider.receive(
      peerMessage({ id: 10, seq: 1, payload: toBase64(new Y.Doc()) }),
    );
    provider.updatesSinceCompaction = 50;

    const raced = 11;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        provider.noteApplied(raced);
        return { ok: true };
      }),
    );
    await provider.maybeCompact();
    vi.unstubAllGlobals();

    // 10 was claimed and is gone from the set; 11 was not, so it stays to be
    // claimed next time rather than being dropped on the floor.
    expect([...provider.appliedUpdateIds]).toEqual([raced]);
  });

  it("does not compact a doc that is missing an update", async () => {
    const { provider } = makeProvider();
    const author = new Y.Doc();
    author.getText("t").insert(0, "x");
    const updates = [];
    author.on("update", (update) => updates.push(update));
    author.getText("t").insert(1, "y");
    author.getText("t").insert(2, "z");
    Y.applyUpdate(provider.doc, updates[1]); // the first never arrived

    provider.updatesSinceCompaction = 50;
    provider.noteApplied(42);

    const fetchMock = await compact(provider);

    expect(provider.isDocComplete()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("staying level with the durable log", () => {
  const withStatus = (provider, status) =>
    vi.spyOn(provider, "fetchDocStatus").mockResolvedValue(status);

  const applied = (provider, ids) => {
    for (const id of ids) provider.noteApplied(id);
  };

  const V1 = "2026-09-21T22:00:00.000000Z";
  const V2 = "2026-09-21T22:05:00.000000Z";

  it("is level when the server lists only rows this client applied", async () => {
    const { provider } = makeProvider();
    provider.snapshotVersion = V1;
    applied(provider, [10, 11]);
    withStatus(provider, { seeded: true, snapshot_version: V1, update_ids: [10, 11] });

    expect(await provider.compareWithLog()).toBe("level");
  });

  it("is behind when the server holds a row this client never read", async () => {
    const { provider } = makeProvider();
    // The case `isDocComplete` cannot see: row 10 was the last thing its sender
    // sent, so nothing in the doc depends on it and Yjs has nothing pending.
    // Locally this tab looks perfect; only the server knows otherwise.
    provider.snapshotVersion = V1;
    applied(provider, [11]);
    withStatus(provider, { seeded: true, snapshot_version: V1, update_ids: [10, 11] });

    expect(provider.isDocComplete()).toBe(true);
    expect(await provider.compareWithLog()).toBe("behind");
  });

  it("is behind when a compaction has moved the log into a newer snapshot", async () => {
    const { provider } = makeProvider();
    // Nothing is missing from `update_ids` -- those rows are gone, folded into a
    // snapshot this client has never applied. Checking ids alone would miss it.
    provider.snapshotVersion = V1;
    withStatus(provider, { seeded: true, snapshot_version: V2, update_ids: [] });

    expect(await provider.compareWithLog()).toBe("behind");
  });

  it("is behind when it can no longer name the rows it applied", async () => {
    const { provider } = makeProvider();
    provider.snapshotVersion = V1;
    provider.appliedUpdateIds = null;
    withStatus(provider, { seeded: true, snapshot_version: V1, update_ids: [10] });

    expect(await provider.compareWithLog()).toBe("behind");
  });

  it("is level against a doc nobody has seeded yet", async () => {
    const { provider } = makeProvider();
    withStatus(provider, { seeded: false, snapshot_version: null, update_ids: [] });

    expect(await provider.compareWithLog()).toBe("level");
  });

  it("says it cannot tell, rather than behind, when the check itself fails", async () => {
    const { provider } = makeProvider();
    vi.spyOn(provider, "fetchDocStatus").mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await provider.compareWithLog()).toBe("unknown");
  });

  it("does not fetch the whole document because the status check failed", async () => {
    const { provider } = makeProvider();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(provider, "fetchDocStatus").mockRejectedValue(new Error("offline"));
    const fullFetch = vi.spyOn(provider, "fetchAndApply").mockResolvedValue(undefined);

    // The repair for being behind is the most expensive request here. Spending
    // it because the cheap one failed would mean doing so on every autosave tick
    // for as long as the network stayed unhappy -- on a book-shaped document,
    // most of a megabyte every ten seconds, at the worst possible moment.
    expect(await provider.catchUpWithLog()).toBe(false);
    expect(fullFetch).not.toHaveBeenCalled();
  });

  it("catches up by resyncing, then re-checks against a fresh answer", async () => {
    const { provider } = makeProvider();
    provider.snapshotVersion = V1;
    const resync = vi.spyOn(provider, "resyncNow").mockImplementation(async () => {
      provider.noteApplied(10);
    });
    const status = withStatus(provider, {
      seeded: true,
      snapshot_version: V1,
      update_ids: [10],
    });

    expect(await provider.catchUpWithLog()).toBe(true);
    expect(resync).toHaveBeenCalledOnce();
    // Twice, not once: a compaction can land while the resync is in flight, and
    // judging the result by the stale answer would misreport a current client.
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("reports failure when the resync does not close the gap", async () => {
    const { provider } = makeProvider();
    vi.spyOn(provider, "resyncNow").mockResolvedValue(undefined);
    withStatus(provider, { seeded: true, snapshot_version: V2, update_ids: [] });

    expect(await provider.catchUpWithLog()).toBe(false);
  });

  it("records the snapshot version it applied, so it can tell it is current", () => {
    const { provider } = makeProvider();

    provider.applyDocInfo({
      snapshot: toBase64(new Y.Doc()),
      snapshot_version: V2,
      updates: [],
    });

    expect(provider.snapshotVersion).toBe(V2);
  });
});

describe("a session that loses an update", () => {
  const VERSION = "2026-09-21T22:00:00.000000Z";

  /**
   * Two real providers over a relay that can be told to lose one message, and a
   * durable log that keeps everything -- which is the shape of the failure this
   * module exists for. Nothing here is mocked except the transport itself.
   */
  const makeSession = () => {
    const rows = [];
    const clients = [];
    let nextId = 100;
    let lost = null;
    let swallowed = null;
    let snapshot = null;

    // What `loadOrSeed` does for real: the seed becomes the server's snapshot,
    // which is how a client joining later gets it.
    const seedSession = (build) => {
      const doc = new Y.Doc();
      build(doc);
      const update = Y.encodeStateAsUpdate(doc);
      snapshot = Buffer.from(update).toString("base64");
      for (const client of clients) Y.applyUpdate(client.doc, update, client);
    };

    const relay = (message) => {
      for (const client of clients) {
        const authored = message.sender === client.sender;
        const drop =
          !authored && lost && message.sender === lost.sender && message.seq === lost.seq;
        if (!drop) client.receive(message);
      }
    };

    const join = async () => {
      const provider = new YCableProvider({
        projectId: "p",
        csrfToken: "c",
        user: { name: "u", color: "#000000" },
      });
      provider.ready = true;
      provider.subscription = {
        perform: (action, data) => {
          if (action === "doc_update") {
            const gone =
              swallowed &&
              data.sender === swallowed.sender &&
              data.seq === swallowed.seq;
            // A socket that buffered the bytes and then died: ActionCable
            // reported success and the server never heard of it.
            if (gone) return true;
            // The log records it even when the relay will not carry it.
            const row = { id: nextId++, payload: data.payload };
            rows.push(row);
            relay({ type: "update", ...row, sender: data.sender, seq: data.seq });
          }
          return true;
        },
      };
      provider.doc.on("update", (update, origin) => {
        if (origin === provider) return;
        provider.sendDocUpdate(update);
      });
      provider.fetchDocInfo = async () => ({
        seeded: true,
        snapshot_version: VERSION,
        snapshot,
        updates: rows.map((row) => ({ ...row })),
      });
      provider.fetchDocStatus = async () => ({
        seeded: true,
        snapshot_version: VERSION,
        update_ids: rows.map((row) => row.id),
      });
      clients.push(provider);
      await provider.fetchAndApply();
      return provider;
    };

    return {
      join,
      rows,
      seedSession,
      lose: (provider, seq) => { lost = { sender: provider.sender, seq }; },
      swallow: (provider, seq) => { swallowed = { sender: provider.sender, seq }; },
      reconnect: () => { swallowed = null; lost = null; },
    };
  };

  it("leaves the peer silently stale, then heals it from the log", async () => {
    const session = makeSession();
    const author = await session.join();
    const peer = await session.join();

    session.seedSession((doc) => doc.getText("t").insert(0, "x = 5"));

    // The author replaces a number and stops. The relay loses the second of the
    // two updates -- the insert, and the last thing this tab ever sends.
    session.lose(author, 2);
    author.doc.getText("t").delete(4, 1);
    author.doc.getText("t").insert(4, "7");

    expect(author.doc.getText("t").toString()).toBe("x = 7");
    // The reported symptom, exactly: the deletion stuck, the replacement did not.
    expect(peer.doc.getText("t").toString()).toBe("x = ");

    // And nothing local gives the peer any reason to doubt itself. No later
    // `seq` arrives to be missing, and nothing in its document depends on the
    // update it lacks, so Yjs has nothing pending.
    expect(peer.isDocComplete()).toBe(true);
    expect(session.rows).toHaveLength(2);
    expect(peer.appliedUpdateIds.size).toBe(1);

    // The server is the only witness left, so ask it.
    expect(await peer.compareWithLog()).toBe("behind");
    expect(await peer.catchUpWithLog()).toBe(true);
    expect(peer.doc.getText("t").toString()).toBe("x = 7");
  });

  it("re-sends an update the socket accepted but never delivered", async () => {
    const session = makeSession();
    const author = await session.join();
    const peer = await session.join();
    session.seedSession((doc) => doc.getText("t").insert(0, "x = 5"));

    // `perform` says true, the bytes sit in the socket's buffer, the connection
    // dies. Nobody is told, and the server never learns the update existed.
    session.swallow(author, 2);
    author.doc.getText("t").delete(4, 1);
    author.doc.getText("t").insert(4, "7");

    expect(author.doc.getText("t").toString()).toBe("x = 7");
    expect(peer.doc.getText("t").toString()).toBe("x = ");
    // Not even the durable log has it, so no amount of fetching would help.
    expect(session.rows).toHaveLength(1);
    expect(author.outbox.map((m) => m.seq)).toEqual([2]);

    // The reconnect is the only thing that can save it.
    session.reconnect();
    author.resendUnacked();

    expect(session.rows).toHaveLength(2);
    expect(peer.doc.getText("t").toString()).toBe("x = 7");
    expect(author.outbox).toEqual([]);
  });

  it("carries the author's edits to a peer that joins after the drop", async () => {
    const session = makeSession();
    const author = await session.join();
    const peer = await session.join();

    session.seedSession((doc) => doc.getText("t").insert(0, "x = 5"));

    session.lose(author, 1);
    author.doc.getText("t").insert(5, "!");

    // A latecomer reads the log rather than the relay, so a message the relay
    // lost never reaches it as a gap in the first place.
    const latecomer = await session.join();
    expect(latecomer.doc.getText("t").toString()).toBe(author.doc.getText("t").toString());
    expect(await latecomer.compareWithLog()).toBe("level");
    expect(peer.doc.getText("t").toString()).not.toBe(author.doc.getText("t").toString());
  });
});

const toBase64 = (doc) =>
  Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");

describe("leader election", () => {
  /** Put this tab in a given state and publish it, the way the real hooks do. */
  const setSelf = (provider, { visible = true, active = false, stalled = false } = {}) => {
    vi.stubGlobal("document", { visibilityState: visible ? "visible" : "hidden" });
    provider.lastLocalEditAt = active ? Date.now() : 0;
    provider.relayStatus = stalled ? "stalled" : "ready";
    provider.publishWriterState();
  };

  /** Add a peer to this tab's awareness, as a real awareness update would. */
  const joinPeer = (provider, clientID, writer) => {
    const peerDoc = new Y.Doc();
    peerDoc.clientID = clientID;
    const peerAwareness = new Awareness(peerDoc);
    // Every real peer publishes a `user` (the bridge sets it on attach), which
    // is also what moves its awareness clock off the 0 that
    // `applyAwarenessUpdate` declines to accept.
    peerAwareness.setLocalStateField("user", { name: "Peer", color: "#999999" });
    if (writer) peerAwareness.setLocalStateField("writer", writer);
    applyAwarenessUpdate(
      provider.awareness,
      encodeAwarenessUpdate(peerAwareness, [clientID]),
      "test",
    );
    clearInterval(peerAwareness._checkInterval);
  };

  const lowerId = (provider) => provider.awareness.clientID - 1;
  const higherId = (provider) => provider.awareness.clientID + 1;

  afterEach(() => vi.unstubAllGlobals());

  it("prefers a foreground tab to a background one, whatever the clientIDs say", () => {
    const { provider } = makeProvider();
    setSelf(provider, { visible: true });
    // Lower clientID used to win outright; it is now only the tie-break.
    joinPeer(provider, lowerId(provider), { visible: false, active: false, stalled: false });

    expect(provider.isLeader()).toBe(true);
  });

  it("stands down when a peer is in the foreground and this tab is not", () => {
    const { provider } = makeProvider();
    setSelf(provider, { visible: false });
    joinPeer(provider, higherId(provider), { visible: true, active: false, stalled: false });

    expect(provider.isLeader()).toBe(false);
  });

  it("prefers the tab being typed in to a window left open beside it", () => {
    const { provider } = makeProvider();
    setSelf(provider, { visible: true, active: true });
    joinPeer(provider, lowerId(provider), { visible: true, active: false, stalled: false });

    expect(provider.isLeader()).toBe(true);
  });

  it("stands down when stalled, even against a background peer", () => {
    const { provider } = makeProvider();
    // A stalled tab is the one least likely to hold the session's current state,
    // so it loses to a healthy tab that is merely slow.
    setSelf(provider, { visible: true, active: true, stalled: true });
    joinPeer(provider, lowerId(provider), { visible: false, active: false, stalled: false });

    expect(provider.isLeader()).toBe(false);
  });

  it("falls back to the clientID to break a tie", () => {
    const equal = { visible: true, active: true, stalled: false };

    const { provider: loses } = makeProvider();
    setSelf(loses, { visible: true, active: true });
    joinPeer(loses, lowerId(loses), equal);
    expect(loses.isLeader()).toBe(false);

    const { provider: wins } = makeProvider();
    setSelf(wins, { visible: true, active: true });
    joinPeer(wins, higherId(wins), equal);
    expect(wins.isLeader()).toBe(true);
  });

  it("leads when it is the only tab, however poor a candidate it is", () => {
    const { provider } = makeProvider();
    setSelf(provider, { visible: false, active: false, stalled: true });

    expect(provider.isLeader()).toBe(true);
  });

  it("ranks a peer that has published nothing as a background tab", () => {
    const { provider } = makeProvider();
    // Mid-join, or running a bundle from before this field existed. Ranking it
    // out of the running would be worse than ranking it roughly.
    setSelf(provider, { visible: false, active: false });
    joinPeer(provider, lowerId(provider), null);
    expect(provider.isLeader()).toBe(false);

    setSelf(provider, { visible: true, active: true });
    expect(provider.isLeader()).toBe(true);
  });

  it("publishes only when its own answer changes", () => {
    const { provider } = makeProvider();
    const published = vi.spyOn(provider.awareness, "setLocalStateField");

    setSelf(provider, { visible: true });
    expect(published).toHaveBeenCalledTimes(1);

    // Keystrokes land here on the hot path, so a no-op has to stay a no-op.
    provider.publishWriterState();
    provider.publishWriterState();
    expect(published).toHaveBeenCalledTimes(1);

    setSelf(provider, { visible: false });
    expect(published).toHaveBeenCalledTimes(2);
    expect(published.mock.calls[1]).toEqual([
      "writer",
      { visible: false, active: false, stalled: false },
    ]);
  });
});
