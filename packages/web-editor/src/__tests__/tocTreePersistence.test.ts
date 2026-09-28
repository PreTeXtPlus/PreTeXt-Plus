/**
 * @vitest-environment jsdom
 *
 * The TOC tree's shape — which rows are open, whether the unplaced block is
 * folded — is saved per project, so an author comes back to the tree they left.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createEditorStore } from "../store/editorStore";

const makeStore = (projectUrl?: string) =>
  createEditorStore({
    source: "<article/>",
    sourceFormat: "pretext",
    title: "Document",
    docinfo: "",
    commonDocinfo: "",
    useCommonDocinfo: false,
    language: "en-US",
    divisions: [],
    activeDivisionId: null,
    projectAssets: undefined,
    projectUrl,
  }).store;

const PROJECT = "https://pretext.plus/projects/1";
const OTHER_PROJECT = "https://pretext.plus/projects/2";

describe("TOC tree persistence", () => {
  beforeEach(() => localStorage.clear());

  it("restores open and shut rows in a later session", () => {
    const store = makeStore(PROJECT);
    store.getState().setTocExpanded("ch1", true);
    store.getState().setTocExpanded("doc", false);
    expect(makeStore(PROJECT).getState().tocExpansion).toEqual({
      ch1: true,
      doc: false,
    });
  });

  it("restores a folded unplaced block in a later session", () => {
    makeStore(PROJECT).getState().toggleTocOrphansCollapsed();
    expect(makeStore(PROJECT).getState().isTocOrphansCollapsed).toBe(true);
  });

  it("saves the rows opened to reveal the active division", () => {
    makeStore(PROJECT).getState().revealInToc("sec", ["ch1", "doc"], true);
    const restored = makeStore(PROJECT).getState();
    expect(restored.tocExpansion).toEqual({ sec: true, ch1: true, doc: true });
    expect(restored.isTocOrphansCollapsed).toBe(false);
    // Which division was revealed isn't saved, so a new session reveals
    // wherever the author lands.
    expect(restored.tocRevealedId).toBeNull();
  });

  it("saves a renamed row under its new id", () => {
    const store = makeStore(PROJECT);
    store.getState().applyExternalUpdate({
      divisions: [
        {
          id: "1",
          xmlId: "ch1",
          title: "Chapter",
          type: "chapter",
          sourceFormat: "pretext",
          source: '<chapter xml:id="ch1"><title>Chapter</title></chapter>',
        },
      ],
    });
    store.getState().setTocExpanded("ch1", true);
    store.getState().patchDivision("ch1", { xmlId: "intro-chapter" });
    expect(makeStore(PROJECT).getState().tocExpansion).toEqual({
      "intro-chapter": true,
    });
  });

  it("keeps each project's tree separate", () => {
    makeStore(PROJECT).getState().setTocExpanded("ch1", true);
    makeStore(OTHER_PROJECT).getState().toggleTocOrphansCollapsed();

    const other = makeStore(OTHER_PROJECT).getState();
    expect(other.tocExpansion).toEqual({});
    expect(other.isTocOrphansCollapsed).toBe(true);
    const first = makeStore(PROJECT).getState();
    expect(first.tocExpansion).toEqual({ ch1: true });
    expect(first.isTocOrphansCollapsed).toBe(false);
  });

  it("saves nothing for a host that names no project", () => {
    const store = makeStore();
    store.getState().setTocExpanded("ch1", true);
    store.getState().toggleTocOrphansCollapsed();
    expect(localStorage.length).toBe(0);
    expect(makeStore().getState().tocExpansion).toEqual({});
  });

  it("starts from the default shape when the saved entry is unreadable", () => {
    localStorage.setItem(`pretext-plus:toc-tree:${PROJECT}`, "{not json");
    const state = makeStore(PROJECT).getState();
    expect(state.tocExpansion).toEqual({});
    expect(state.isTocOrphansCollapsed).toBe(false);
  });

  it("drops saved entries that aren't open/shut flags", () => {
    localStorage.setItem(
      `pretext-plus:toc-tree:${PROJECT}`,
      JSON.stringify({
        tocExpansion: { ch1: true, ch2: "yes", ch3: null },
        isTocOrphansCollapsed: "true",
      }),
    );
    const state = makeStore(PROJECT).getState();
    expect(state.tocExpansion).toEqual({ ch1: true });
    expect(state.isTocOrphansCollapsed).toBe(false);
  });
});
