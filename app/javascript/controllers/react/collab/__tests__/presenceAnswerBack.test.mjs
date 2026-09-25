import { describe, it, expect, vi, afterEach } from "vitest";
import * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from "y-protocols/awareness";

// The provider only needs `seedDocFromState` from the editor package, and
// loading that package for real drags in React, Monaco and a stylesheet.
vi.mock("@pretextbook/web-editor", () => ({ seedDocFromState: vi.fn() }));
vi.mock("@rails/actioncable", () => ({ createConsumer: vi.fn() }));
vi.mock("../reportIncident", () => ({ reportCollabIncident: vi.fn() }));

const { YCableProvider } = await import("../yCableProvider.js");

/**
 * Why this exists: yrby-client speaks two y-protocols frame types, Sync and
 * Awareness, and says in its own MessageType that query-awareness is not among
 * them. A client joining an existing session can therefore say who it is, but
 * cannot ask who else is here -- and nothing asks the clients already here to
 * answer. Left alone, a newcomer waits on y-protocols refreshing each peer's
 * own state, which happens only once that state is older than half the 30s
 * expiry and is checked every 3s: up to ~18s of an apparently empty session.
 *
 * `answerNewPeers` closes that to one round trip. These are the tests that it
 * does, and that it settles rather than echoing.
 */

const cleanup = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()();
});

// A provider wired to a real Awareness, with `connect` never called: the
// behaviour under test is driven directly.
const makeClient = (name) => {
  const provider = new YCableProvider({
    projectId: "project-1",
    csrfToken: "csrf",
    user: { name, color: "#123456" },
  });
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  cleanup.push(() => {
    awareness.destroy();
    doc.destroy();
    provider.doc.destroy();
  });

  provider.awareness = awareness;

  // Every frame this client would have put on the wire. Attached before the
  // first `setLocalStateField` below, so the client's own arrival is captured
  // like any other announcement.
  const sent = [];
  awareness.on("update", ({ added, updated, removed }, origin) => {
    const mine = [...added, ...updated, ...removed].filter((id) => id === awareness.clientID);
    if (origin !== "remote" && mine.length) sent.push(encodeAwarenessUpdate(awareness, mine));
  });

  awareness.setLocalStateField("user", provider.user);
  return { provider, awareness, sent };
};

// Hand one client's frames to another, the way the relay would.
const deliver = (frames, to) => {
  frames.splice(0).forEach((frame) => applyAwarenessUpdate(to.awareness, frame, "remote"));
};

const peersSeenBy = (client) =>
  [...client.awareness.getStates().keys()].filter((id) => id !== client.awareness.clientID);

describe("presence for a client joining an established session", () => {
  it("is answered by everyone already there, without waiting for a heartbeat", () => {
    const ada = makeClient("Ada");
    ada.provider.answerNewPeers();
    ada.sent.length = 0; // Ada's own arrival is already old news

    const grace = makeClient("Grace");
    grace.provider.answerNewPeers();

    // Grace announces herself. That is all a joiner can do -- there is no
    // query-awareness frame to send.
    deliver(grace.sent, ada);
    expect(peersSeenBy(ada)).toContain(grace.awareness.clientID);

    // Without the answer back, this is where it would stop and Grace would see
    // nobody until Ada's state aged past ~15s.
    expect(ada.sent.length).toBeGreaterThan(0);

    deliver(ada.sent, grace);
    expect(peersSeenBy(grace)).toContain(ada.awareness.clientID);
    expect(grace.awareness.getStates().get(ada.awareness.clientID).user.name).toBe("Ada");
  });

  it("settles instead of echoing", () => {
    const ada = makeClient("Ada");
    ada.provider.answerNewPeers();
    ada.sent.length = 0;

    const grace = makeClient("Grace");
    grace.provider.answerNewPeers();

    deliver(grace.sent, ada); // Grace arrives, Ada answers
    deliver(ada.sent, grace); // Grace hears Ada, and answers back once
    deliver(grace.sent, ada); // Ada already knows Grace: nothing further

    expect(ada.sent).toHaveLength(0);
    expect(grace.sent).toHaveLength(0);
  });

  it("answers a peer that dropped and came back", () => {
    const ada = makeClient("Ada");
    ada.provider.answerNewPeers();
    ada.sent.length = 0;

    const grace = makeClient("Grace");
    deliver(grace.sent, ada); // arrives, and is answered
    ada.sent.length = 0;

    // The peer goes away. y-protocols removes its state, and ours forgets it --
    // otherwise a reconnecting collaborator would be invisible to the session
    // they just rejoined.
    grace.awareness.setLocalState(null);
    deliver(grace.sent, ada);
    expect(peersSeenBy(ada)).not.toContain(grace.awareness.clientID);
    ada.sent.length = 0;

    // setLocalState, not setLocalStateField: the latter is a no-op once the
    // local state is null, which is what announcing a departure leaves behind.
    grace.awareness.setLocalState({ user: { name: "Grace", color: "#123456" } });
    deliver(grace.sent, ada);

    expect(ada.sent.length).toBeGreaterThan(0);
  });

  it("stays quiet once it has announced its own departure", () => {
    const ada = makeClient("Ada");
    ada.provider.answerNewPeers();
    ada.awareness.setLocalState(null); // leaving
    ada.sent.length = 0;

    const grace = makeClient("Grace");
    deliver(grace.sent, ada);

    // A client on its way out must not re-announce itself back into the
    // session it just left.
    expect(ada.sent).toHaveLength(0);
  });

  it("does not answer its own arrival", () => {
    const ada = makeClient("Ada");
    ada.provider.answerNewPeers();
    ada.sent.length = 0;

    ada.awareness.setLocalStateField("user", { name: "Ada", color: "#abcdef" });

    // One frame, because Ada changed her own state -- not two, which is what a
    // client answering itself would produce.
    expect(ada.sent).toHaveLength(1);
  });
});
