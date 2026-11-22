/**
 * The editor's tabs: a list of open items in the store, of which `openItem`
 * is the active one. Opening a snippet or asset while writing a division adds
 * a tab; walking the table of contents does not.
 */
import { describe, it, expect } from "vitest";
import { createEditorStore, type OpenItem } from "../store/editorStore";
import type { Division } from "../types/sections";
import type { Asset, Snippet } from "../types/editor";
import { legacyDivisions } from "./legacyDivision";

const divisions: Division[] = legacyDivisions([
  {
    id: "1",
    xmlId: "doc",
    title: "Doc",
    type: "article",
    sourceFormat: "pretext",
    source:
      '<article xml:id="doc"><title>Doc</title><plus:section ref="sec"/><plus:section ref="other"/></article>',
  },
  {
    id: "2",
    xmlId: "sec",
    title: "Sec",
    type: "section",
    sourceFormat: "pretext",
    source: '<section xml:id="sec"><title>Sec</title></section>',
  },
  {
    id: "3",
    xmlId: "other",
    title: "Other",
    type: "section",
    sourceFormat: "pretext",
    source: '<section xml:id="other"><title>Other</title></section>',
  },
]);
const snippet: Snippet = { id: "s1", ref: "greeting", source: "<p>Hi</p>", sourceFormat: "pretext" };
const asset: Asset = { id: "a1", ref: "fig", title: "Figure", isFile: true };

const div = (ref: string): OpenItem => ({ kind: "division", ref });
const snip = (ref: string): OpenItem => ({ kind: "snippet", ref });
const img = (ref: string): OpenItem => ({ kind: "asset", ref });

function makeStore(activeDivisionId: string | null = "sec") {
  const { store } = createEditorStore({
    source: "",
    sourceFormat: "pretext",
    title: "Doc",
    docinfo: "",
    commonDocinfo: "",
    useCommonDocinfo: false,
    language: "en-US",
    divisions,
    activeDivisionId,
    projectAssets: [asset],
    projectSnippets: [snippet],
  });
  store.getState().syncState({ rootDivisionId: "doc" });
  return store;
}

/** The items the tabs name, in order — without the drawer state they keep. */
const tabItems = (store: ReturnType<typeof makeStore>): OpenItem[] =>
  store.getState().openTabs.map(({ kind, ref }) => ({ kind, ref }));

describe("editor tabs", () => {
  it("start as the one tab for the host's active division", () => {
    const store = makeStore("sec");
    expect(tabItems(store)).toEqual([div("sec")]);
  });

  it("add a tab for a snippet or asset opened from a division, after it", () => {
    const store = makeStore();
    store.getState().openAsset("fig");
    expect(tabItems(store)).toEqual([div("sec"), img("fig")]);
    expect(store.getState().openItem).toEqual(img("fig"));

    store.getState().openSnippet("greeting");
    expect(tabItems(store)).toEqual([div("sec"), img("fig"), snip("greeting")]);
  });

  it("replace the active division's tab when another division is opened", () => {
    const store = makeStore();
    store.getState().openDivision("other");
    expect(tabItems(store)).toEqual([div("other")]);

    // Also when there are other tabs: the division tab moves, the rest stay.
    store.getState().openAsset("fig");
    store.getState().setOpenItem(div("other"));
    store.getState().openDivision("sec");
    expect(tabItems(store)).toEqual([div("sec"), img("fig")]);
    expect(store.getState().openItem).toEqual(div("sec"));
  });

  it("give a division opened from an asset or snippet a tab of its own", () => {
    const store = makeStore();
    store.getState().openAsset("fig");
    store.getState().openDivision("other");
    expect(tabItems(store)).toEqual([div("sec"), img("fig"), div("other")]);
  });

  it("activate an item's existing tab rather than adding a second", () => {
    const store = makeStore();
    store.getState().openAsset("fig");
    store.getState().openDivision("sec");
    expect(tabItems(store)).toEqual([div("sec"), img("fig")]);
    expect(store.getState().openItem).toEqual(div("sec"));
    store.getState().openAsset("fig");
    expect(tabItems(store)).toEqual([div("sec"), img("fig")]);
  });

  it("close back to the tab on the left, or the right from the first", () => {
    const store = makeStore();
    store.getState().openAsset("fig");
    store.getState().openSnippet("greeting");
    store.getState().closeTab(snip("greeting"));
    expect(tabItems(store)).toEqual([div("sec"), img("fig")]);
    expect(store.getState().openItem).toEqual(img("fig"));

    store.getState().setOpenItem(div("sec"));
    store.getState().closeTab(div("sec"));
    expect(tabItems(store)).toEqual([img("fig")]);
    expect(store.getState().openItem).toEqual(img("fig"));
  });

  it("closing an inactive tab leaves the active one alone", () => {
    const store = makeStore();
    store.getState().openAsset("fig");
    store.getState().closeTab(div("sec"));
    expect(tabItems(store)).toEqual([img("fig")]);
    expect(store.getState().openItem).toEqual(img("fig"));
  });

  it("closing the only tab opens the root", () => {
    const store = makeStore();
    store.getState().closeTab(div("sec"));
    expect(tabItems(store)).toEqual([div("doc")]);
    expect(store.getState().openItem).toEqual(div("doc"));
  });

  it("closing an item that has no tab changes nothing", () => {
    const store = makeStore();
    const before = store.getState().openTabs;
    store.getState().closeTab(img("fig"));
    expect(store.getState().openTabs).toBe(before);
  });

  it("starts an item's drawer at its kind's default", () => {
    const store = makeStore();
    store.getState().openAsset("fig");
    expect(store.getState().isSettingsDrawerOpen).toBe(true);
    store.getState().closeTab(img("fig"));
    expect(store.getState().isSettingsDrawerOpen).toBe(false);
  });

  it("remember each tab's drawer as the author left it", () => {
    const store = makeStore();
    const s = () => store.getState();
    s().setSettingsDrawerOpen(true); // the division's, closed by default
    s().openAsset("fig");
    s().setSettingsDrawerOpen(false); // the asset's, open by default
    s().openSnippet("greeting");
    expect(s().isSettingsDrawerOpen).toBe(true); // a new tab: the default

    s().setOpenItem(img("fig"));
    expect(s().isSettingsDrawerOpen).toBe(false);
    s().openAsset("fig"); // its row clicked again: nothing changes
    expect(s().isSettingsDrawerOpen).toBe(false);
    s().setOpenItem(div("sec"));
    expect(s().isSettingsDrawerOpen).toBe(true);
    s().setOpenItem(snip("greeting"));
    expect(s().isSettingsDrawerOpen).toBe(true);
  });

  it("remember a tab's drawer across a rename of its item", () => {
    const store = makeStore();
    const s = () => store.getState();
    s().openAsset("fig");
    s().setSettingsDrawerOpen(false);
    s().setOpenItem(div("sec"));
    s().renameAssetInPool("fig", { ...asset, ref: "figure" });
    s().setOpenItem(img("figure"));
    expect(s().isSettingsDrawerOpen).toBe(false);
  });

  it("forget a drawer whose tab has gone", () => {
    const store = makeStore();
    const s = () => store.getState();
    s().openAsset("fig");
    s().setSettingsDrawerOpen(false);
    s().closeTab(img("fig"));
    s().openAsset("fig");
    expect(s().isSettingsDrawerOpen).toBe(true);

    // Walking the contents replaces the division's tab, and its memory.
    s().setOpenItem(div("sec"));
    s().setSettingsDrawerOpen(true);
    s().openDivision("other");
    s().openDivision("sec");
    expect(s().isSettingsDrawerOpen).toBe(false);
  });

  it("name only the item as open, not its tab's drawer state", () => {
    const store = makeStore();
    store.getState().openAsset("fig");
    store.getState().setOpenItem(div("sec"));
    store.getState().setOpenItem(store.getState().openTabs[1]);
    expect(store.getState().openItem).toEqual(img("fig"));
  });

  it("lose the tab of a removed item, landing on a neighbour when it was active", () => {
    const store = makeStore();
    store.getState().openAsset("fig");
    store.getState().removeAssetFromPool(asset);
    expect(tabItems(store)).toEqual([div("sec")]);
    expect(store.getState().openItem).toEqual(div("sec"));

    store.getState().openSnippet("greeting");
    store.getState().setOpenItem(div("sec"));
    store.getState().removeSnippetFromPool(snippet);
    expect(tabItems(store)).toEqual([div("sec")]);

    store.getState().openDivision("other");
    store.getState().removeDivisionFromPool("other");
    expect(tabItems(store)).toEqual([div("doc")]);
    expect(store.getState().openItem).toEqual(div("doc"));
  });

  it("follow a rename of a tab's item", () => {
    const store = makeStore();
    store.getState().openAsset("fig");
    store.getState().openSnippet("greeting");
    store.getState().renameAssetInPool("fig", { ...asset, ref: "figure" });
    store.getState().renameSnippetInPool("greeting", { ...snippet, ref: "hello" });
    store.getState().patchDivision("sec", { xmlId: "section" });
    expect(tabItems(store)).toEqual([
      div("section"),
      img("figure"),
      snip("hello"),
    ]);
    expect(store.getState().openItem).toEqual(snip("hello"));
  });

  it("treat the host restating the open division like the author opening it", () => {
    const store = makeStore();
    store.getState().openAsset("fig");
    store.getState().applyExternalUpdate({ activeDivisionId: "other" });
    expect(tabItems(store)).toEqual([div("sec"), img("fig"), div("other")]);
  });
});
