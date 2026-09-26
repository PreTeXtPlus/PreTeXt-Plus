/**
 * @vitest-environment jsdom
 *
 * The TOC's open/closed state is a saved preference, so an author who doesn't
 * use the sidebar keeps it shut across sessions.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  createEditorStore,
  defaultTocCollapsed,
  NARROW_SCREEN_MAX_WIDTH,
} from "../store/editorStore";

const makeStore = () =>
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
  }).store;

const setViewportWidth = (width: number) => {
  window.innerWidth = width;
};

describe("TOC collapse preference", () => {
  beforeEach(() => {
    localStorage.clear();
    setViewportWidth(NARROW_SCREEN_MAX_WIDTH + 200);
  });

  it("starts expanded on a wide screen with no stored choice", () => {
    expect(makeStore().getState().isTocCollapsed).toBe(false);
  });

  it("restores a collapsed TOC in a later session", () => {
    makeStore().getState().toggleTocCollapsed();
    expect(defaultTocCollapsed()).toBe(true);
    expect(makeStore().getState().isTocCollapsed).toBe(true);
  });

  it("restores an expanded TOC after it is toggled back open", () => {
    const store = makeStore();
    store.getState().toggleTocCollapsed();
    store.getState().toggleTocCollapsed();
    expect(makeStore().getState().isTocCollapsed).toBe(false);
  });

  it("starts collapsed on a narrow screen even when open was remembered", () => {
    makeStore().getState().toggleTocCollapsed(); // remembers "collapsed"
    makeStore().getState().toggleTocCollapsed(); // …then "open"

    setViewportWidth(NARROW_SCREEN_MAX_WIDTH - 100);
    expect(makeStore().getState().isTocCollapsed).toBe(true);
  });

  it("does not save a toggle made in the narrow-screen drawer", () => {
    setViewportWidth(NARROW_SCREEN_MAX_WIDTH - 100);
    const store = makeStore();
    store.getState().toggleTocCollapsed(); // opens the drawer

    setViewportWidth(NARROW_SCREEN_MAX_WIDTH + 200);
    expect(defaultTocCollapsed()).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it("leaves the preference alone when set programmatically", () => {
    makeStore().getState().setIsTocCollapsed(true);
    expect(defaultTocCollapsed()).toBe(false);
  });
});

describe("explorer view selection", () => {
  beforeEach(() => {
    localStorage.clear();
    setViewportWidth(NARROW_SCREEN_MAX_WIDTH + 200);
  });

  it("switches views without collapsing", () => {
    const store = makeStore();
    store.getState().selectExplorerView("snippets");
    expect(store.getState().explorerView).toBe("snippets");
    expect(store.getState().isTocCollapsed).toBe(false);
  });

  it("collapses, and remembers it, when the open view is selected again", () => {
    const store = makeStore();
    store.getState().selectExplorerView("toc");
    expect(store.getState().isTocCollapsed).toBe(true);
    expect(defaultTocCollapsed()).toBe(true);
  });

  it("expands a collapsed explorer onto the selected view", () => {
    const store = makeStore();
    store.getState().selectExplorerView("toc"); // collapse
    store.getState().selectExplorerView("toc");
    expect(store.getState().isTocCollapsed).toBe(false);
    expect(defaultTocCollapsed()).toBe(false);
  });

  it("never collapses when a view is shown programmatically", () => {
    const store = makeStore();
    store.getState().showExplorerView("toc");
    expect(store.getState().isTocCollapsed).toBe(false);
    store.getState().setIsTocCollapsed(true);
    store.getState().showExplorerView("find");
    expect(store.getState().explorerView).toBe("find");
    expect(store.getState().isTocCollapsed).toBe(false);
  });
});
