import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  seedDocFromState,
  docToState,
  getDivisionText,
  getDivisionsMap,
  markDeleted,
} from "../collab/schema";
import { diffReplace } from "../collab/textDiff";
import { CollabBridge } from "../collab/bridge";
import { createEditorStore } from "../store/editorStore";
import { Awareness } from "y-protocols/awareness";
import type { CollabSession } from "../collab/types";
import type { Division } from "../types/sections";
import type { Asset } from "../types/editor";

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

  // The whole point of minting the id in the editor: the entry is there for
  // peers in the same tick, with no round trip to wait on.
  it("mirrors division adds synchronously, keyed by the minted id", () => {
    const { bridgeA, storeA, storeB } = makeLinkedPair();
    const division: Division = {
      id: "sec-b-id",
      xmlId: "sec-b",
      title: "Beta",
      type: "section",
      sourceFormat: "pretext",
      source: `<section xml:id="sec-b">\n  <title>Beta</title>\n  <p>New.</p>\n</section>`,
    };
    storeA.store.getState().addDivisionToPool(division);
    bridgeA.localDivisionAdd(division);

    const remote = storeB.store
      .getState()
      .divisions?.find((d) => d.xmlId === "sec-b");
    expect(remote).toBeDefined();
    expect(remote?.id).toBe("sec-b-id");
    expect(remote?.title).toBe("Beta");
  });

  it("ignores a division with no record id", () => {
    const { bridgeA, docA } = makeLinkedPair();
    bridgeA.localDivisionAdd({
      xmlId: "sec-idless",
      title: "Idless",
      type: "section",
      sourceFormat: "pretext",
      source: "<section xml:id=\"sec-idless\"><p>x</p></section>",
    });
    expect(getDivisionText(docA, "sec-idless")).toBeUndefined();
    expect(getDivisionsMap(docA).size).toBe(2);
  });

  // A new division and the parent placeholder that points at it are one edit:
  // a peer must never observe a ref with no division behind it.
  it("applies a transaction's writes to peers as one update", () => {
    const { bridgeA, storeA, storeB } = makeLinkedPair();
    const division: Division = {
      id: "sec-c-id",
      xmlId: "sec-c",
      title: "Gamma",
      type: "section",
      sourceFormat: "pretext",
      source: "<section xml:id=\"sec-c\"><title>Gamma</title></section>",
    };
    const parentSource = `<article xml:id="doc-root">\n  <title>Demo</title>\n  <plus:section ref="sec-a"/>\n  <plus:section ref="sec-c"/>\n</article>`;

    const observed: boolean[] = [];
    const unsubscribe = storeB.store.subscribe((s) => {
      const hasRef = (
        s.divisions?.find((d) => d.xmlId === "doc-root")?.source ?? ""
      ).includes('ref="sec-c"');
      const hasDivision = s.divisions?.some((d) => d.xmlId === "sec-c") ?? false;
      // Record only states where the ref exists, and whether its target does.
      if (hasRef) observed.push(hasDivision);
    });

    bridgeA.transact(() => {
      storeA.store.getState().addDivisionToPool(division);
      bridgeA.localDivisionAdd(division);
      storeA.store.getState().setDivisionContent("doc-root", parentSource);
      bridgeA.localContentChange("doc-root", parentSource);
    });
    unsubscribe();

    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every(Boolean)).toBe(true);
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

  // Assets reach peers through the doc, never through a re-fetch of the host:
  // the host doesn't yet know about an asset another peer just uploaded.
  it("mirrors asset adds, edits and removals", () => {
    const { bridgeA, storeA, storeB } = makeLinkedPair();
    const asset: Asset = {
      id: "asset-1",
      kind: "image",
      ref: "diagram",
      title: "A Diagram",
      isFile: true,
      url: "/projects/1/assets/diagram",
      fileRef: "diagram.png",
    };
    storeA.store.getState().addAssetToPool(asset);
    bridgeA.localAssetAdd(asset);

    const remote = storeB.store
      .getState()
      .projectAssets?.find((a) => a.ref === "diagram");
    expect(remote?.id).toBe("asset-1");
    expect(remote?.fileRef).toBe("diagram.png");

    bridgeA.localAssetUpdate({ ...asset, source: "<shortdescription>d</shortdescription>" });
    expect(
      storeB.store.getState().projectAssets?.find((a) => a.ref === "diagram")?.source,
    ).toContain("shortdescription");

    bridgeA.localAssetRemove(asset);
    expect(storeB.store.getState().projectAssets ?? []).toHaveLength(0);
  });

  // The pool keys on kind+ref, the doc on record id, so a rename has to move
  // the pool entry rather than leave the old ref behind as a duplicate.
  it("mirrors an asset ref rename without duplicating the pool entry", () => {
    const { bridgeA, storeA, storeB } = makeLinkedPair();
    const asset: Asset = { id: "asset-2", kind: "image", ref: "old-ref", title: "T" };
    storeA.store.getState().addAssetToPool(asset);
    bridgeA.localAssetAdd(asset);

    const renamed = { ...asset, ref: "new-ref" };
    bridgeA.localAssetUpdate(renamed, "old-ref");

    const pool = storeB.store.getState().projectAssets ?? [];
    expect(pool).toHaveLength(1);
    expect(pool[0].ref).toBe("new-ref");
  });

  // Replace hands the replacement the old asset's ref before dropping the old
  // record, so two ids briefly claim one ref. Dropping the old one must not
  // take the replacement's pool entry (or ref index) with it.
  it("keeps the replacement when two assets briefly share a ref", () => {
    const { bridgeA, storeA, storeB } = makeLinkedPair();
    const original: Asset = {
      id: "asset-old",
      kind: "image",
      ref: "figure",
      title: "Figure",
      url: "/old.png",
    };
    storeA.store.getState().addAssetToPool(original);
    bridgeA.localAssetAdd(original);

    // The replacement adopts the old ref, then the old record is dropped.
    const replacement: Asset = { ...original, id: "asset-new", url: "/new.png" };
    bridgeA.transact(() => {
      bridgeA.localAssetAdd(replacement);
      bridgeA.localAssetRemove(original);
    });

    const pool = storeB.store.getState().projectAssets ?? [];
    expect(pool).toHaveLength(1);
    expect(pool[0].id).toBe("asset-new");
    expect(pool[0].url).toBe("/new.png");
  });

  // Removing an entry from a Y.Map leaves nothing behind for a later save to
  // act on, so the removal is also recorded as a tombstone.
  it("records tombstones so a delete can be re-sent by the leader", () => {
    const { bridgeA, docA } = makeLinkedPair();
    const asset: Asset = { id: "asset-3", kind: "image", ref: "gone", title: "Gone" };
    bridgeA.localAssetAdd(asset);
    bridgeA.localAssetRemove(asset);
    bridgeA.localDivisionRemove("sec-a");

    const { deleted } = docToState(docA);
    expect(deleted).toEqual(
      expect.arrayContaining([
        { id: "asset-3", kind: "asset" },
        { id: "sec-a-id", kind: "division" },
      ]),
    );
  });

  // A pool seeded from the host's snapshot can list an asset a peer removed
  // before this client joined; the tombstone is what corrects it.
  it("drops a tombstoned asset from the pool at attach", () => {
    const doc = new Y.Doc();
    seedDocFromState(doc, seedState());
    doc.transact(() => markDeleted(doc, "asset", "stale-asset"));

    const store = createEditorStore({
      source: DIVISIONS[1].source,
      sourceFormat: "pretext",
      title: "Demo",
      docinfo: "<docinfo/>",
      commonDocinfo: "",
      useCommonDocinfo: false,
      projectType: "article",
      divisions: structuredClone(DIVISIONS),
      activeDivisionId: "sec-a",
      projectAssets: [
        { id: "stale-asset", kind: "image", ref: "stale", title: "Stale" },
      ],
    });
    new CollabBridge(
      { doc, awareness: new Awareness(doc), user: { name: "A", color: "#111" } },
      store.store,
    ).attach();

    expect(store.store.getState().projectAssets ?? []).toHaveLength(0);
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
