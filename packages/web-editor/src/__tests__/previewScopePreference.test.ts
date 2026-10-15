/**
 * @vitest-environment jsdom
 *
 * The preview scope is a saved preference: an author who wants their short
 * article previewed whole only has to say so once.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createEditorStore, defaultPreviewScope } from "../store/editorStore";

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

describe("preview scope preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("follows the cursor when nothing has been stored", () => {
    expect(defaultPreviewScope()).toBe("cursor");
    expect(makeStore().getState().previewScope).toBe("cursor");
  });

  it("keeps the whole editor in a later session once chosen", () => {
    makeStore().getState().setPreviewScope("editor");
    expect(defaultPreviewScope()).toBe("editor");
    expect(makeStore().getState().previewScope).toBe("editor");
  });

  it("ignores a stored value it does not recognise", () => {
    localStorage.setItem("pretext-plus:preview-scope", "everything");
    expect(defaultPreviewScope()).toBe("cursor");
  });

  it("still changes when localStorage refuses to store it", () => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("storage blocked");
    };
    try {
      const store = makeStore();
      expect(() => store.getState().setPreviewScope("editor")).not.toThrow();
      expect(store.getState().previewScope).toBe("editor");
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
});
