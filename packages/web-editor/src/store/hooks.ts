import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { EditorStoreInstance, EditorStoreState } from "./editorStore";

export const EditorStoreContext = createContext<EditorStoreInstance | null>(null);

/** Hook to read from the nearest EditorStoreProvider. */
export function useEditorStore<T>(selector: (state: EditorStoreState) => T): T {
  const store = useContext(EditorStoreContext);
  if (!store) {
    throw new Error("useEditorStore must be used within an EditorStoreProvider");
  }
  return useStore(store, selector);
}
