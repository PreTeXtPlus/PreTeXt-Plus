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
    projectType: "article",
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
