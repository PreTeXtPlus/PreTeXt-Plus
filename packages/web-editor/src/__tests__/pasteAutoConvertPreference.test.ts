/**
 * @vitest-environment jsdom
 *
 * Paste-and-convert is a saved preference, so an author who wants their LaTeX
 * pasted verbatim only has to say so once.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  createEditorStore,
  defaultPasteAutoConvert,
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

describe("paste auto-convert preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is on when nothing has been stored", () => {
    expect(defaultPasteAutoConvert()).toBe(true);
    expect(makeStore().getState().pasteAutoConvert).toBe(true);
  });

  it("stays off in a later session once turned off", () => {
    makeStore().getState().togglePasteAutoConvert();
    expect(defaultPasteAutoConvert()).toBe(false);
    expect(makeStore().getState().pasteAutoConvert).toBe(false);
  });

  it("comes back on when toggled back", () => {
    const store = makeStore();
    store.getState().togglePasteAutoConvert();
    store.getState().togglePasteAutoConvert();
    expect(makeStore().getState().pasteAutoConvert).toBe(true);
  });

  // Storage is unavailable in a private window or a sandboxed iframe. The
  // choice should not outlive the session there, but it must not throw either.
  it("still toggles when localStorage refuses to store it", () => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("storage blocked");
    };
    try {
      const store = makeStore();
      expect(() => store.getState().togglePasteAutoConvert()).not.toThrow();
      expect(store.getState().pasteAutoConvert).toBe(false);
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
});
