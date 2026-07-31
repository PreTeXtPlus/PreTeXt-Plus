/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CodeEditorMenu from "../components/CodeEditorMenu";
import type { SourceFormat } from "../types/editor";

// jsdom reports 0 for every element's measured width, so OverflowMenu (which
// only shows an action inline once its measured width fits the container)
// collapses every multi-action toolbar into the "More" dropdown. Open it so
// the (still-rendered, just-hidden-until-opened) actions are queryable.
async function openOverflowMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More ▾" }));
}

const baseProps = {
  content: "<article/>",
  onContentChange: vi.fn(),
  onOpenLatexImport: vi.fn(),
  onOpenDocinfoEditor: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  canUndo: false,
  canRedo: false,
  onShowFullSource: vi.fn(),
};

describe("CodeEditorMenu", () => {
  // CodeEditorMenu's OverflowMenu renders a second, `aria-hidden` mirror row
  // to measure natural button widths, so `getByText` sees two matches for
  // every action -- query by accessible role/name instead, which excludes
  // aria-hidden content.
  it.each<SourceFormat>(["pretext", "latex", "markdown"])(
    "shows only Display Full Source when readOnly (%s)",
    (sourceFormat) => {
      render(<CodeEditorMenu {...baseProps} sourceFormat={sourceFormat} readOnly />);
      expect(
        screen.getByRole("button", { name: "Display Full Source" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Format PreTeXt" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Import LaTeX" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Edit Macros" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Edit Preamble" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Convert to PreTeXt" }),
      ).not.toBeInTheDocument();
    },
  );

  it("shows the full PreTeXt toolbar when not readOnly", async () => {
    render(<CodeEditorMenu {...baseProps} sourceFormat="pretext" />);
    await openOverflowMenu();
    expect(screen.getByRole("menuitem", { name: "Format PreTeXt" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Import LaTeX" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit Macros" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Display Full Source" })).toBeInTheDocument();
  });

  it("shows the LaTeX toolbar when not readOnly", async () => {
    render(
      <CodeEditorMenu
        {...baseProps}
        sourceFormat="latex"
        onConvertToPretext={vi.fn()}
      />,
    );
    await openOverflowMenu();
    expect(screen.getByRole("menuitem", { name: "Convert to PreTeXt" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit Preamble" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Display Full Source" })).toBeInTheDocument();
  });
});
