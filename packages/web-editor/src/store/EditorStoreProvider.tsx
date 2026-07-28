import type { ReactNode } from "react";
import type { EditorStoreInstance } from "./editorStore";
import { EditorStoreContext } from "./hooks";

export function EditorStoreProvider({
  store,
  children,
}: {
  store: EditorStoreInstance;
  children: ReactNode;
}) {
  return (
    <EditorStoreContext.Provider value={store}>
      {children}
    </EditorStoreContext.Provider>
  );
}
