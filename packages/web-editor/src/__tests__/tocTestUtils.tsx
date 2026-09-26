/**
 * Shared fixtures and helpers for the project explorer's component tests.
 * Not a test file itself (no `.test` suffix), so Vitest doesn't collect it.
 */
import type { ReactElement } from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { createEditorStore } from "../store/editorStore";
import { EditorStoreProvider } from "../store/EditorStoreProvider";
import type { Division } from "../types/sections";

export type TestStore = ReturnType<typeof createEditorStore>["store"];

export const divisions: Division[] = [
  {
    id: "1",
    xmlId: "doc",
    title: "Document",
    type: "article",
    sourceFormat: "pretext",
    source: '<article xml:id="doc"><title>Document</title><plus:section ref="sec"/></article>',
  },
  {
    id: "2",
    xmlId: "sec",
    title: "A section",
    type: "section",
    sourceFormat: "pretext",
    source: '<section xml:id="sec"><title>A section</title></section>',
  },
];

/** Render `ui` inside a fresh editor store seeded with `docDivisions`. */
export function renderWithStore(
  ui: ReactElement,
  docDivisions: Division[] = divisions,
  configure?: (store: TestStore) => void,
) {
  const { store, bindCallbacks } = createEditorStore({
    source: docDivisions[0].source,
    sourceFormat: "pretext",
    title: "Document",
    docinfo: "",
    commonDocinfo: "",
    useCommonDocinfo: false,
    language: "en-US",
    divisions: docDivisions,
    activeDivisionId: docDivisions[0].xmlId,
    projectAssets: undefined,
  });
  // Without `Editors` nothing answers the store's callbacks; selecting a row
  // just has to open the division, which is all these tests need of it.
  const noop = () => {};
  bindCallbacks({
    selectDivision: (id) => store.getState().openDivision(id),
    addDivision: noop,
    createDivision: noop,
    removeDivision: noop,
    updateDivision: noop,
    divisionContentChange: noop,
    handleDivisionContentChange: noop,
    assetInsert: noop,
    snippetInsert: noop,
    updateTitle: noop,
    updateLanguage: noop,
  });
  configure?.(store);
  return {
    store,
    ...render(<EditorStoreProvider store={store}>{ui}</EditorStoreProvider>),
  };
}

/** The TOC row whose title is `label`. */
export function tocRow(label: string): HTMLElement {
  // Matched on the row's own title element: once a settings form is open the
  // label also appears as an <option>, which a plain text query would hit.
  const row = [...document.querySelectorAll('[data-testid^="toc-item-"]')]
    .find(
      (li) =>
        li.querySelector('[data-testid="toc-title"]')?.textContent ===
        label,
    ) as HTMLElement | undefined;
  if (!row) throw new Error(`no TOC row for "${label}"`);
  return row;
}

/**
 * Open the division titled `label` and drop down its settings drawer (the
 * properties form plus its structural actions). Returns the drawer.
 */
export function openSettings(label: string): HTMLElement {
  fireEvent.click(within(tocRow(label)).getByTestId("toc-title"));
  // Re-opening an already-open drawer would close it; start from closed.
  if (screen.queryByTestId("settings-drawer")) {
    fireEvent.click(screen.getByTestId("settings-drawer-toggle"));
  }
  fireEvent.click(screen.getByTestId("settings-drawer-toggle"));
  return screen.getByTestId("settings-drawer");
}

/** Open `label`'s settings and read its Type dropdown. */
export function typeChoices(label: string) {
  const drawer = openSettings(label);
  const select = within(drawer).getByText("Type").parentElement!
    .querySelector("select") as HTMLSelectElement;
  const choices = {
    options: [...select.options].map((o) => o.value),
    value: select.value,
    disabled: select.disabled,
  };
  fireEvent.click(within(drawer).getByText("Cancel"));
  return choices;
}
