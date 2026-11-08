import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  seedDocFromState,
  docToState,
  getAssetText,
  getDivisionText,
  getDivisionsMap,
  getSnippetText,
  markDeleted,
} from "../collab/schema";
import { diffReplace } from "../collab/textDiff";
import { CollabBridge } from "../collab/bridge";
import type { CollabInvariantViolation } from "../collab/types";
import { createEditorStore, selectOpenDivisionId } from "../store/editorStore";
import { Awareness } from "y-protocols/awareness";
import type { CollabSession } from "../collab/types";
import type { Division } from "../types/sections";
import type { Asset, Exercise, Snippet } from "../types/editor";
import { legacyDivisions } from "./legacyDivision";

const DIVISIONS: Division[] = legacyDivisions([
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
]);

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
    language: "en-US",
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

  it("seeds and round-trips snippets", () => {
    const doc = new Y.Doc();
    seedDocFromState(doc, {
      ...seedState(),
      snippets: [{ id: "snip-1", ref: "note", title: "A note", source: "<p>Hi.</p>", sourceFormat: "pretext" }],
    });
    const state = docToState(doc);
    expect(state.snippets).toHaveLength(1);
    expect(state.snippets[0]).toMatchObject({
      id: "snip-1",
      ref: "note",
      title: "A note",
      source: "<p>Hi.</p>",
      sourceFormat: "pretext",
    });
    expect(getSnippetText(doc, "snip-1")).toBeInstanceOf(Y.Text);
  });

  it("merges concurrent edits to one snippet's and one asset's source", () => {
    const docA = new Y.Doc();
    seedDocFromState(docA, {
      ...seedState(),
      snippets: [{ id: "snip-1", ref: "note", source: "<p>Hi.</p>", sourceFormat: "pretext" }],
      assets: [{ id: "asset-1", ref: "plot", title: "Plot", source: "<x/>" }],
    });
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Both peers type before either hears from the other.
    getSnippetText(docA, "snip-1")!.insert(0, "<p>First.</p>");
    const snippetB = getSnippetText(docB, "snip-1")!;
    snippetB.insert(snippetB.length, "<p>Last.</p>");
    getAssetText(docA, "asset-1")!.insert(0, "<a/>");
    getAssetText(docB, "asset-1")!.insert(4, "<b/>");
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    for (const doc of [docA, docB]) {
      const state = docToState(doc);
      expect(state.snippets[0].source).toBe("<p>First.</p><p>Hi.</p><p>Last.</p>");
      expect(state.assets[0].source).toBe("<a/><x/><b/>");
    }
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
    expect(selectOpenDivisionId(storeB.store.getState())).toBe("sec-a-renamed");

    bridgeA.localDivisionRemove("sec-a-renamed");
    expect(
      storeB.store.getState().divisions?.some((d) => d.xmlId === "sec-a-renamed"),
    ).toBe(false);
    // Active falls back to the root rather than pointing at a ghost.
    expect(selectOpenDivisionId(storeB.store.getState())).toBe("doc-root");
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

    bridgeA.localAssetUpdate({ ...asset, source: "<description>d</description>" });
    expect(
      storeB.store.getState().projectAssets?.find((a) => a.ref === "diagram")?.source,
    ).toContain("description");

    bridgeA.localAssetUpdate({ ...asset, shortDescription: "A diagram of the process" });
    expect(
      storeB.store.getState().projectAssets?.find((a) => a.ref === "diagram")?.shortDescription,
    ).toBe("A diagram of the process");

    bridgeA.localAssetRemove(asset);
    expect(storeB.store.getState().projectAssets ?? []).toHaveLength(0);
  });

  // Mirrors "mirrors asset adds, edits and removals" above for snippets, whose
  // bridge methods are a structural copy of the asset ones.
  it("mirrors snippet adds, edits and removals", () => {
    const { bridgeA, storeA, storeB } = makeLinkedPair();
    const snippet: Snippet = {
      id: "snippet-1",
      ref: "note",
      source: "<p>A note.</p>",
      sourceFormat: "pretext",
    };
    storeA.store.getState().addSnippetToPool(snippet);
    bridgeA.localSnippetAdd(snippet);

    const remote = storeB.store
      .getState()
      .projectSnippets?.find((s) => s.ref === "note");
    expect(remote?.id).toBe("snippet-1");
    expect(remote?.source).toBe("<p>A note.</p>");

    bridgeA.localSnippetUpdate({ ...snippet, title: "A note", source: "<p>Updated.</p>" });
    const updated = storeB.store.getState().projectSnippets?.find((s) => s.ref === "note");
    expect(updated?.source).toBe("<p>Updated.</p>");
    expect(updated?.title).toBe("A note");

    bridgeA.localSnippetRemove(snippet);
    expect(storeB.store.getState().projectSnippets ?? []).toHaveLength(0);
  });

  // A snippet's and an asset's source are edited in the code editor like a
  // division's, so they are shared text, not a last-writer-wins field.
  it("mirrors a snippet's source through shared text", () => {
    const { bridgeA, bridgeB, storeA, storeB } = makeLinkedPair();
    const snippet: Snippet = {
      id: "snippet-1",
      ref: "note",
      source: "<p>A note.</p>",
      sourceFormat: "pretext",
    };
    storeA.store.getState().addSnippetToPool(snippet);
    bridgeA.localSnippetAdd(snippet);
    const textB = bridgeB.getRecordText("snippet", "note");
    expect(textB).toBeInstanceOf(Y.Text);
    expect(textB?.toString()).toBe("<p>A note.</p>");

    // A local source change reaches the peer's pool through the text.
    bridgeA.localRecordSourceChange("snippet", "note", "<p>A longer note.</p>");
    expect(
      storeB.store.getState().projectSnippets?.find((sn) => sn.ref === "note")?.source,
    ).toBe("<p>A longer note.</p>");

    // A metadata edit leaves the text object in place, so an editor bound to
    // it stays bound and concurrent typing isn't overwritten.
    bridgeA.localSnippetUpdate({
      ...snippet,
      source: "<p>A longer note.</p>",
      sourceFormat: "latex",
    });
    expect(bridgeB.getRecordText("snippet", "note")).toBe(textB);
    expect(
      storeB.store.getState().projectSnippets?.find((sn) => sn.ref === "note")?.sourceFormat,
    ).toBe("latex");
  });

  // `bump` re-renders the editor so it can look a ref's shared text up again.
  // Only adding, removing or renaming a record can change that lookup — a
  // peer's typing must not re-render the whole editor per keystroke.
  it("re-renders on a snippet's add or rename, not on a peer's typing", () => {
    const { bridgeA, bridgeB, storeA } = makeLinkedPair();
    const snippet: Snippet = {
      id: "snippet-1",
      ref: "note",
      source: "<p>A note.</p>",
      sourceFormat: "pretext",
    };
    const asset: Asset = { id: "asset-1", ref: "plot", title: "Plot", source: "a" };
    let version = bridgeB.getVersion();
    const bumped = () => {
      const changed = bridgeB.getVersion() !== version;
      version = bridgeB.getVersion();
      return changed;
    };

    storeA.store.getState().addSnippetToPool(snippet);
    bridgeA.localSnippetAdd(snippet);
    storeA.store.getState().addAssetToPool(asset);
    bridgeA.localAssetAdd(asset);
    expect(bumped()).toBe(true);

    bridgeA.localRecordSourceChange("snippet", "note", "<p>Typed.</p>");
    bridgeA.localRecordSourceChange("asset", "plot", "b");
    bridgeA.localSnippetUpdate({ ...snippet, sourceFormat: "latex" });
    expect(bumped()).toBe(false);

    bridgeA.localSnippetUpdate({ ...snippet, ref: "memo" }, "note");
    expect(bumped()).toBe(true);
  });

  it("mirrors an asset's source through shared text", () => {
    const { bridgeA, bridgeB, storeA, storeB } = makeLinkedPair();
    const asset: Asset = {
      id: "asset-1",
      ref: "plot",
      title: "Plot",
      source: "<latex-image>a</latex-image>",
    };
    storeA.store.getState().addAssetToPool(asset);
    bridgeA.localAssetAdd(asset);
    expect(bridgeB.getRecordText("asset", "plot")?.toString()).toBe(
      "<latex-image>a</latex-image>",
    );

    bridgeA.localRecordSourceChange("asset", "plot", "<latex-image>b</latex-image>");
    expect(
      storeB.store.getState().projectAssets?.find((a) => a.ref === "plot")?.source,
    ).toBe("<latex-image>b</latex-image>");
  });

  // The pool keys on ref, the doc on record id, so a rename has to move
  // the pool entry rather than leave the old ref behind as a duplicate.
  it("mirrors a snippet ref rename without duplicating the pool entry", () => {
    const { bridgeA, storeA, storeB } = makeLinkedPair();
    const snippet: Snippet = { id: "snippet-2", ref: "old-ref", source: "", sourceFormat: "pretext" };
    storeA.store.getState().addSnippetToPool(snippet);
    bridgeA.localSnippetAdd(snippet);

    const renamed = { ...snippet, ref: "new-ref" };
    bridgeA.localSnippetUpdate(renamed, "old-ref");

    const pool = storeB.store.getState().projectSnippets ?? [];
    expect(pool).toHaveLength(1);
    expect(pool[0].ref).toBe("new-ref");
  });

  // The pool keys on ref, the doc on record id, so a rename has to move
  // the pool entry rather than leave the old ref behind as a duplicate.
  it("mirrors an asset ref rename without duplicating the pool entry", () => {
    const { bridgeA, storeA, storeB } = makeLinkedPair();
    const asset: Asset = { id: "asset-2", ref: "old-ref", title: "T" };
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
    const asset: Asset = { id: "asset-3", ref: "gone", title: "Gone" };
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
      language: "en-US",
      divisions: structuredClone(DIVISIONS),
      activeDivisionId: "sec-a",
      projectAssets: [
        { id: "stale-asset", ref: "stale", title: "Stale" },
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

// ── the write boundary ───────────────────────────────────────────────────────
//
// The document accepts any write; the host's rows do not. Each case below is a
// write that reached a production document and stalled its project's saved
// copy, and what the bridge does with it now.

/** A linked pair whose sessions record every violation the bridges report. */
const makeReportingPair = () => {
  const violations: { a: CollabInvariantViolation[]; b: CollabInvariantViolation[] } = { a: [], b: [] };
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  seedDocFromState(docA, seedState());
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), "relay");
  // Relay is manual here, so a test can hold updates back and release them.
  const pending: { toB: Uint8Array[]; toA: Uint8Array[] } = { toB: [], toA: [] };
  docA.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "relay") pending.toB.push(u);
  });
  docB.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "relay") pending.toA.push(u);
  });
  const deliver = () => {
    // Loop: applying an update may make a bridge write a repair, which queues
    // another update for the other side.
    while (pending.toB.length || pending.toA.length) {
      for (const u of pending.toB.splice(0)) Y.applyUpdate(docB, u, "relay");
      for (const u of pending.toA.splice(0)) Y.applyUpdate(docA, u, "relay");
    }
  };
  const storeA = makeStore();
  const storeB = makeStore();
  const bridgeA = new CollabBridge(
    {
      doc: docA,
      awareness: new Awareness(docA),
      user: { name: "A", color: "#111" },
      onInvariantViolation: (v) => violations.a.push(v),
    },
    storeA.store,
  );
  const bridgeB = new CollabBridge(
    {
      doc: docB,
      awareness: new Awareness(docB),
      user: { name: "B", color: "#222" },
      onInvariantViolation: (v) => violations.b.push(v),
    },
    storeB.store,
  );
  bridgeA.attach();
  bridgeB.attach();
  deliver();
  return { docA, docB, storeA, storeB, bridgeA, bridgeB, deliver, violations };
};

const fullAsset: Asset = {
  id: "asset-full",
  ref: "diagram",
  title: "A Diagram",
  shortDescription: "A diagram of the process",
  isFile: true,
  url: "/projects/1/assets/diagram",
  fileRef: "diagram.png",
  extension: "png",
};

describe("CollabBridge write boundary", () => {
  it("leaves every field in place when an update says nothing about them", () => {
    const { bridgeA, storeA, docA } = makeReportingPair();
    storeA.store.getState().addAssetToPool(fullAsset);
    bridgeA.localAssetAdd(fullAsset);

    // What a client handed an all-undefined asset wrote on Nov 4, 2026: every
    // metadata key deleted, leaving `{source: ""}`.
    bridgeA.localAssetUpdate({ id: "asset-full", title: "A Diagram" } as Asset);

    const entry = docA.getMap<Y.Map<unknown>>("assets").get("asset-full")!;
    expect(entry.get("ref")).toBe("diagram");
    expect(entry.get("shortDescription")).toBe("A diagram of the process");
    expect(entry.get("fileRef")).toBe("diagram.png");
    expect(entry.get("isFile")).toBe(true);
  });

  it("writes only the key that changed", () => {
    const { bridgeA, storeA, docA } = makeReportingPair();
    storeA.store.getState().addAssetToPool(fullAsset);
    bridgeA.localAssetAdd(fullAsset);
    const entry = docA.getMap<Y.Map<unknown>>("assets").get("asset-full")!;
    const changed: string[][] = [];
    entry.observe((event) => changed.push([...event.changes.keys.keys()]));

    bridgeA.localAssetUpdate({ ...fullAsset, shortDescription: "A clearer description" });
    bridgeA.localAssetUpdate({ ...fullAsset, shortDescription: "A clearer description" });

    expect(changed).toEqual([["shortDescription"]]);
    expect(entry.get("shortDescription")).toBe("A clearer description");
  });

  it("clears a field only on an explicit null, and never the ref", () => {
    const { bridgeA, storeA, docA } = makeReportingPair();
    storeA.store.getState().addAssetToPool(fullAsset);
    bridgeA.localAssetAdd(fullAsset);

    bridgeA.localAssetUpdate({
      id: "asset-full",
      title: "A Diagram",
      shortDescription: null,
      ref: null,
    } as unknown as Asset);

    const entry = docA.getMap<Y.Map<unknown>>("assets").get("asset-full")!;
    expect(entry.has("shortDescription")).toBe(false);
    expect(entry.get("ref")).toBe("diagram");
  });

  it("refuses a division whose xml:id is not a valid ref, and reports it once", () => {
    const { bridgeA, docA, violations } = makeReportingPair();

    bridgeA.localDivisionAdd({
      id: "spaced-id",
      xmlId: "sec-chapter 1 ",
      title: "Spaced",
      type: "section",
      sourceFormat: "pretext",
      source: "",
    });

    expect(getDivisionsMap(docA).has("spaced-id")).toBe(false);
    expect(violations.a).toHaveLength(1);
    expect(violations.a[0]).toMatchObject({
      kind: "invalid_ref",
      record: "division",
      id: "spaced-id",
      ref: "sec-chapter 1 ",
      operation: "localDivisionAdd",
    });
    expect((violations.a[0] as { stack?: string }).stack).toContain("localDivisionAdd");
  });

  it("refuses an asset, snippet or exercise with an empty or invalid ref", () => {
    const { bridgeA, docA, violations } = makeReportingPair();

    bridgeA.localAssetAdd({ id: "a1", title: "No ref" } as Asset);
    bridgeA.localSnippetAdd({ id: "s1", ref: "", source: "", sourceFormat: "pretext" } as Snippet);
    bridgeA.localExerciseAdd({ id: "e1", ref: "1st-quiz", source: "" } as Exercise);

    expect(docA.getMap("assets").has("a1")).toBe(false);
    expect(docA.getMap("snippets").has("s1")).toBe(false);
    expect(docA.getMap("exercises").has("e1")).toBe(false);
    expect(violations.a.map((v) => v.record)).toEqual(["asset", "snippet", "exercise"]);
  });

  it("refuses a rename to an invalid xml:id and keeps the old one, applying the rest of the edit", () => {
    const { bridgeA, docA, violations } = makeReportingPair();

    bridgeA.localDivisionUpdate("sec-a", { xmlId: "sec a", title: "Renamed anyway" });

    const entry = getDivisionsMap(docA).get("sec-a-id")!;
    expect(entry.get("xmlId")).toBe("sec-a");
    expect(entry.get("title")).toBe("Renamed anyway");
    expect(bridgeA.getYText("sec-a")).toBeDefined();
    expect(violations.a).toHaveLength(1);
    expect(violations.a[0]).toMatchObject({ kind: "invalid_ref", operation: "localDivisionUpdate" });
  });

  // Two collaborators press "add section" with the same id before either has
  // seen the other's. Each tab's local check passes; the document holds both.
  it("settles two divisions created under one xml:id so both stay visible, the same way on every peer", () => {
    const { storeA, storeB, bridgeA, bridgeB, docA, docB, deliver, violations } = makeReportingPair();
    const make = (id: string, title: string) => ({
      id,
      xmlId: "dup",
      title,
      type: "section" as const,
      sourceFormat: "pretext" as const,
      source: `<p>${title}</p>`,
    });
    // Each side adds locally while the relay is held back.
    storeA.store.getState().addDivisionToPool(make("id-1", "From A"));
    bridgeA.localDivisionAdd(make("id-1", "From A"));
    storeB.store.getState().addDivisionToPool(make("id-2", "From B"));
    bridgeB.localDivisionAdd(make("id-2", "From B"));

    deliver();

    // The lower record id keeps the xml:id on both sides; the other is renamed
    // in the document, not dropped.
    for (const doc of [docA, docB]) {
      expect(getDivisionsMap(doc).get("id-1")!.get("xmlId")).toBe("dup");
      expect(getDivisionsMap(doc).get("id-2")!.get("xmlId")).toBe("dup-2");
    }
    for (const store of [storeA, storeB]) {
      const divisions = store.store.getState().divisions ?? [];
      expect(divisions.find((d) => d.xmlId === "dup")?.title).toBe("From A");
      expect(divisions.find((d) => d.xmlId === "dup-2")?.title).toBe("From B");
    }
    // Both bridges see the pair, so both report the same repair; the host
    // de-duplicates nothing and need not, since each tab reports once.
    expect(violations.a).toHaveLength(1);
    expect(violations.b).toHaveLength(1);
    expect(violations.a[0]).toMatchObject({ kind: "duplicate_ref", id: "id-2", ref: "dup", renamedTo: "dup-2" });
    expect(violations.b[0]).toMatchObject({ kind: "duplicate_ref", id: "id-2", ref: "dup", renamedTo: "dup-2" });
    // Content follows the record, and text binding works for both.
    expect(bridgeA.getYText("dup-2")?.toString()).toBe("<p>From B</p>");
    expect(bridgeB.getYText("dup")?.toString()).toBe("<p>From A</p>");
  });

  it("settles a remote rename onto an xml:id another division holds", () => {
    const { storeA, bridgeA, bridgeB, docA, deliver } = makeReportingPair();
    const extra = {
      id: "zz-later",
      xmlId: "sec-b",
      title: "Beta",
      type: "section" as const,
      sourceFormat: "pretext" as const,
      source: "",
    };
    storeA.store.getState().addDivisionToPool(extra);
    bridgeA.localDivisionAdd(extra);
    deliver();

    // B renames sec-b onto sec-a while A, unaware, keeps sec-a. "sec-a-id"
    // sorts before "zz-later", so the renamed division loses.
    bridgeB.localDivisionUpdate("sec-b", { xmlId: "sec-a" });
    deliver();

    expect(getDivisionsMap(docA).get("sec-a-id")!.get("xmlId")).toBe("sec-a");
    expect(getDivisionsMap(docA).get("zz-later")!.get("xmlId")).toBe("sec-a-2");
    const xmlIds = (storeA.store.getState().divisions ?? []).map((d) => d.xmlId).sort();
    expect(xmlIds).toEqual(["doc-root", "sec-a", "sec-a-2"]);
    expect(bridgeA.getYText("sec-a-2")).toBeDefined();
    expect(bridgeB.getYText("sec-a-2")).toBeDefined();
  });

  it("settles a pair the document already held when this client attached", () => {
    const docA = new Y.Doc();
    seedDocFromState(docA, {
      ...seedState(),
      divisions: [
        ...seedState().divisions,
        { id: "twin-1", xmlId: "twins", sourceFormat: "pretext", source: "<p>one</p>", title: "One", type: "section" },
        { id: "twin-2", xmlId: "twins", sourceFormat: "pretext", source: "<p>two</p>", title: "Two", type: "section" },
      ],
    });
    const violations: CollabInvariantViolation[] = [];
    const store = makeStore();
    new CollabBridge(
      {
        doc: docA,
        awareness: new Awareness(docA),
        user: { name: "A", color: "#111" },
        onInvariantViolation: (v) => violations.push(v),
      },
      store.store,
    ).attach();

    const divisions = store.store.getState().divisions ?? [];
    expect(divisions.find((d) => d.xmlId === "twins")?.title).toBe("One");
    expect(divisions.find((d) => d.xmlId === "twins-2")?.title).toBe("Two");
    expect(getDivisionsMap(docA).get("twin-2")!.get("xmlId")).toBe("twins-2");
    expect(violations).toHaveLength(1);
  });

  it("never renames onto a ref an asset, snippet or exercise holds", () => {
    const { storeA, storeB, bridgeA, bridgeB, docA, deliver } = makeReportingPair();
    // The obvious free name, dup-2, is an asset's.
    const asset: Asset = { id: "asset-dup", ref: "dup-2", title: "Taken" };
    storeA.store.getState().addAssetToPool(asset);
    bridgeA.localAssetAdd(asset);
    deliver();
    const make = (id: string) => ({
      id,
      xmlId: "dup",
      title: id,
      type: "section" as const,
      sourceFormat: "pretext" as const,
      source: "",
    });
    storeA.store.getState().addDivisionToPool(make("id-1"));
    bridgeA.localDivisionAdd(make("id-1"));
    storeB.store.getState().addDivisionToPool(make("id-2"));
    bridgeB.localDivisionAdd(make("id-2"));

    deliver();

    expect(getDivisionsMap(docA).get("id-2")!.get("xmlId")).toBe("dup-3");
  });
});
