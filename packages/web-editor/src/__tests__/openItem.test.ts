import { describe, it, expect } from "vitest";
import { createEditorStore, selectOpenDivisionId } from "../store/editorStore";
import type { Division } from "../types/sections";
import type { Asset, Snippet } from "../types/editor";

const divisions: Division[] = [
  {
    id: "1",
    xmlId: "doc",
    title: "Doc",
    type: "article",
    sourceFormat: "pretext",
    source: '<article xml:id="doc"><title>Doc</title><plus:section ref="sec"/></article>',
  },
  {
    id: "2",
    xmlId: "sec",
    title: "Sec",
    type: "section",
    sourceFormat: "pretext",
    source: '<section xml:id="sec"><title>Sec</title></section>',
  },
];
const snippet: Snippet = { id: "s1", ref: "greeting", source: "<p>Hi</p>", sourceFormat: "pretext" };
const asset: Asset = { id: "a1", ref: "fig", title: "Figure" };

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

describe("the open item", () => {
  it("is seeded from the host's active division", () => {
    const store = makeStore("sec");
    expect(store.getState().openItem).toEqual({ kind: "division", ref: "sec" });
    expect(selectOpenDivisionId(store.getState())).toBe("sec");
  });

  it("names no division while a snippet or asset is open", () => {
    const store = makeStore();
    store.getState().openSnippet("greeting");
    expect(store.getState().openItem).toEqual({ kind: "snippet", ref: "greeting" });
    expect(selectOpenDivisionId(store.getState())).toBeNull();
    store.getState().openAsset("fig");
    expect(store.getState().openItem).toEqual({ kind: "asset", ref: "fig" });
    expect(selectOpenDivisionId(store.getState())).toBeNull();
  });

  it("closes the settings drawer and drops any draft when another item opens", () => {
    const store = makeStore();
    store.getState().startSectionEdit(divisions[1]);
    expect(store.getState().isSettingsDrawerOpen).toBe(true);
    expect(store.getState().editingId).toBe("sec");

    store.getState().openSnippet("greeting");
    expect(store.getState().isSettingsDrawerOpen).toBe(false);
    expect(store.getState().editingId).toBeNull();
    expect(store.getState().editDraft).toBeNull();
  });

  it("leaves the drawer alone when the open item is reopened", () => {
    const store = makeStore();
    store.getState().openSnippet("greeting");
    store.getState().setSettingsDrawerOpen(true);
    store.getState().openSnippet("greeting");
    expect(store.getState().isSettingsDrawerOpen).toBe(true);
  });

  it("follows a renamed snippet, asset or division", () => {
    const store = makeStore();
    store.getState().openSnippet("greeting");
    store.getState().renameSnippetInPool("greeting", { ...snippet, ref: "hello" });
    expect(store.getState().openItem).toEqual({ kind: "snippet", ref: "hello" });

    store.getState().openAsset("fig");
    store.getState().renameAssetInPool("fig", { ...asset, ref: "fig-1" });
    expect(store.getState().openItem).toEqual({ kind: "asset", ref: "fig-1" });

    store.getState().openDivision("sec");
    store.getState().patchDivision("sec", { xmlId: "sec-renamed" });
    expect(store.getState().openItem).toEqual({ kind: "division", ref: "sec-renamed" });
  });

  it("falls back to the root when the open item is removed", () => {
    const store = makeStore();
    store.getState().openSnippet("greeting");
    store.getState().removeSnippetFromPool(snippet);
    expect(store.getState().openItem).toEqual({ kind: "division", ref: "doc" });

    store.getState().openAsset("fig");
    store.getState().removeAssetFromPool(asset);
    expect(store.getState().openItem).toEqual({ kind: "division", ref: "doc" });

    store.getState().openDivision("sec");
    store.getState().removeDivisionFromPool("sec");
    expect(store.getState().openItem).toEqual({ kind: "division", ref: "doc" });
  });

  it("maps a host-driven active division onto the open item", () => {
    const store = makeStore();
    store.getState().openSnippet("greeting");
    store.getState().applyExternalUpdate({ activeDivisionId: "sec" });
    expect(store.getState().openItem).toEqual({ kind: "division", ref: "sec" });
  });

  it("closes the drawer on save or cancel of a properties form", () => {
    const store = makeStore();
    store.getState().startSectionEdit(divisions[1]);
    store.getState().cancelSectionEdit();
    expect(store.getState().isSettingsDrawerOpen).toBe(false);
    expect(store.getState().editDraft).toBeNull();
  });
});
