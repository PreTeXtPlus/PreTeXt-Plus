import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";

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
  it("stamps a monotonic seq on each update", () => {
    const { provider, sent } = makeProvider();

    provider.sendDocUpdate(new Uint8Array([1]));
    provider.sendDocUpdate(new Uint8Array([2]));

    expect(sent.map((m) => m.seq)).toEqual([1, 2]);
    expect(sent.every((m) => m.action === "doc_update")).toBe(true);
  });

  it("keeps an update the socket refuses and sends it on reconnect, in order", () => {
    const { provider, socket, sent } = makeProvider({ socketOpen: false });

    provider.sendDocUpdate(new Uint8Array([1]));
    provider.sendDocUpdate(new Uint8Array([2]));
    expect(sent).toEqual([]);

    socket.open = true;
    provider.flushPendingSends();

    expect(sent.map((m) => m.seq)).toEqual([1, 2]);
    expect(sent.map((m) => Buffer.from(m.payload, "base64")[0])).toEqual([1, 2]);
    expect(provider.pendingSends).toEqual([]);
  });

  it("queues behind an undelivered update rather than sending out of order", () => {
    const { provider, socket, sent } = makeProvider({ socketOpen: false });

    provider.sendDocUpdate(new Uint8Array([1]));
    socket.open = true;
    // A seq gap of this tab's own making would send every peer to the update
    // log, so the newer update waits for the older one.
    provider.sendDocUpdate(new Uint8Array([2]));

    expect(sent).toEqual([]);
    provider.flushPendingSends();
    expect(sent.map((m) => m.seq)).toEqual([1, 2]);
  });

  it("keeps what it could not send when the flush is interrupted", () => {
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
    provider.flushPendingSends();

    expect(sent.map((m) => m.seq)).toEqual([1]);
    expect(provider.pendingSends.map((m) => m.seq)).toEqual([2]);
  });

  it("replaces an overflowing queue with one full state update", () => {
    const { provider, socket, sent } = makeProvider({ socketOpen: false });
    provider.doc.getText("t").insert(0, "the whole document");

    for (let i = 0; i < 250; i++) provider.sendDocUpdate(new Uint8Array([i % 256]));
    expect(provider.pendingSends).toEqual([]);
    expect(provider.resendFullState).toBe(true);

    socket.open = true;
    provider.flushPendingSends();

    expect(sent).toHaveLength(1);
    expect(provider.resendFullState).toBe(false);
    // Whatever the queue held, the state it produced is what the peers need.
    const caughtUp = new Y.Doc();
    Y.applyUpdate(caughtUp, new Uint8Array(Buffer.from(sent[0].payload, "base64")));
    expect(caughtUp.getText("t").toString()).toBe("the whole document");
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
  it("does not claim a row whose content it has not read", () => {
    const { provider } = makeProvider();
    vi.spyOn(provider, "scheduleResync").mockImplementation(() => {});

    provider.receive(
      peerMessage({ id: 10, seq: 1, payload: toBase64(new Y.Doc()) }),
    );
    expect(provider.maxAppliedUpdateId).toBe(10);

    // An oversized update is announced, not carried: its content only arrives
    // with the fetch that the announcement schedules.
    provider.receive(peerMessage({ type: "resync", id: 11, seq: 2 }));

    expect(provider.maxSeenUpdateId).toBe(11);
    expect(provider.maxAppliedUpdateId).toBe(10);
  });

  it("offers the applied id, not the announced one", async () => {
    const { provider } = makeProvider();
    vi.spyOn(provider, "scheduleResync").mockImplementation(() => {});
    provider.receive(
      peerMessage({ id: 10, seq: 1, payload: toBase64(new Y.Doc()) }),
    );
    provider.receive(peerMessage({ type: "resync", id: 11, seq: 2 }));
    provider.updatesSinceCompaction = 50;

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await provider.maybeCompact();
    vi.unstubAllGlobals();

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.through_update_id).toBe(10);
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
    provider.maxAppliedUpdateId = 42;

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await provider.maybeCompact();
    vi.unstubAllGlobals();

    expect(provider.isDocComplete()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const toBase64 = (doc) =>
  Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
