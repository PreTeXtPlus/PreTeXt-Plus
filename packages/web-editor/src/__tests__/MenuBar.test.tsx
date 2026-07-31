/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import MenuBar from "../components/MenuBar";
import { createEditorStore } from "../store/editorStore";
import { EditorStoreProvider } from "../store/EditorStoreProvider";

function renderWithStore(ui: (wrap: (children: ReactNode) => ReactNode) => ReactNode) {
  const { store } = createEditorStore({
    source: "",
    sourceFormat: "pretext",
    title: "My Document",
    docinfo: "",
    commonDocinfo: "",
    useCommonDocinfo: false,
    projectType: "article",
    divisions: [],
    activeDivisionId: null,
    projectAssets: undefined,
  });
  const wrap = (children: ReactNode) => (
    <EditorStoreProvider store={store}>{children}</EditorStoreProvider>
  );
  return render(<>{ui(wrap)}</>);
}

describe("MenuBar", () => {
  it("makes the title field read-only when readOnly is set", () => {
    renderWithStore((wrap) => wrap(<MenuBar readOnly />));
    expect(screen.getByLabelText("Title")).toHaveAttribute("readonly");
  });

  it("does not mark the title field read-only by default", () => {
    renderWithStore((wrap) => wrap(<MenuBar />));
    expect(screen.getByLabelText("Title")).not.toHaveAttribute("readonly");
  });

  it("renders a copy button that fires onCopyButton when provided", async () => {
    const user = userEvent.setup();
    const onCopyButton = vi.fn();
    renderWithStore((wrap) =>
      wrap(<MenuBar onCopyButton={onCopyButton} copyButtonLabel="Copy to new project" />),
    );
    const button = screen.getByRole("button", { name: "Copy to new project" });
    await user.click(button);
    expect(onCopyButton).toHaveBeenCalledTimes(1);
  });

  it("renders no copy button when onCopyButton is omitted", () => {
    renderWithStore((wrap) => wrap(<MenuBar />));
    expect(
      screen.queryByRole("button", { name: "Copy to new project" }),
    ).not.toBeInTheDocument();
  });
});
