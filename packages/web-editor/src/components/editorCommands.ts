/**
 * The imperative half of the code editor's menus: the Monaco commands the Edit
 * and Tools menus run, plus the clipboard and snippet operations that Monaco
 * either can't do from a menu or does differently than we want.
 *
 * Kept out of the components so the command ids live in one place — a Monaco
 * upgrade that renames an action id breaks here and nowhere else — and so each
 * operation can be exercised against a stub editor in tests.
 *
 * Every function takes the Monaco editor instance (`any`, exactly as
 * `CodeEditor` holds it) and tolerates `null`, since the menus render before
 * Monaco's loader has produced an editor.
 */
import type { LineRange } from "./lockedRegion";
import { snippetPlainText } from "./editorConfigs/snippets";

/** A Monaco command as a menu row: what to run, what to call it. */
export interface MonacoCommand {
  /** Monaco action id, or a core trigger keyword like `undo`. */
  id: string;
  label: string;
  /** Shortcut hint in `Mod+Z` shorthand — see {@link formatShortcut}. */
  shortcut?: string;
}

/**
 * The Monaco commands offered in the menus. Undo and redo are core *triggers*
 * rather than registered actions, which is why {@link runEditorCommand} falls
 * back to `trigger` when `getAction` comes up empty.
 */
export const MONACO_COMMANDS = {
  undo: { id: "undo", label: "Undo", shortcut: "Mod+Z" },
  redo: { id: "redo", label: "Redo", shortcut: "Mod+Shift+Z" },
  selectAll: {
    id: "editor.action.selectAll",
    label: "Select All",
    shortcut: "Mod+A",
  },
  find: { id: "actions.find", label: "Find in File…", shortcut: "Mod+F" },
  replace: {
    id: "editor.action.startFindReplaceAction",
    label: "Replace in File…",
    shortcut: "Mod+H",
  },
  commandPalette: {
    id: "editor.action.quickCommand",
    label: "Command Palette…",
    shortcut: "F1",
  },
  gotoLine: {
    id: "editor.action.gotoLine",
    label: "Go to Line…",
    shortcut: "Ctrl+G",
  },
  quickFix: {
    id: "editor.action.quickFix",
    label: "Quick Fix…",
    shortcut: "Mod+.",
  },
  toggleComment: {
    id: "editor.action.commentLine",
    label: "Toggle Comment",
    shortcut: "Mod+/",
  },
  toggleWordWrap: {
    id: "editor.action.toggleWordWrap",
    label: "Toggle Word Wrap",
    shortcut: "Alt+Z",
  },
  foldAll: { id: "editor.foldAll", label: "Fold All" },
  unfoldAll: { id: "editor.unfoldAll", label: "Unfold All" },
} as const satisfies Record<string, MonacoCommand>;

/** True on macOS, where menu shortcuts read `⌘` rather than `Ctrl`. */
export const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Renders a shortcut hint for this platform: `Mod` is the primary modifier,
 * `⌘` on macOS and `Ctrl` elsewhere.
 */
export const formatShortcut = (shortcut: string, isMac = isMacPlatform()): string =>
  isMac
    ? shortcut.replace(/Mod\+/g, "⌘").replace(/Alt\+/g, "⌥").replace(/Shift\+/g, "⇧")
    : shortcut.replace(/Mod\+/g, "Ctrl+");

/**
 * Run a Monaco command by id, focusing the editor first — the find widget, the
 * command palette and the quick-fix menu all open against the focused editor,
 * and focus is on the menu button at this point.
 *
 * Registered actions go through `getAction`; core commands (undo/redo) have no
 * action entry and are triggered instead.
 */
export const runEditorCommand = (editor: any, id: string): void => {
  if (!editor) return;
  editor.focus?.();
  const action = editor.getAction?.(id);
  if (action) {
    action.run();
    return;
  }
  editor.trigger?.("pretext-plus-menu", id, null);
};

/**
 * Select the division's editable body rather than the whole buffer.
 *
 * A division's structural lines are locked (see {@link ./lockedRegion}), so a
 * plain select-all hands the author a selection that mostly can't be acted on:
 * typing over it, cutting it or pasting into it is reverted by the
 * constrained-editor plugin (or refused by the collab guard), and the one thing
 * that does work — copying — picks up wrapper markup the author never sees as
 * theirs. Restricting the selection to `editable` makes Select All mean
 * "everything you can act on", in the menu and under Mod+A alike.
 *
 * Falls back to Monaco's own select-all when `editable` is null — nothing is
 * locked, or the buffer is read-only, where the whole document is protected and
 * selecting all of it to copy is exactly the intent.
 */
export const selectEditableRegion = (
  editor: any,
  editable: LineRange | null,
): void => {
  if (!editor) return;
  if (!editable) {
    runEditorCommand(editor, MONACO_COMMANDS.selectAll.id);
    return;
  }
  editor.focus?.();
  const [startLineNumber, startColumn, endLineNumber, endColumn] = editable;
  editor.setSelection?.({
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn,
  });
};

/** The editor's selected text, or `""` when the selection is empty. */
const selectedText = (editor: any): string => {
  const model = editor?.getModel?.();
  const selection = editor?.getSelection?.();
  if (!model || !selection || selection.isEmpty?.()) return "";
  return model.getValueInRange(selection);
};

/**
 * Write `text` to the system clipboard.
 *
 * The async clipboard API is used rather than Monaco's own clipboard actions:
 * those copy whatever the *document* selection is at the time, and by the time
 * a menu item is clicked that selection is the menu, not the editor.
 */
const writeClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Blocked, or no clipboard API (older browsers, insecure origin).
    return false;
  }
};

/** Copy the selection. Resolves `false` if the browser refused. */
export const copySelection = async (editor: any): Promise<boolean> => {
  const text = selectedText(editor);
  if (!text) return true; // Nothing selected: not a failure, just a no-op.
  const copied = await writeClipboard(text);
  editor?.focus?.();
  return copied;
};

/** Copy the selection and delete it, as one undo step. */
export const cutSelection = async (editor: any): Promise<boolean> => {
  const text = selectedText(editor);
  if (!text) return true;
  if (!(await writeClipboard(text))) return false;
  const selection = editor.getSelection();
  editor.executeEdits("menu-cut", [
    { range: selection, text: "", forceMoveMarkers: true },
  ]);
  editor.focus?.();
  return true;
};

/**
 * Paste the clipboard over the current selection.
 *
 * Reading the clipboard is the operation browsers guard most tightly: Chromium
 * prompts, Firefox shows its own paste confirmation, and either may refuse
 * outright. A `false` result is the caller's cue to point the author at
 * the keyboard shortcut, which is never blocked.
 */
export const pasteFromClipboard = async (editor: any): Promise<boolean> => {
  if (!editor) return false;
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return false;
  }
  const selection = editor.getSelection();
  if (!selection) return false;
  editor.executeEdits("menu-paste", [
    { range: selection, text, forceMoveMarkers: true },
  ]);
  editor.focus?.();
  return true;
};

/**
 * Insert Monaco snippet text at the cursor, with its tab stops live.
 *
 * `snippetController2` is Monaco's own snippet session — the same one code
 * completions use — so the inserted text is re-indented to the cursor's line
 * and `$1`/`$0` become fields the author tabs through. It is a contribution
 * rather than public API, so an editor build without it falls back to a plain
 * edit of the placeholder-stripped text.
 */
export const insertSnippet = (editor: any, body: string): void => {
  if (!editor) return;
  editor.focus?.();
  const controller = editor.getContribution?.("snippetController2");
  if (controller?.insert) {
    controller.insert(body);
    return;
  }
  const selection = editor.getSelection?.();
  if (!selection) return;
  editor.executeEdits("menu-insert-snippet", [
    { range: selection, text: snippetPlainText(body), forceMoveMarkers: true },
  ]);
};
