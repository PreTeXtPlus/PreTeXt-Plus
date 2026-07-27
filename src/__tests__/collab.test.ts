import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  seedDocFromState,
  docToState,
  getDivisionText,
  getDivisionsMap,
} from "../collab/schema";
import { diffReplace } from "../collab/textDiff";
import { CollabBridge } from "../collab/bridge";
import { createEditorStore } from "../store/editorStore";
import { Awareness } from "y-protocols/awareness";
import type { CollabSession } from "../collab/types";
import type { Division } from "../types/sections";

const DIVISIONS: Division[] = [
  {
    id: "root-id",
    xmlId: "doc-root",
    title: "Demo",
    type: "article",
    sourceFormat: "pretext",
    source: `<article xml:id="doc-root">\n  <title>Demo</title>\n  <plus:section ref="sec-a"/>\n</article>`,
  },
  {
    id: "sec-a-id",
    xmlId: "sec-a",
    title: "Alpha",
    type: "section",
    sourceFormat: "pretext",
    source: `<section xml:id="sec-a">\n  <title>Alpha</title>\n  <p>Hello.</p>\n</section>`,
  },
];

const seedState = () => ({
  title: "Demo",
  docinfo: "<docinfo/>",
  divisions: DIVISIONS.map((d) => ({
    id: d.id!,
    xmlId: d.xmlId,
    sourceFormat: d.sourceFormat,
    source: d.source,
    title: d.title,
    type: d.type,
  })),
});

const makeStore = () =>
  createEditorStore({
    source: DIVISIONS[1].source,
    sourceFormat: "pretext",
    title: "Demo",
    docinfo: "<docinfo/>",
    commonDocinfo: "",
    useCommonDocinfo: false,
    projectType: "article",
    divisions: structuredClone(DIVISIONS),
    activeDivisionId: "sec-a",
    projectAssets: undefined,
  });

/** Two docs relayed to each other, with attached bridges over real stores. */
const makeLinkedPair = () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  seedDocFromState(docA, seedState());
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), "relay");
  docA.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "relay") Y.applyUpdate(docB, u, "relay");
  });
  docB.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "relay") Y.applyUpdate(docA, u, "relay");
  });

  const storeA = makeStore();
  const storeB = makeStore();
  const sessionA: CollabSession = {
    doc: docA,
    awareness: new Awareness(docA),
    user: { name: "A", color: "#111" },
  };
  const sessionB: CollabSession = {
    doc: docB,
    awareness: new Awareness(docB),
    user: { name: "B", color: "#222" },
  };
  const bridgeA = new CollabBridge(sessionA, storeA.store);
  const bridgeB = new CollabBridge(sessionB, storeB.store);
  bridgeA.attach();
  bridgeB.attach();
  return { docA, docB, storeA, storeB, bridgeA, bridgeB };
};

describe("collab schema", () => {
  it("seed → docToState round-trips", () => {
    const doc = new Y.Doc();
    seedDocFromState(doc, seedState());
    const state = docToState(doc);
    expect(state.title).toBe("Demo");
    expect(state.docinfo).toBe("<docinfo/>");
    expect(state.divisions).toHaveLength(2);
    const secA = state.divisions.find((d) => d.id === "sec-a-id");
    expect(secA?.xmlId).toBe("sec-a");
    expect(secA?.source).toContain("<p>Hello.</p>");
  });
});

describe("diffReplace", () => {
  const roundTrip = (before: string, after: string) => {
    const doc = new Y.Doc();
    const ytext = doc.getText("t");
    ytext.insert(0, before);
    doc.transact(() => diffReplace(ytext, after));
    return ytext.toString();
  };

  it("handles inserts, deletes, and replacements", () => {
    expect(roundTrip("hello world", "hello brave world")).toBe(
      "hello brave world",
    );
    expect(roundTrip("hello brave world", "hello world")).toBe("hello world");
    expect(roundTrip("abc", "xyz")).toBe("xyz");
    expect(roundTrip("", "content")).toBe("content");
    expect(roundTrip("content", "")).toBe("");
    expect(roundTrip("same", "same")).toBe("same");
  });

  it("preserves concurrent edits outside the replaced span", () => {
    // Client 1 rewrites the middle of the text while client 2 types at the
    // end; both must survive the merge.
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    doc1.getText("t").insert(0, "alpha MIDDLE omega");
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

    doc1.transact(() => diffReplace(doc1.getText("t"), "alpha CENTER omega"));
    doc2.getText("t").insert(18, " tail");

    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1, Y.encodeStateVector(doc2)));
    Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2, Y.encodeStateVector(doc1)));
    expect(doc1.getText("t").toString()).toBe(doc2.getText("t").toString());
    expect(doc1.getText("t").toString()).toBe("alpha CENTER omega tail");
  });
});

describe("CollabBridge", () => {
  it("mirrors local content changes to the remote store", () => {
    const { bridgeA, storeA, storeB } = makeLinkedPair();
    const next = `<section xml:id="sec-a">\n  <title>Alpha</title>\n  <p>Hello, collaborative world.</p>\n</section>`;
    // Same order as emitContentChange: store first, then bridge write-through.
    storeA.store.getState().setDivisionContent("sec-a", next);
    bridgeA.localContentChange("sec-a", next);

    const remote = storeB.store
      .getState()
      .divisions?.find((d) => d.xmlId === "sec-a");
    expect(remote?.source).toBe(next);
  });

  it("mirrors division adds (with host id) both ways", async () => {
    const { bridgeA, storeA, storeB } = makeLinkedPair();
    const division: Division = {
      xmlId: "sec-b",
      title: "Beta",
      type: "section",
      sourceFormat: "pretext",
      source: `<section xml:id="sec-b">\n  <title>Beta</title>\n  <p>New.</p>\n</section>`,
    };
    storeA.store.getState().addDivisionToPool(division);
    bridgeA.localDivisionAdd(division, Promise.resolve("sec-b-id"));
    await Promise.resolve(); // let the id promise settle
    await Promise.resolve();

    const remote = storeB.store
      .getState()
      .divisions?.find((d) => d.xmlId === "sec-b");
    expect(remote).toBeDefined();
    expect(remote?.id).toBe("sec-b-id");
    expect(remote?.title).toBe("Beta");
  });

  it("skips the doc entry when the host id promise rejects", async () => {
    const { bridgeA, docA } = makeLinkedPair();
    const division: Division = {
      xmlId: "sec-fail",
      title: "Fail",
      type: "section",
      sourceFormat: "pretext",
      source: "<section xml:id=\"sec-fail\"><p>x</p></section>",
    };
    bridgeA.localDivisionAdd(division, Promise.reject(new Error("save failed")));
    await Promise.resolve();
    await Promise.resolve();
    expect(getDivisionText(docA, "sec-fail")).toBeUndefined();
    expect(getDivisionsMap(docA).size).toBe(2);
  });

  it("mirrors removes and renames, following the active division", async () => {
    const { bridgeA, storeB } = makeLinkedPair();

    // Rename sec-a remotely (from A's perspective, B is remote).
    bridgeA.localDivisionUpdate("sec-a", { xmlId: "sec-a-renamed", title: "Alpha!" });
    const renamed = storeB.store
      .getState()
      .divisions?.find((d) => d.xmlId === "sec-a-renamed");
    expect(renamed).toBeDefined();
    expect(renamed?.title).toBe("Alpha!");
    // B was viewing sec-a; it must follow the rename.
    expect(storeB.store.getState().activeDivisionId).toBe("sec-a-renamed");

    bridgeA.localDivisionRemove("sec-a-renamed");
    expect(
      storeB.store.getState().divisions?.some((d) => d.xmlId === "sec-a-renamed"),
    ).toBe(false);
    // Active falls back to the root rather than pointing at a ghost.
    expect(storeB.store.getState().activeDivisionId).toBe("doc-root");
  });

  it("mirrors title and docinfo, and does not echo local changes back", () => {
    const { bridgeA, bridgeB, storeA, storeB } = makeLinkedPair();
    bridgeA.localTitleChange("Renamed Demo");
    bridgeA.localDocinfoChange("<docinfo><macros>x</macros></docinfo>", true);

    expect(storeB.store.getState().title).toBe("Renamed Demo");
    expect(storeB.store.getState().docinfo).toContain("macros");
    expect(storeB.store.getState().useCommonDocinfo).toBe(true);

    // A's own store was set by its UI before the bridge call; the bridge must
    // not have overwritten it via its own observer (origin filtering).
    expect(storeA.store.getState().title).toBe("Demo");
    void bridgeB;
  });

  it("reconciles a doc that is ahead of the store at attach", () => {
    const docA = new Y.Doc();
    seedDocFromState(docA, seedState());
    // The doc advanced (another client edited) before this client attached.
    const ytext = getDivisionText(docA, "sec-a-id")!;
    docA.transact(() => diffReplace(ytext, "<section xml:id=\"sec-a\"><p>ahead</p></section>"));

    const store = makeStore();
    const bridge = new CollabBridge(
      { doc: docA, awareness: new Awareness(docA), user: { name: "A", color: "#111" } },
      store.store,
    );
    bridge.attach();

    expect(
      store.store.getState().divisions?.find((d) => d.xmlId === "sec-a")?.source,
    ).toContain("ahead");
  });
});
