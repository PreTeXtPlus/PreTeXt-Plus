import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { EditorStoreInstance, EditorStoreState } from "./editorStore";

export const EditorStoreContext = createContext<EditorStoreInstance | null>(null);

/**
 * The nearest EditorStoreProvider's store itself, for the rare read that must
 * see writes made earlier in the *same* event — a render-scoped value is a
 * snapshot, and code that flushes a pending edit before acting on the pool has
 * to read what that flush just wrote.
 */
export function useEditorStoreApi(): EditorStoreInstance {
  const store = useContext(EditorStoreContext);
  if (!store) {
    throw new Error(
      "useEditorStoreApi must be used within an EditorStoreProvider",
    );
  }
  return store;
}

/** Hook to read from the nearest EditorStoreProvider. */
export function useEditorStore<T>(selector: (state: EditorStoreState) => T): T {
  const store = useContext(EditorStoreContext);
  if (!store) {
    throw new Error("useEditorStore must be used within an EditorStoreProvider");
  }
  return useStore(store, selector);
}
