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
  const { store } = createEditorStore({
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
  configure?.(store);
  return {
    store,
    ...render(<EditorStoreProvider store={store}>{ui}</EditorStoreProvider>),
  };
}

/** Open the "⋮" menu of the TOC row whose title is `label`. */
export function openMenu(label: string) {
  // Matched on the row's own title element: once an edit form is open the
  // label also appears as an <option>, which a plain text query would hit.
  const row = [...document.querySelectorAll('[data-testid^="toc-item-"]')]
    .find(
      (li) =>
        li.querySelector('[data-testid="toc-title"]')?.textContent ===
        label,
    ) as HTMLElement | undefined;
  if (!row) throw new Error(`no TOC row for "${label}"`);
  fireEvent.click(within(row).getByTitle("More options"));
  return row;
}

/** Open "Edit properties" for the row titled `label` and read its Type dropdown. */
export function typeChoices(label: string) {
  const row = openMenu(label);
  fireEvent.click(screen.getByText("Edit properties"));
  const select = within(row).getByText("Type").parentElement!
    .querySelector("select") as HTMLSelectElement;
  const choices = {
    options: [...select.options].map((o) => o.value),
    value: select.value,
    disabled: select.disabled,
  };
  fireEvent.click(within(row).getByText("Cancel"));
  return choices;
}
