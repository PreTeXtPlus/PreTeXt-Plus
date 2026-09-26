import React, { useEffect, useState } from "react";
import clsx from "clsx";
import type { SourceFormat } from "../types/editor";
import type { RootDivisionType } from "../types/sections";
import MenuDropdown, { type MenuEntry } from "./MenuDropdown";
import {
  MONACO_COMMANDS,
  formatShortcut,
  type MonacoCommand,
} from "./editorCommands";
import {
  snippetGroupsFor,
  type EditorSnippet,
} from "./editorConfigs/snippets";
import { buildDocumentActionEntries } from "./documentActionMenuEntries";

/** A menu a host adds to this bar via `leadingMenus`/`trailingMenus`. */
export interface BarMenu {
  key: string;
  label: string;
  entries: MenuEntry[];
  /** When true, the menu's trigger button is disabled and its panel never opens. */
  disabled?: boolean;
}

/**
 * The editor operations the menus drive. Supplied by `CodeEditor`, which is
 * the only place that holds the Monaco instance; the menu stays a pure
 * rendering of what is available.
 */
export interface EditorMenuActions {
  /** Run a Monaco command by id — see `editorCommands`. */
  runCommand: (id: string) => void;
  /** Clipboard operations; resolve `false` when the browser refuses. */
  cut: () => Promise<boolean>;
  copy: () => Promise<boolean>;
  paste: () => Promise<boolean>;
  /**
   * Select the editable body — not the locked structural lines. Same operation
   * Mod+A performs in the editor; see `selectEditableRegion` in
   * `editorCommands`.
   */
  selectAll: () => void;
  /** Insert a snippet at the cursor, tab stops live. */
  insertSnippet: (snippet: EditorSnippet) => void;
}

interface CodeEditorMenuProps {
  /** Current source content; passed to the formatter for "Format PreTeXt". */
  content: string;
  /** Decides which document actions and which snippets the menus offer. */
  sourceFormat: SourceFormat;
  /**
   * The project's root element. Gates the constructs that only exist under one
   * of them — the Slides group appears for a `<slideshow>` and nowhere else.
   */
  rootType?: RootDivisionType;
  /** Called with the formatted content after a successful format operation. */
  onContentChange: (newContent: string) => void;
  /** Opens the Import dialog (outside material converted to PreTeXt). */
  onOpenImport?: () => void;
  /**
   * Whether pasted LaTeX/Markdown is converted on the way in. Omitted for
   * formats where the question doesn't arise, which hides the menu item.
   */
  pasteAutoConvert?: boolean;
  /** Flip {@link pasteAutoConvert}. Omitted alongside it. */
  onTogglePasteAutoConvert?: () => void;
  /**
   * If provided, a "Clean up LaTeX…" item is shown.  Opens the review dialog
   * listing the legacy markup found in this division.  Omitted for formats with
   * no legacy dialect behind them, and on a read-only buffer.
   */
  onOpenClean?: () => void;
  /** Opens the docinfo editor ("Edit Macros" / "Edit Preamble"). */
  onOpenDocinfoEditor: () => void;
  /** Triggers an undo in the Monaco editor.  Passed through from the parent. */
  onUndo: () => void;
  /** Triggers a redo in the Monaco editor.  Passed through from the parent. */
  onRedo: () => void;
  /** Whether the undo item should be enabled. */
  canUndo: boolean;
  /** Whether the redo item should be enabled. */
  canRedo: boolean;
  /** Whether the editor has a non-empty selection (enables cut and copy). */
  hasSelection: boolean;
  /** Monaco-side operations; see {@link EditorMenuActions}. */
  actions: EditorMenuActions;
  /**
   * If provided, a "Convert to PreTeXt" item is shown in Tools.
   * Called when the user selects it to promote the derived PreTeXt to the canonical source.
   */
  onConvertToPretext?: () => void;
  /**
   * Controls whether the "Convert to PreTeXt" item is enabled.
   * Should be `false` when conversion has failed.
   */
  canConvertToPretext?: boolean;
  /** If provided, an "Assets…" item is shown (PreTeXt mode only). */
  onOpenAssets?: () => void;
  /** If provided, a "Snippets…" item is shown (PreTeXt mode only). */
  onOpenSnippets?: () => void;
  /** Opens the assembled-source modal. */
  onShowFullSource: () => void;
  /** If provided, a "Find in Project…" item is shown after Monaco's own Find/Replace. */
  onOpenFindInProject?: () => void;
  /** Whether Monaco's own find widget is currently open. */
  isFindingInFile?: boolean;
  /**
   * If provided (alongside `isFindingInFile`), a "Switch to Find in Project"
   * link is shown in the toolbar while Monaco's find widget is open.
   */
  onSwitchToFindInProject?: () => void;
  hideAssets?: boolean;
  hideSnippets?: boolean;
  /** When true, every editing action is hidden — only viewing actions remain. */
  readOnly?: boolean;
  /**
   * Extra menus rendered before Edit, sharing this bar's open/keyboard-nav
   * state (so Left/Right cycles through them too). Used by `TopBar` to
   * prepend a File menu built from the same entries `Tools` would otherwise
   * show — see `showDocumentActionsInTools`.
   */
  leadingMenus?: BarMenu[];
  /**
   * Extra menus rendered after Tools, sharing this bar's open/keyboard-nav
   * state. Used by `TopBar` to append a Language menu.
   */
  trailingMenus?: BarMenu[];
  /**
   * When `false`, Tools omits the document-actions block (Format PreTeXt,
   * Import, Clean up LaTeX, Edit Macros/Preamble, Assets, Snippets, Display
   * Full Source) because a host is putting it elsewhere — e.g. `TopBar`'s
   * File menu. Defaults to `true`.
   */
  showDocumentActionsInTools?: boolean;
  /** Merged onto the root `role="menubar"` div, so a composing host (`TopBar`) can adjust layout. */
  className?: string;
}

/** Turn a Monaco command into a menu row. */
const commandEntry = (
  command: MonacoCommand,
  run: (id: string) => void,
  overrides: Partial<Extract<MenuEntry, { kind: "item" }>> = {},
): MenuEntry => ({
  kind: "item",
  key: command.id,
  label: command.label,
  shortcut: command.shortcut ? formatShortcut(command.shortcut) : undefined,
  onSelect: () => run(command.id),
  ...overrides,
});

const separator = (key: string): MenuEntry => ({ kind: "separator", key });

/**
 * The code editor's menu bar: Edit, Insert and Tools, plus the format badge.
 *
 * Every format gets the same three menus in the same order — what changes is
 * the contents, not the shape. Document actions that only make sense for one
 * format (Format PreTeXt, Import, Clean up LaTeX) sit together at the
 * top of Tools, above the editor commands that are the same everywhere; the
 * Insert menu offers the same catalog of constructs written in whichever
 * format is open (see `editorConfigs/snippets.ts`).
 *
 * "Convert to PreTeXt" is the one action here that changes what the project
 * *is*, and it is the call to action for an author working in an imported
 * format — it lives as a button on the editor pane itself (see `CodeEditor`,
 * next to the format badge), with a Tools entry alongside the other document
 * actions as a second, more discoverable path to the same action.
 */
const CodeEditorMenu: React.FC<CodeEditorMenuProps> = ({
  content,
  sourceFormat,
  rootType,
  onContentChange,
  onOpenImport,
  pasteAutoConvert,
  onTogglePasteAutoConvert,
  onOpenClean,
  onOpenDocinfoEditor,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  hasSelection,
  actions,
  onConvertToPretext,
  canConvertToPretext,
  onOpenAssets,
  hideAssets,
  onOpenSnippets,
  hideSnippets,
  onShowFullSource,
  onOpenFindInProject,
  isFindingInFile,
  onSwitchToFindInProject,
  readOnly,
  leadingMenus,
  trailingMenus,
  showDocumentActionsInTools,
  className,
}) => {
  // Which menu is open, so opening one closes the last and hovering across the
  // bar switches between them.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // A transient line of feedback, for the operations that can be refused
  // without any visible effect: the clipboard ones.
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  /** Run a clipboard action, reporting a refusal rather than failing silently. */
  const runClipboard = (
    operation: () => Promise<boolean>,
    refusedMessage: string,
  ) => {
    void operation().then((ok) => {
      if (!ok) setNotice(refusedMessage);
    });
  };

  const run = actions.runCommand;

  // ── Edit ──────────────────────────────────────────────────────────────────
  /** One clipboard row: the shortcut always works even when the menu doesn't. */
  const clipboardEntry = (
    key: "cut" | "copy" | "paste",
    label: string,
    shortcut: string,
    operation: () => Promise<boolean>,
    refused: string,
    disabled?: boolean,
  ): MenuEntry => ({
    kind: "item",
    key,
    label,
    shortcut: formatShortcut(shortcut),
    disabled,
    onSelect: () => runClipboard(operation, refused),
  });

  const copyEntry = clipboardEntry(
    "copy",
    "Copy",
    "Mod+C",
    actions.copy,
    "Your browser blocked copying from a menu — use the keyboard shortcut instead.",
    !hasSelection,
  );

  // Select All goes through the parent rather than Monaco's own action: it
  // selects the editable body and leaves the locked structural lines out.
  const selectAllEntry = commandEntry(MONACO_COMMANDS.selectAll, run, {
    onSelect: actions.selectAll,
  });

  // Sits under Paste because it is a property of pasting, and that is where an
  // author goes looking when a paste came out converted and they wanted it
  // verbatim. Only offered where the conversion can actually happen: a
  // read-only buffer takes no pastes, and only a PreTeXt division converts
  // them (see `pasteConvert.ts`).
  const convertPasteEntry: MenuEntry[] =
    !readOnly && sourceFormat === "pretext" && onTogglePasteAutoConvert
      ? [
          {
            kind: "item",
            key: "paste-auto-convert",
            label: "Convert Pasted LaTeX & Markdown",
            title: `When on, LaTeX or Markdown pasted into this division is converted to PreTeXt as it arrives. ${formatShortcut(
              "Mod+Shift+V",
            )} pastes as plain text without converting.`,
            checked: !!pasteAutoConvert,
            onSelect: onTogglePasteAutoConvert,
          },
        ]
      : [];

  const findInProjectEntry: MenuEntry[] = onOpenFindInProject
    ? [
        {
          kind: "item",
          key: "find-in-project",
          label: "Find/Replace in Project…",
          title: "Search and replace across every division",
          shortcut: formatShortcut("Mod+Shift+F"),
          onSelect: onOpenFindInProject,
        },
      ]
    : [];

  // A read-only buffer keeps the operations that only read: copying it,
  // selecting it, searching it.
  const editEntries: MenuEntry[] = readOnly
    ? [
        copyEntry,
        selectAllEntry,
        separator("find"),
        commandEntry(MONACO_COMMANDS.find, run),
        ...findInProjectEntry,
      ]
    : [
        commandEntry(MONACO_COMMANDS.undo, run, {
          disabled: !canUndo,
          onSelect: onUndo,
        }),
        commandEntry(MONACO_COMMANDS.redo, run, {
          disabled: !canRedo,
          onSelect: onRedo,
        }),
        separator("clipboard"),
        clipboardEntry(
          "cut",
          "Cut",
          "Mod+X",
          actions.cut,
          "Your browser blocked cutting from a menu — use the keyboard shortcut instead.",
          !hasSelection,
        ),
        copyEntry,
        clipboardEntry(
          "paste",
          "Paste",
          "Mod+V",
          actions.paste,
          "Your browser blocked reading the clipboard — use the keyboard shortcut to paste.",
        ),
        ...convertPasteEntry,
        selectAllEntry,
        separator("find"),
        commandEntry(MONACO_COMMANDS.find, run),
        commandEntry(MONACO_COMMANDS.replace, run),
        ...findInProjectEntry,
      ];

  // ── Insert ────────────────────────────────────────────────────────────────
  const insertEntries: MenuEntry[] = snippetGroupsFor(sourceFormat, rootType).flatMap(
    (group) => [
      { kind: "heading" as const, key: `heading-${group.key}`, label: group.label },
      ...group.snippets.map(
        (snippet): MenuEntry => ({
          kind: "item",
          key: snippet.key,
          label: snippet.label,
          title: snippet.detail,
          onSelect: () => actions.insertSnippet(snippet),
        }),
      ),
    ],
  );

  // ── Tools ─────────────────────────────────────────────────────────────────
  // Document actions first (they differ by format), then the editor commands,
  // which are the same in every format — unless a host (TopBar) is putting
  // the document actions in its own File menu instead.
  const documentEntries: MenuEntry[] =
    showDocumentActionsInTools === false
      ? []
      : buildDocumentActionEntries({
          content,
          sourceFormat,
          readOnly,
          onContentChange,
          onOpenImport,
          onOpenClean,
          onOpenDocinfoEditor,
          onOpenAssets,
          hideAssets,
          onOpenSnippets,
          hideSnippets,
          onShowFullSource,
        });

  const toolsEntries: MenuEntry[] = [
    ...documentEntries,
    ...(documentEntries.length > 0 ? [separator("editor-commands")] : []),
    commandEntry(MONACO_COMMANDS.commandPalette, run),
    commandEntry(MONACO_COMMANDS.gotoLine, run),
    ...(readOnly ? [] : [commandEntry(MONACO_COMMANDS.quickFix, run)]),
    separator("view"),
    ...(readOnly ? [] : [commandEntry(MONACO_COMMANDS.toggleComment, run)]),
    commandEntry(MONACO_COMMANDS.toggleWordWrap, run),
    commandEntry(MONACO_COMMANDS.foldAll, run),
    commandEntry(MONACO_COMMANDS.unfoldAll, run),
    ...(onConvertToPretext && !readOnly
      ? [
          separator("convert"),
          {
            kind: "item",
            key: "convert-to-pretext",
            label: "Convert to PreTeXt",
            title:
              "Convert this division to use PreTeXt XML",
            disabled: canConvertToPretext === false,
            onSelect: onConvertToPretext,
          } as MenuEntry,
        ]
      : []),
  ];

  const menus: BarMenu[] = [
    ...(leadingMenus ?? []),
    { key: "edit", label: "Edit", entries: editEntries },
    ...(readOnly
      ? []
      : [{ key: "insert", label: "Insert", entries: insertEntries }]),
    { key: "tools", label: "Tools", entries: toolsEntries },
    ...(trailingMenus ?? []),
  ];

  /** Arrow Left/Right inside an open menu moves along the bar. */
  const navigate = (from: number, direction: -1 | 1) => {
    setOpenMenu(menus[(from + direction + menus.length) % menus.length].key);
  };

  return (
    // `relative` only below the `sm` breakpoint (40rem): each MenuDropdown's
    // own wrapper drops its `relative` there too (see MenuDropdown.tsx), so an
    // open panel's `absolute` positioning falls through to this row —
    // anchoring every panel to the row's (viewport-spanning) left edge instead
    // of wherever its own trigger button sits.
    <div
      className={clsx(
        "flex items-center gap-1 w-full border-b border-[#d6d6d6] max-sm:relative",
        className,
      )}
      role="menubar"
      aria-label="Editor actions"
    >
      {menus.map((menu, index) => (
        <MenuDropdown
          key={menu.key}
          label={menu.label}
          entries={menu.entries}
          isOpen={openMenu === menu.key}
          onOpenChange={(open) => setOpenMenu(open ? menu.key : null)}
          menubarActive={openMenu !== null}
          onNavigate={(direction) => navigate(index, direction)}
          disabled={menu.disabled}
        />
      ))}

      {notice && (
        <span
          role="status"
          className="min-w-0 truncate text-[12px] leading-[1.3] text-[#8a4b08] pl-2"
        >
          {notice}
        </span>
      )}

      {isFindingInFile && (
        <span
          role="status"
          className="flex items-center gap-1.5 shrink-0 text-[12px] leading-[1.3] text-[#555] pl-2"
        >
          Searching file
          {onSwitchToFindInProject && (
            <button
              type="button"
              className="text-[#3567d0] hover:underline cursor-pointer bg-transparent border-none p-0 text-[12px]"
              onClick={onSwitchToFindInProject}
            >
              Switch to full Project
            </button>
          )}
        </span>
      )}
    </div>
  );
};

export default CodeEditorMenu;
