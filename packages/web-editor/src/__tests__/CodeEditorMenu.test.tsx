/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CodeEditorMenu, {
  type EditorMenuActions,
} from "../components/CodeEditorMenu";
import { MONACO_COMMANDS } from "../components/editorCommands";
import type { SourceFormat } from "../types/editor";

const makeActions = (): EditorMenuActions => ({
  runCommand: vi.fn(),
  cut: vi.fn(async () => true),
  copy: vi.fn(async () => true),
  paste: vi.fn(async () => true),
  insertSnippet: vi.fn(),
});

let actions: EditorMenuActions;

const baseProps = () => ({
  content: "<article/>",
  onContentChange: vi.fn(),
  onOpenLatexImport: vi.fn(),
  onOpenDocinfoEditor: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  canUndo: true,
  canRedo: true,
  hasSelection: true,
  onShowFullSource: vi.fn(),
  actions,
});

/** Open one of the menubar menus and return a userEvent session. */
async function openMenu(name: "Edit" | "Insert" | "Tools") {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name }));
  return user;
}

const menuItem = (name: string | RegExp) =>
  screen.getByRole("menuitem", { name });

const queryMenuItem = (name: string | RegExp) =>
  screen.queryByRole("menuitem", { name });

beforeEach(() => {
  actions = makeActions();
});

describe("CodeEditorMenu", () => {
  it.each<SourceFormat>(["pretext", "latex", "markdown"])(
    "offers the same three menus in %s",
    (sourceFormat) => {
      render(<CodeEditorMenu {...baseProps()} sourceFormat={sourceFormat} />);
      for (const name of ["Edit", "Insert", "Tools"]) {
        expect(screen.getByRole("button", { name })).toBeInTheDocument();
      }
    },
  );

  describe("Edit", () => {
    it("runs undo and redo through the parent's handlers", async () => {
      const props = baseProps();
      render(<CodeEditorMenu {...props} sourceFormat="pretext" />);

      let user = await openMenu("Edit");
      await user.click(menuItem(/^Undo/));
      expect(props.onUndo).toHaveBeenCalled();

      user = await openMenu("Edit");
      await user.click(menuItem(/^Redo/));
      expect(props.onRedo).toHaveBeenCalled();
    });

    it("disables undo, redo and the selection actions when they cannot apply", async () => {
      render(
        <CodeEditorMenu
          {...baseProps()}
          sourceFormat="pretext"
          canUndo={false}
          canRedo={false}
          hasSelection={false}
        />,
      );
      await openMenu("Edit");

      expect(menuItem(/^Undo/)).toBeDisabled();
      expect(menuItem(/^Redo/)).toBeDisabled();
      expect(menuItem(/^Cut/)).toBeDisabled();
      expect(menuItem(/^Copy/)).toBeDisabled();
      // Paste never depends on the selection.
      expect(menuItem(/^Paste/)).toBeEnabled();
    });

    it("copies through the clipboard action", async () => {
      render(<CodeEditorMenu {...baseProps()} sourceFormat="pretext" />);
      const user = await openMenu("Edit");
      await user.click(menuItem(/^Copy/));
      expect(actions.copy).toHaveBeenCalled();
    });

    it("says so when the browser refuses to read the clipboard", async () => {
      actions.paste = vi.fn(async () => false);
      render(<CodeEditorMenu {...baseProps()} sourceFormat="pretext" />);
      const user = await openMenu("Edit");
      await user.click(menuItem(/^Paste/));

      expect(await screen.findByRole("status")).toHaveTextContent(
        /blocked reading the clipboard/i,
      );
    });

    it("opens Monaco's find widget", async () => {
      render(<CodeEditorMenu {...baseProps()} sourceFormat="pretext" />);
      const user = await openMenu("Edit");
      await user.click(menuItem(/^Find…/));
      expect(actions.runCommand).toHaveBeenCalledWith(MONACO_COMMANDS.find.id);
    });
  });

  describe("Insert", () => {
    it("inserts the snippet written in the active format", async () => {
      const { unmount } = render(
        <CodeEditorMenu {...baseProps()} sourceFormat="pretext" />,
      );
      let user = await openMenu("Insert");
      await user.click(menuItem("Theorem"));
      expect((actions.insertSnippet as any).mock.calls[0][0].body).toContain(
        "<theorem",
      );
      unmount();

      actions = makeActions();
      render(<CodeEditorMenu {...baseProps()} sourceFormat="latex" />);
      user = await openMenu("Insert");
      await user.click(menuItem("Theorem"));
      expect((actions.insertSnippet as any).mock.calls[0][0].body).toContain(
        "\\begin{theorem}",
      );
    });

    it("hides constructs the format's converter does not support", async () => {
      render(<CodeEditorMenu {...baseProps()} sourceFormat="markdown" />);
      await openMenu("Insert");

      expect(menuItem("Theorem")).toBeInTheDocument();
      // Markdown converts tables and links to `<TODO>` placeholders today.
      expect(queryMenuItem("Table")).not.toBeInTheDocument();
      expect(queryMenuItem("Link")).not.toBeInTheDocument();
    });
  });

  describe("Tools", () => {
    it("shows the PreTeXt document actions", async () => {
      render(<CodeEditorMenu {...baseProps()} sourceFormat="pretext" />);
      await openMenu("Tools");

      expect(menuItem("Format PreTeXt")).toBeInTheDocument();
      expect(menuItem("Import LaTeX…")).toBeInTheDocument();
      expect(menuItem("Edit Macros…")).toBeInTheDocument();
      expect(menuItem("Display Full Source")).toBeInTheDocument();
      expect(queryMenuItem("Edit Preamble…")).not.toBeInTheDocument();
    });

    it("shows the LaTeX document actions, cleanup included", async () => {
      const onOpenClean = vi.fn();
      render(
        <CodeEditorMenu
          {...baseProps()}
          sourceFormat="latex"
          onOpenClean={onOpenClean}
        />,
      );
      await openMenu("Tools");

      expect(menuItem("Clean up LaTeX…")).toBeInTheDocument();
      expect(menuItem("Edit Preamble…")).toBeInTheDocument();
      expect(queryMenuItem("Format PreTeXt")).not.toBeInTheDocument();
      expect(queryMenuItem("Import LaTeX…")).not.toBeInTheDocument();
    });

    it("offers the shared editor commands in every format", async () => {
      render(<CodeEditorMenu {...baseProps()} sourceFormat="markdown" />);
      const user = await openMenu("Tools");

      await user.click(menuItem(/^Command Palette…/));
      expect(actions.runCommand).toHaveBeenCalledWith(
        MONACO_COMMANDS.commandPalette.id,
      );
    });

    it("hides Assets when the host manages no assets", async () => {
      render(
        <CodeEditorMenu
          {...baseProps()}
          sourceFormat="pretext"
          onOpenAssets={vi.fn()}
          hideAssets
        />,
      );
      await openMenu("Tools");
      expect(queryMenuItem("Assets…")).not.toBeInTheDocument();
    });
  });

  describe("read-only", () => {
    it.each<SourceFormat>(["pretext", "latex", "markdown"])(
      "hides every editing action (%s)",
      async (sourceFormat) => {
        render(
          <CodeEditorMenu
            {...baseProps()}
            sourceFormat={sourceFormat}
            onOpenClean={vi.fn()}
            onOpenAssets={vi.fn()}
            onConvertToPretext={vi.fn()}
            readOnly
          />,
        );

        expect(
          screen.queryByRole("button", { name: "Insert" }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: "Convert to PreTeXt" }),
        ).not.toBeInTheDocument();

        await openMenu("Tools");
        expect(menuItem("Display Full Source")).toBeInTheDocument();
        expect(queryMenuItem("Format PreTeXt")).not.toBeInTheDocument();
        expect(queryMenuItem("Edit Macros…")).not.toBeInTheDocument();
        expect(queryMenuItem("Edit Preamble…")).not.toBeInTheDocument();
        expect(queryMenuItem("Clean up LaTeX…")).not.toBeInTheDocument();
        expect(queryMenuItem("Assets…")).not.toBeInTheDocument();
      },
    );

    it("keeps the actions that only read the buffer", async () => {
      render(
        <CodeEditorMenu {...baseProps()} sourceFormat="pretext" readOnly />,
      );
      await openMenu("Edit");

      expect(menuItem(/^Copy/)).toBeInTheDocument();
      expect(menuItem(/^Find…/)).toBeInTheDocument();
      expect(queryMenuItem(/^Undo/)).not.toBeInTheDocument();
      expect(queryMenuItem(/^Paste/)).not.toBeInTheDocument();
    });
  });

  it("keeps Convert to PreTeXt a button, disabled when conversion failed", () => {
    const { rerender } = render(
      <CodeEditorMenu
        {...baseProps()}
        sourceFormat="latex"
        onConvertToPretext={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Convert to PreTeXt" }),
    ).toBeEnabled();

    rerender(
      <CodeEditorMenu
        {...baseProps()}
        sourceFormat="latex"
        onConvertToPretext={vi.fn()}
        canConvertToPretext={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Convert to PreTeXt" }),
    ).toBeDisabled();
  });

  it("only ever has one menu open", async () => {
    render(<CodeEditorMenu {...baseProps()} sourceFormat="pretext" />);
    const user = await openMenu("Edit");
    expect(screen.getByRole("menu", { name: "Edit" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.queryByRole("menu", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Tools" })).toBeInTheDocument();
  });

  it("closes the open menu on Escape", async () => {
    render(<CodeEditorMenu {...baseProps()} sourceFormat="pretext" />);
    const user = await openMenu("Edit");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Edit" })).not.toBeInTheDocument();
  });

  describe("keyboard", () => {
    it("opens a menu with Arrow Down and lands on its first item", async () => {
      const user = userEvent.setup();
      render(<CodeEditorMenu {...baseProps()} sourceFormat="pretext" />);

      screen.getByRole("button", { name: "Edit" }).focus();
      await user.keyboard("{ArrowDown}");

      expect(screen.getByRole("menu", { name: "Edit" })).toBeInTheDocument();
      expect(menuItem(/^Undo/)).toHaveFocus();
    });

    it("walks the items, wrapping at the ends", async () => {
      render(<CodeEditorMenu {...baseProps()} sourceFormat="pretext" />);
      const user = await openMenu("Edit");

      await user.keyboard("{ArrowDown}");
      expect(menuItem(/^Redo/)).toHaveFocus();
      await user.keyboard("{ArrowUp}{ArrowUp}");
      // Wrapped past the top to the last item.
      expect(menuItem(/^Find and Replace…/)).toHaveFocus();
    });

    it("skips disabled items", async () => {
      render(
        <CodeEditorMenu
          {...baseProps()}
          sourceFormat="pretext"
          canRedo={false}
        />,
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit" }));

      expect(menuItem(/^Undo/)).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(menuItem(/^Cut/)).toHaveFocus();
    });

    it("crosses to the neighbouring menu with Arrow Right", async () => {
      render(<CodeEditorMenu {...baseProps()} sourceFormat="pretext" />);
      const user = await openMenu("Edit");
      await user.keyboard("{ArrowRight}");

      expect(screen.queryByRole("menu", { name: "Edit" })).not.toBeInTheDocument();
      expect(screen.getByRole("menu", { name: "Insert" })).toBeInTheDocument();
    });
  });
});
