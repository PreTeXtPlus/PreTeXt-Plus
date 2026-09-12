import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { formatPretext } from "@pretextbook/format";
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
import { LANGUAGES } from "../languages";
import {
  DialogOverlay,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogActions,
  DialogButton,
  DialogLabel,
} from "./Dialog";

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
  /** Opens the LaTeX import dialog. */
  onOpenLatexImport: () => void;
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
   * If provided, a "Convert to PreTeXt" button is shown.
   * Called when the user clicks to promote the derived PreTeXt to the canonical source.
   */
  onConvertToPretext?: () => void;
  /**
   * Controls whether the "Convert to PreTeXt" button is enabled.
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
  /** When true, the File menu (Document Properties, Save, Cancel) is not shown. */
  hideFileMenu?: boolean;
  /** If provided, a Save item is shown in the File menu. */
  onSaveButton?: () => void;
  /** Label for the Save item. Defaults to `"Save"`. */
  saveButtonLabel?: string;
  /** If provided, a Cancel item is shown in the File menu. */
  onCancelButton?: () => void;
  /** Label for the Cancel item. Defaults to `"Cancel"`. */
  cancelButtonLabel?: string;
  /** Collaborator presence indicator (avatar chips), when collaboration is on. */
  presence?: ReactNode;
  /** The document title, shown/edited via "Document Properties…" in the File menu. */
  title: string;
  /** Commits a new document title. */
  onTitleChange: (value: string) => void;
  /** The document's `@xml:lang`, edited alongside the title. */
  language: string;
  /** Commits a new document language. */
  onLanguageChange: (value: string) => void;
  /** Rendered feedback-link trigger (and its dialog), built by the host. */
  feedbackLink?: ReactNode;
}

/**
 * The document title and language, edited together in one small dialog since
 * neither fits a plain clickable menu item.
 */
const DocumentPropertiesDialog = ({
  title,
  onTitleChange,
  language,
  onLanguageChange,
  onClose,
}: {
  title: string;
  onTitleChange: (value: string) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  onClose: () => void;
}) => {
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftLanguage, setDraftLanguage] = useState(language);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, []);

  const handleSave = () => {
    onTitleChange(draftTitle);
    onLanguageChange(draftLanguage);
    onClose();
  };

  return (
    <DialogOverlay onClick={onClose}>
      <Dialog
        className="w-[min(96%,480px)] h-auto max-h-[min(90%,480px)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-properties-title"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle id="document-properties-title">
            Document Properties
          </DialogTitle>
          <DialogClose onClick={onClose} aria-label="Close dialog">
            Close
          </DialogClose>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            handleSave();
          }}
        >
          <div className="flex flex-col gap-1">
            <DialogLabel htmlFor="document-properties-title-input">
              Title
            </DialogLabel>
            <input
              ref={titleInputRef}
              id="document-properties-title-input"
              type="text"
              className="w-full py-1.5 px-2 rounded-[3px] border border-gray-400 bg-white focus:outline focus:outline-2 focus:outline-blue-500 focus:outline-offset-2"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <DialogLabel htmlFor="document-properties-language-input">
              Language
            </DialogLabel>
            <select
              id="document-properties-language-input"
              className="w-full py-1.5 px-2 rounded-[3px] border border-gray-400 bg-white focus:outline focus:outline-2 focus:outline-blue-500 focus:outline-offset-2"
              value={draftLanguage}
              onChange={(e) => setDraftLanguage(e.target.value)}
            >
              {LANGUAGES.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <DialogActions>
            <DialogButton type="button" variant="secondary" onClick={onClose}>
              Cancel
            </DialogButton>
            <DialogButton type="submit">Save</DialogButton>
          </DialogActions>
        </form>
      </Dialog>
    </DialogOverlay>
  );
};

const CONVERT_BUTTON_CLASSES =
  "shrink-0 py-[5px] px-2.5 rounded-[3px] border border-transparent cursor-pointer text-[13px] font-medium leading-[1.3] transition-colors duration-150 ease-in-out bg-blue-600 text-white enabled:hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed";

const FORMAT_LABELS: Record<SourceFormat, string> = {
  pretext: "PreTeXt",
  latex: "LaTeX",
  markdown: "Markdown",
};

/** The docinfo editor is named for what that format keeps in it. */
const docinfoNaming = (
  sourceFormat: SourceFormat,
): { label: string; title: string } =>
  sourceFormat === "latex"
    ? {
        label: "Edit Preamble…",
        title: "Edit the LaTeX preamble shared by the whole project",
      }
    : {
        label: "Edit Macros…",
        title: "Edit the math macros shared by the whole project",
      };

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
 * The code editor's menu bar: File, Edit, Insert and Tools, plus the format
 * badge. This is the editor's only toolbar — document-level actions (rename,
 * change language, save, cancel) live in File rather than a separate bar
 * above it, alongside the presence avatars, read-only badge and feedback link.
 *
 * Every format gets the same menus in the same order — what changes is the
 * contents, not the shape. Document actions that only make sense for one
 * format (Format PreTeXt, Import LaTeX, Clean up LaTeX) sit together at the
 * top of Tools, above the editor commands that are the same everywhere; the
 * Insert menu offers the same catalog of constructs written in whichever
 * format is open (see `editorConfigs/snippets.ts`).
 *
 * "Convert to PreTeXt" stays a button rather than a menu item: it is the one
 * action here that changes what the project *is*, and it is the call to action
 * for an author working in an imported format.
 */
const CodeEditorMenu: React.FC<CodeEditorMenuProps> = ({
  content,
  sourceFormat,
  rootType,
  onContentChange,
  onOpenLatexImport,
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
  hideFileMenu,
  onSaveButton,
  saveButtonLabel,
  onCancelButton,
  cancelButtonLabel,
  presence,
  title,
  onTitleChange,
  language,
  onLanguageChange,
  feedbackLink,
}) => {
  // Which menu is open, so opening one closes the last and hovering across the
  // bar switches between them.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // A transient line of feedback, for the operations that can be refused
  // without any visible effect: the clipboard ones.
  const [notice, setNotice] = useState<string | null>(null);
  const [isDocumentPropertiesOpen, setIsDocumentPropertiesOpen] = useState(false);

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

  const handleFormat = () => {
    try {
      onContentChange(formatPretext(content));
    } catch (error) {
      console.error("Error formatting:", error);
      alert("Error formatting XML");
    }
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
  // which are the same in every format.
  const documentEntries: MenuEntry[] = [];
  if (!readOnly) {
    if (sourceFormat === "pretext") {
      documentEntries.push({
        kind: "item",
        key: "format",
        label: "Format PreTeXt",
        title: "Re-indent the PreTeXt source",
        onSelect: handleFormat,
      });
      documentEntries.push({
        kind: "item",
        key: "import-latex",
        label: "Import LaTeX…",
        title: "Convert pasted LaTeX into this division",
        onSelect: onOpenLatexImport,
      });
    }
    if (onOpenClean) {
      documentEntries.push({
        kind: "item",
        key: "clean",
        label: "Clean up LaTeX…",
        title: "Review LaTeX markup that does not belong in PreTeXt, and fix it",
        onSelect: onOpenClean,
      });
    }
    documentEntries.push({
      kind: "item",
      key: "docinfo",
      ...docinfoNaming(sourceFormat),
      onSelect: onOpenDocinfoEditor,
    });
    if (onOpenAssets && !hideAssets) {
      documentEntries.push({
        kind: "item",
        key: "assets",
        label: "Assets…",
        title: "Manage the project's images and other assets",
        onSelect: onOpenAssets,
      });
    }
    if (onOpenSnippets && !hideSnippets) {
      documentEntries.push({
        kind: "item",
        key: "snippets",
        label: "Snippets…",
        title: "Manage the project's reusable source snippets",
        onSelect: onOpenSnippets,
      });
    }
  }
  documentEntries.push({
    kind: "item",
    key: "full-source",
    label: "Display Full Source",
    title: "Show the full assembled PreTeXt source for the project",
    onSelect: onShowFullSource,
  });

  const toolsEntries: MenuEntry[] = [
    ...documentEntries,
    separator("editor-commands"),
    commandEntry(MONACO_COMMANDS.commandPalette, run),
    commandEntry(MONACO_COMMANDS.gotoLine, run),
    ...(readOnly ? [] : [commandEntry(MONACO_COMMANDS.quickFix, run)]),
    separator("view"),
    ...(readOnly ? [] : [commandEntry(MONACO_COMMANDS.toggleComment, run)]),
    commandEntry(MONACO_COMMANDS.toggleWordWrap, run),
    commandEntry(MONACO_COMMANDS.foldAll, run),
    commandEntry(MONACO_COMMANDS.unfoldAll, run),
  ];

  // ── File ──────────────────────────────────────────────────────────────────
  const fileEntries: MenuEntry[] = [
    ...(readOnly
      ? []
      : [
          {
            kind: "item" as const,
            key: "document-properties",
            label: "Document Properties…",
            title: "Edit the document title and language",
            onSelect: () => setIsDocumentPropertiesOpen(true),
          },
          separator("file-document"),
        ]),
    ...(onSaveButton
      ? [
          {
            kind: "item" as const,
            key: "save",
            label: saveButtonLabel || "Save",
            onSelect: onSaveButton,
          },
        ]
      : []),
    ...(onCancelButton
      ? [
          {
            kind: "item" as const,
            key: "cancel",
            label: cancelButtonLabel || "Cancel",
            onSelect: onCancelButton,
          },
        ]
      : []),
  ];

  const menus = [
    ...(hideFileMenu
      ? []
      : [{ key: "file", label: "File", entries: fileEntries }]),
    { key: "edit", label: "Edit", entries: editEntries },
    ...(readOnly
      ? []
      : [{ key: "insert", label: "Insert", entries: insertEntries }]),
    { key: "tools", label: "Tools", entries: toolsEntries },
  ];

  /** Arrow Left/Right inside an open menu moves along the bar. */
  const navigate = (from: number, direction: -1 | 1) => {
    setOpenMenu(menus[(from + direction + menus.length) % menus.length].key);
  };

  return (
    <div
      className="flex items-center gap-1 py-1.5 px-2.5 w-full bg-[#f3f3f3] border-b border-[#d6d6d6]"
      role="menubar"
      aria-label="Editor actions"
    >
      <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto">
        {menus.map((menu, index) => (
          <MenuDropdown
            key={menu.key}
            label={menu.label}
            entries={menu.entries}
            isOpen={openMenu === menu.key}
            onOpenChange={(open) => setOpenMenu(open ? menu.key : null)}
            menubarActive={openMenu !== null}
            onNavigate={(direction) => navigate(index, direction)}
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

        <span className="flex items-center gap-2 ml-auto pl-2 shrink-0">
          {feedbackLink}
          {onConvertToPretext && !readOnly && (
            <button
              type="button"
              className={CONVERT_BUTTON_CLASSES}
              onClick={onConvertToPretext}
              disabled={canConvertToPretext === false}
              title="Create a new project copy using the converted PreTeXt source"
              aria-label="Convert to PreTeXt"
            >
              <span className="hidden sm:inline">Convert to PreTeXt</span>
              <span className="sm:hidden">Convert</span>
            </button>
          )}
          <span className="inline-flex items-center py-0.5 px-2 rounded-full bg-gray-200 text-gray-800 text-xs font-semibold">
            {FORMAT_LABELS[sourceFormat]}
          </span>
        </span>
      </div>

      <span className="flex items-center gap-2 pl-2 shrink-0">
        {presence}
        {readOnly && (
          <span className="inline-block py-0.5 px-2 rounded-[3px] bg-[#a32899] text-white text-xs font-semibold">
            Read-only Mode
          </span>
        )}
      </span>

      {isDocumentPropertiesOpen && (
        <DocumentPropertiesDialog
          title={title}
          onTitleChange={onTitleChange}
          language={language}
          onLanguageChange={onLanguageChange}
          onClose={() => setIsDocumentPropertiesOpen(false)}
        />
      )}
    </div>
  );
};

export default CodeEditorMenu;
