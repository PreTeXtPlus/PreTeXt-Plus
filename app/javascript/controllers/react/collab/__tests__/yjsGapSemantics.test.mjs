import { describe, it, expect } from "vitest";
import * as Y from "yjs";

/**
 * What one lost Yjs update does, in the smallest form that shows it.
 *
 * This is a property of Yjs, not of any transport, which is why it survived the
 * rewrite that deleted the transport it was originally written against. It is
 * the reason the server holds the document and answers a joining client's state
 * vector itself (ProjectDocChannel) instead of relaying opaque bytes and letting
 * each client infer what it might be missing.
 *
 * Read the first test as the specification of the bug: a delete that applies
 * and an insert that does not, so the document reads as though someone removed
 * work and never retyped it. Nothing errors. The author's own tab is correct
 * throughout, so nobody is in a position to notice.
 */

// An author replaces a number while a peer watches, and exactly one of the
// three updates goes missing on the way.
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

describe("a Yjs update that reaches nobody", () => {
  it("applies the author's delete but withholds every later insert", () => {
    const { author, peer } = authorAndPeerWithAGap();

    expect(author.getText("t").toString()).toBe("x = 7!");
    // Not "x = !" -- the "!" is stranded too, because it depends causally on
    // the update that never arrived. One drop silently swallows everything
    // that author types afterwards.
    expect(peer.getText("t").toString()).toBe("x = ");
  });

  it("heals the moment the missing update arrives, however late", () => {
    const { peer, updates } = authorAndPeerWithAGap();
    expect(peer.getText("t").toString()).toBe("x = ");

    Y.applyUpdate(peer, updates[1]);

    // Nothing had to be replayed in order, and nothing was lost -- the stranded
    // insert was held, not discarded. This is what makes answering a state
    // vector a complete repair: hand over what is missing and the rest follows.
    expect(peer.getText("t").toString()).toBe("x = 7!");
  });

  it("is visible in the state vector, which is what the server compares against", () => {
    const { author, peer } = authorAndPeerWithAGap();

    // The peer's own vector does not advertise the updates it is missing, so
    // the diff the server computes from it carries exactly the gap -- no
    // inference, and nothing for a client to get wrong.
    const missing = Y.encodeStateAsUpdate(author, Y.encodeStateVector(peer));
    const repaired = new Y.Doc();
    Y.applyUpdate(repaired, Y.encodeStateAsUpdate(peer));
    Y.applyUpdate(repaired, missing);

    expect(repaired.getText("t").toString()).toBe("x = 7!");
  });
});
