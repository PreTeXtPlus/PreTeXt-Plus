/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import MenuBar from "../components/MenuBar";
import { createEditorStore } from "../store/editorStore";
import { EditorStoreProvider } from "../store/EditorStoreProvider";

function renderWithStore(ui: (wrap: (children: ReactNode) => ReactNode) => ReactNode) {
  const { store, bindCallbacks } = createEditorStore({
    source: "",
    sourceFormat: "pretext",
    title: "My Document",
    docinfo: "",
    commonDocinfo: "",
    useCommonDocinfo: false,
    language: "en-US",
    divisions: [],
    activeDivisionId: null,
    projectAssets: undefined,
  });
  const noop = () => { };
  bindCallbacks({
    selectDivision: noop,
    addDivision: noop,
    removeDivision: noop,
    updateDivision: noop,
    divisionContentChange: noop,
    handleDivisionContentChange: noop,
    assetInsert: noop,
    snippetInsert: noop,
    // Stands in for the host: a title edit lands back in the store.
    updateTitle: (title) => store.getState().setTitle(title),
    updateLanguage: (language) => store.getState().setLanguage(language),
  });
  const wrap = (children: ReactNode) => (
    <EditorStoreProvider store={store}>{children}</EditorStoreProvider>
  );
  return render(<>{ui(wrap)}</>);
}

describe("MenuBar", () => {
  it("shows the title as text with an edit link, not a text box", () => {
    renderWithStore((wrap) => wrap(<MenuBar />));
    expect(screen.getByText("My Document")).toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "edit" })).toBeInTheDocument();
  });

  it("reveals an editable title field when the edit link is clicked", async () => {
    const user = userEvent.setup();
    renderWithStore((wrap) => wrap(<MenuBar />));
    await user.click(screen.getByRole("button", { name: "edit" }));

    const input = screen.getByLabelText("Title");
    expect(input).toHaveValue("My Document");
    await user.clear(input);
    await user.type(input, "Renamed");
    expect(screen.getByLabelText("Title")).toHaveValue("Renamed");
  });

  it("returns to plain text when editing is finished", async () => {
    const user = userEvent.setup();
    renderWithStore((wrap) => wrap(<MenuBar />));
    await user.click(screen.getByRole("button", { name: "edit" }));
    await user.keyboard("{Enter}");

    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    expect(screen.getByText("My Document")).toBeInTheDocument();
  });

  it("offers no way to edit the title when readOnly is set", () => {
    renderWithStore((wrap) => wrap(<MenuBar readOnly />));
    expect(screen.getByText("My Document")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "edit" })).not.toBeInTheDocument();
  });
});
