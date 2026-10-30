import { Editor } from "@monaco-editor/react";
import { useState, useRef, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle, type ReactNode } from "react";
import {
  copySelection,
  cutSelection,
  insertSnippet,
  pasteFromClipboard,
  runEditorCommand,
  MONACO_COMMANDS,
} from "./editorCommands";
import type { EditorMenuActions } from "./CodeEditorMenu";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { editorConfigs } from "./editorConfigs";
import type { MonacoExtensionContext } from "./editorConfigs/types";
import { applyCleanFixes, fixesForModel } from "./editorConfigs/latexClean";
import { summarizeCleanFixes, type CleanFinding } from "../cleanFindings";
import { usePretextDiagnostics } from "./editorConfigs/usePretextDiagnostics";
import { usePlacementDiagnostics } from "./editorConfigs/usePlacementDiagnostics";
import type { PlacementCheckInput } from "./editorConfigs/placementDiagnostics";
import type { PretextValidationInput } from "./editorConfigs/pretextDiagnostics";
import { MonacoCollabBinding } from "../collab/monacoBinding";
import { planSnippetInsertion } from "./editorConfigs/insertContext";
import type { EditorSnippet } from "./editorConfigs/snippets";
import type { CollabUser } from "../collab/types";
import type { EditorLanguage } from "../types/editor";
import { installPasteConvertListener } from "../pasteConvert";

/** Every buffer format's Monaco language, for the placement quick fix. */
const PLACEMENT_LANGUAGE_IDS = Object.values(editorConfigs).map((config) => config.language);

/** Live-collaboration wiring for the open buffer's shared text. */
export interface CodeEditorCollab {
  ytext: Y.Text;
  awareness: Awareness;
  user: CollabUser;
  /**
   * Identifies the open buffer — a division, snippet or asset — so remote
   * cursors are drawn only in the buffer they belong to.
   */
  bufferKey: string;
  /** Register/unregister the Monaco binding as a local Y.Doc origin. */
  registerLocalOrigin: (origin: unknown) => void;
  unregisterLocalOrigin: (origin: unknown) => void;
}

interface CodeEditorProps {
  /** The current source content to display. */
  content: string;
  /**
   * Names the buffer `content` belongs to — a division, snippet or asset
   * (`editorTargetKey`). When it changes, the cursor, selection and scroll
   * position of the buffer being left are remembered under its key and the
   * new buffer's are restored, so switching tabs and back lands where the
   * author was. A buffer seen for the first time starts at the top.
   */
  bufferKey?: string;
  /**
   * Determines the Monaco language mode — see `editorConfigs`, which maps this
   * to `"xml"`, `"pretext-latex"`, or `"pretext-markdown"`.
   */
  sourceFormat: EditorLanguage;
  /** Called (debounced 500 ms) whenever the user edits the content. */
  onChange: (value: string | undefined) => void;
  /** If provided, Ctrl+Enter in the editor triggers this callback. */
  onRebuild?: () => void;
  /** If provided, Ctrl+S in the editor triggers this callback. */
  onSave?: () => void;
  /**
   * Called with the 1-based line whenever the cursor moves to a different
   * line. Drives source → preview sync. Fires only on a genuine line change,
   * not on horizontal movement or on programmatic reveals.
   */
  onCursorLineChange?: (line: number) => void;
  /**
   * If provided, Ctrl+Shift+F opens the project-wide Find/Replace drawer, and
   * the toolbar's "Find/Replace in Project…" menu item (rendered externally —
   * see `onMenuStateChange`) calls it too.
   */
  onOpenFindInProject?: () => void;
  /**
   * Called when the user clicks any locked leading line of the wrapper (the
   * opening tag, and the title line right after it when present). Hosts use
   * this to open the division's properties editor in the Table of Contents,
   * since the tag/title/xml:id aren't editable in-place.
   */
  onRequestWrapperEdit?: () => void;
  /**
   * Generated lines drawn, locked, around the buffer without being part of it —
   * an asset's `<image>` wrapper around its authored source, a division's
   * element around its body. They're rendered
   * as Monaco view zones, so the model (and a collab binding to it) holds only
   * the buffer's own text. Clicking one calls `onRequestWrapperEdit`. Memoize
   * it; a new identity each render redraws the zones.
   */
  virtualWrapper?: VirtualWrapper;
  /** When true, Monaco is non-editable. */
  readOnly?: boolean;
  /**
   * Convert LaTeX or Markdown pasted into a PreTeXt division on the way in.
   * Defaults to on; the author's remembered choice lives in the store.
   */
  pasteAutoConvert?: boolean;
  /**
   * Reports the Monaco-derived state (undo/redo/selection availability, the
   * clipboard/select-all/insert actions, and find-in-file status) that only
   * this component — the one holding the live Monaco instance — can produce.
   * The host (`Editors`/`TopBar`) uses this to render the Edit/Insert/Tools
   * toolbar externally, since this component no longer renders its own.
   * Fires once after mount and again whenever the reported state actually
   * changes.
   */
  onMenuStateChange?: (state: CodeEditorMenuState) => void;
  /**
   * When set, the editor model is bound to this shared `Y.Text` instead of
   * being driven by the `content` prop: keystrokes emit CRDT deltas, remote
   * edits land in the model directly, and remote cursors render as colored
   * carets.
   */
  collab?: CodeEditorCollab;
  /**
   * Texts for a PreTeXt schema lint pass: the buffer, and the assembled
   * document built from it. Omit for non-PreTeXt formats (or to turn linting
   * off) and any existing markers are cleared.
   *
   * Passed in rather than derived here because only `Editors` can assemble the
   * document — see `editorConfigs/pretextDiagnostics.ts` for why the buffer
   * alone cannot be validated. Memoize it; a new object identity each render
   * would restart the debounce forever and never lint.
   */
  pretextValidation?: PretextValidationInput;
  /**
   * The project's other placements, against which the placeholders in this
   * buffer are checked for a record placed twice without an instance name
   * (see `editorConfigs/placementDiagnostics.ts`). Memoize it, as above.
   */
  placementCheck?: PlacementCheckInput;
  /**
   * Collaborator presence indicator (avatar chips), when collaboration is on.
   * Rendered floating over the editor's lower-right corner, next to the
   * source-format badge.
   */
  presence?: ReactNode;
  /**
   * If provided, a "Convert to PreTeXt" button is shown floating over the
   * editor's lower-right corner, next to the source-format badge.
   * Called when the user clicks to promote the derived PreTeXt to the canonical source.
   */
  onConvertToPretext?: () => void;
  /**
   * Controls whether the "Convert to PreTeXt" button is enabled.
   * Should be `false` when conversion has failed.
   */
  canConvertToPretext?: boolean;
}

/**
 * Monaco-derived reactive state, reported via `onMenuStateChange` so a host
 * can render the Edit/Insert/Tools toolbar outside this component (e.g. in a
 * full-width `TopBar`) while still driving it from the live Monaco instance
 * only this component holds.
 */
export interface CodeEditorMenuState {
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  onUndo: () => void;
  onRedo: () => void;
  actions: EditorMenuActions;
  isFindingInFile: boolean;
  /** Closes Monaco's own find widget, then calls `onOpenFindInProject`. No-op if none was provided. */
  switchToFindInProject: () => void;
}

/** Imperative handle exposed via `forwardRef` for programmatic control. */
export interface CodeEditorHandle {
  /** Insert `text` at the current cursor position (or replace the selection). */
  insertAtCursor: (text: string) => void;
  /** Move keyboard focus into the editor, ready for typing. */
  focus: () => void;
  /** Put the cursor on `line`, scrolling it into view if it is off-screen. */
  revealLine: (line: number) => void;
  /**
   * Select `[startLine:startCol, endLine:endCol]` (1-based), scrolling it into
   * view if it is off-screen. Used to highlight a project-wide find match,
   * which — unlike a preview-sync click — names a span, not just a line.
   */
  revealRange: (
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
  ) => void;
  /**
   * Apply `edits` to the current model as one undoable step — the same
   * `pushStackElement`-bracketed `pushEditOperations` idiom `applyCleanFixes`
   * uses, so the batch is one Ctrl+Z rather than one per replacement, and
   * (in collab mode) reaches the shared doc through the same guarded path a
   * keystroke would. Returns `false` with no effect if there's no live model
   * to edit — the caller's target division isn't the one currently open.
   */
  applyEdits: (
    edits: {
      startLine: number;
      startCol: number;
      endLine: number;
      endCol: number;
      text: string;
    }[],
  ) => boolean;
  /**
   * Source-cleanup findings for the buffer as it stands, one row per rule.
   * Empty for a format with no cleanup engine. Read (not pushed) because the
   * dialog that renders it is opened on demand and must never show a list that
   * predates the author's last keystroke.
   */
  getCleanFindings: () => CleanFinding[];
  /**
   * Apply the auto-fixable cleanup findings — all of them, or just `ruleIds` —
   * as one undo step. A no-op for a format with no cleanup engine.
   */
  applyCleanFixes: (ruleIds?: string[]) => void;
  /**
   * Deliver a debounced `onChange` that is still waiting, immediately, and
   * cancel its timer. A no-op when nothing is pending.
   *
   * Typing reaches the store 500 ms late (see the debounce below), so for that
   * window the buffer and the pool disagree — and a structural action taken in
   * that window computes from a source the author has already moved on from,
   * while the pending delivery lands *afterwards* and reinstates the
   * pre-action text. Callers that are about to rewrite a division's source
   * from the pool (adding a child, renaming an xml:id) flush first, so the
   * author's keystrokes are the state those rewrites start from.
   */
  flushPendingChange: () => void;
}

/** Labels for the floating source-format badge in the editor's lower-right corner. */
const FORMAT_LABELS: Record<EditorLanguage, string> = {
  pretext: "PreTeXt",
  latex: "LaTeX",
  markdown: "Markdown",
  tex: "TeX",
};

const CONVERT_BUTTON_CLASSES =
  "shrink-0 py-0.5 px-1.5 rounded-[3px] border border-transparent cursor-pointer text-[13px] font-medium leading-[1.3] transition-colors duration-150 ease-in-out bg-blue-600 text-white enabled:hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed";

/** Base Monaco editor options shared across all instances of this component. */
const baseOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  acceptSuggestionOnCommitCharacter: false,
  quickSuggestions: false,
  wordWrap: "on" as const,
  // Always two spaces, the indent Format PreTeXt writes. Monaco would
  // otherwise guess the indent from the buffer — once, from whichever division
  // was open when the model was created, since later divisions arrive by
  // `setValue`, which doesn't re-guess — so one 4-space division made every
  // snippet, Tab and auto-indent 4 spaces for the rest of the session.
  detectIndentation: false,
  insertSpaces: true,
  tabSize: 2,
  padding: { top: 10, bottom: 10 },
};

/**
 * Monaco-based code editor with an attached toolbar.
 *
 * Manages its own undo/redo state so the toolbar buttons stay in sync with
 * the editor model.  `onRebuild` and `onSave` callbacks are stored in refs
 * so keyboard shortcuts registered at mount time always call the latest
 * version without needing to re-register.
 *
 * Content is synced from props only when the prop value differs from what the
 * editor model already contains, to prevent cursor jumps on re-render.
 *
 * Exposes a {@link CodeEditorHandle} via `forwardRef` for programmatic control.
 */
/** How many buffers' view states are remembered — see `bufferKey`. */
const MAX_VIEW_STATES = 32;

/** See {@link CodeEditorProps.virtualWrapper}. */
export interface VirtualWrapper {
  /** Lines drawn above the first line of the buffer. */
  before: string[];
  /** Lines drawn below the last line of the buffer. */
  after: string[];
  /** Tooltip shown when hovering over the wrapper lines. */
  hoverMessage?: string;
}

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(({
  content,
  bufferKey,
  sourceFormat,
  onChange,
  onRebuild,
  onSave,
  onCursorLineChange,
  onOpenFindInProject,
  onRequestWrapperEdit,
  virtualWrapper,
  readOnly,
  pasteAutoConvert = true,
  onMenuStateChange,
  pretextValidation,
  placementCheck,
  collab,
  presence,
  onConvertToPretext,
  canConvertToPretext,
}, ref) => {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  // The live Monaco↔Y.Text binding when collaboration is on. Read through a
  // ref inside mount handlers, which aren't re-created per
  // render.
  const collabRef = useRef(collab);
  collabRef.current = collab;
  const collabBindingRef = useRef<MonacoCollabBinding | null>(null);
  // Handed to each format's `registerMonacoExtensions`. It reads the binding
  // lazily, since the binding is created (and replaced) after they register.
  const extensionContextRef = useRef<MonacoExtensionContext>({
    isRemoteChange: () => collabBindingRef.current?.isApplyingRemote ?? false,
  });
  // The live source format, read from inside mount-time closures.
  const sourceFormatRef = useRef(sourceFormat);
  sourceFormatRef.current = sourceFormat;
  // The latest `content` prop, for realigning the model when a collab binding
  // goes away with nothing to replace it (see rebindCollab).
  const contentPropRef = useRef(content);
  contentPropRef.current = content;
  // Read from mount-time closures, which are registered once.
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  // Read from the mount-time paste listener, likewise registered once.
  const pasteAutoConvertRef = useRef(pasteAutoConvert);
  pasteAutoConvertRef.current = pasteAutoConvert;
  // Read from `handleEditorMount`, which @monaco-editor/react keeps from its
  // first render: a remount (the layout switch) can hand the previous editor's
  // unreported typing to the host after that render, so the closure's
  // `content` would be the text from before it.
  const contentRef = useRef(content);
  contentRef.current = content;
  /** Removes the DOM paste listener; see `handleEditorMount`. */
  const pasteListenerRef = useRef<(() => void) | null>(null);
  const contentListenerRef = useRef<{ dispose: () => void } | null>(null);
  const mouseListenerRef = useRef<{ dispose: () => void } | null>(null);
  const cursorListenerRef = useRef<{ dispose: () => void } | null>(null);
  const selectionListenerRef = useRef<{ dispose: () => void } | null>(null);
  const onCursorLineChangeRef = useRef(onCursorLineChange);
  // Last line reported, so a cursor moving along one line stays quiet.
  const lastCursorLineRef = useRef<number | null>(null);
  // Set while `revealLine` moves the cursor itself. Without it, syncing from
  // the preview would move the cursor, which would report a line change, which
  // would scroll the preview back — a loop between the two panes.
  const suppressCursorReportRef = useRef(false);
  const onRequestWrapperEditRef = useRef(onRequestWrapperEdit);
  const virtualWrapperRef = useRef(virtualWrapper);
  virtualWrapperRef.current = virtualWrapper;
  // The view zones currently drawing `virtualWrapper`, and what they were drawn
  // for: the wrapper, and the line count the closing zone is anchored below.
  const wrapperZonesRef = useRef<{
    ids: string[];
    wrapper: VirtualWrapper | undefined;
    lineCount: number;
  }>({ ids: [], wrapper: undefined, lineCount: 0 });
  // Per-format Monaco language extensions (completions, diagnostics, syntax),
  // torn down and re-registered whenever the source format changes.
  const languageExtensionsRef = useRef<{ dispose: () => void } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The delivery the debounce timer is holding, so `flushPendingChange` can
  // send it early. It closes over the buffer *and* over the render that
  // produced it — which is the point: a change belongs to the division that
  // was open when it was typed, not to whichever one is open when it lands.
  const pendingChangeRef = useRef<(() => void) | null>(null);
  const isProgrammaticUpdateRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // Drives the Edit menu's Cut/Copy, which act on the selection.
  const [hasSelection, setHasSelection] = useState(false);
  // Monaco arrives asynchronously (the loader fetches it), so effects that
  // need the editor instance have to wait for it. The refs alone can't say
  // when that happened — they don't re-render.
  const [isEditorMounted, setIsEditorMounted] = useState(false);
  const onRebuildRef = useRef(onRebuild);
  const onSaveRef = useRef(onSave);
  const onOpenFindInProjectRef = useRef(onOpenFindInProject);
  // Monaco's own find-widget controller, so the toolbar can close it when the
  // author switches to Find in Project instead of leaving both UIs open.
  const findControllerRef = useRef<any>(null);
  const findStateListenerRef = useRef<{ dispose: () => void } | null>(null);
  // Drives the toolbar's "Finding in file" status, read from Monaco's own
  // find contribution rather than watching its DOM.
  const [isFindingInFile, setIsFindingInFile] = useState(false);
  const options = useMemo(
    () => ({ ...baseOptions, readOnly: !!readOnly }),
    [readOnly],
  );

  useImperativeHandle(ref, () => ({
    insertAtCursor: (text: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      const selection = editor.getSelection();
      if (!selection) return;
      editor.executeEdits("insert-asset", [
        { range: selection, text, forceMoveMarkers: true },
      ]);
      editor.focus();
    },
    focus: () => {
      editorRef.current?.focus();
    },
    revealLine: (line: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      // Focus first: an unfocused Monaco draws no cursor and no current-line
      // highlight, so a sync that moved the caret correctly would still look
      // like nothing happened. Clicking the preview to find a spot in the
      // source is a request to go there, so taking focus is the intent.
      editor.focus();
      suppressCursorReportRef.current = true;
      try {
        // Centred only if it is off-screen, so syncing from the preview does
        // not jerk the view when the target is already comfortably visible.
        editor.revealLineInCenterIfOutsideViewport(line);
        editor.setPosition({ lineNumber: line, column: 1 });
      } finally {
        // The cursor event fires synchronously inside setPosition, so the flag
        // has already done its job by the time this runs.
        suppressCursorReportRef.current = false;
      }
      lastCursorLineRef.current = line;
    },
    revealRange: (startLine, startCol, endLine, endCol) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      suppressCursorReportRef.current = true;
      try {
        const range = {
          startLineNumber: startLine,
          startColumn: startCol,
          endLineNumber: endLine,
          endColumn: endCol,
        };
        editor.revealRangeInCenterIfOutsideViewport(range);
        editor.setSelection(range);
      } finally {
        suppressCursorReportRef.current = false;
      }
      lastCursorLineRef.current = endLine;
    },
    applyEdits: (edits) => {
      const model = editorRef.current?.getModel?.();
      if (!model || edits.length === 0) return false;
      model.pushStackElement();
      model.pushEditOperations(
        [],
        edits.map((e) => ({
          range: {
            startLineNumber: e.startLine,
            startColumn: e.startCol,
            endLineNumber: e.endLine,
            endColumn: e.endCol,
          },
          text: e.text,
          forceMoveMarkers: true,
        })),
        () => null,
      );
      model.pushStackElement();
      return true;
    },
    // Both cleanup methods read the format from its ref rather than closing
    // over the prop: this handle is built once (`[]`), while the editor lives
    // across division switches, so a captured `sourceFormat` would go stale.
    getCleanFindings: () => {
      const clean = editorConfigs[sourceFormatRef.current].clean;
      if (!clean) return [];
      return summarizeCleanFixes(
        fixesForModel(editorRef.current?.getModel?.(), clean),
        clean.describeFix,
      );
    },
    applyCleanFixes: (ruleIds?: string[]) => {
      const clean = editorConfigs[sourceFormatRef.current].clean;
      if (!clean) return;
      applyCleanFixes(monacoRef.current, editorRef.current, clean, { ruleIds });
      // No host notification here: these are ordinary model edits, so Monaco's
      // `onChange` fires and the debounce below reports them like any typing.
    },
    flushPendingChange: () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const pending = pendingChangeRef.current;
      pendingChangeRef.current = null;
      pending?.();
    },
  }), []);

  useEffect(() => {
    onRebuildRef.current = onRebuild;
  }, [onRebuild]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    onOpenFindInProjectRef.current = onOpenFindInProject;
  }, [onOpenFindInProject]);

  useEffect(() => {
    onCursorLineChangeRef.current = onCursorLineChange;
  }, [onCursorLineChange]);

  useEffect(() => {
    onRequestWrapperEditRef.current = onRequestWrapperEdit;
  }, [onRequestWrapperEdit]);

  // ── Per-buffer view state ─────────────────────────────────────────────────
  // Monaco's view state (cursor, selection, scroll, folds) for each buffer the
  // editor has shown, keyed by `bufferKey`. Saved as a buffer is left — here,
  // *before* the wrapper-zone effect below redraws the zones for the new
  // buffer (a saved scroll offset is measured from the first line, under
  // whatever zones sit above it at the time) and before the content effect
  // replaces the model's text — and restored after the model holds the new
  // buffer (the effect after the collab rebind). Bounded, so a long session
  // doesn't keep a state per division ever opened: beyond `MAX_VIEW_STATES`
  // the oldest is dropped.
  const viewStatesRef = useRef(new Map<string, unknown>());
  const bufferKeyRef = useRef(bufferKey);
  const switchedBufferRef = useRef(false);
  useEffect(() => {
    const previous = bufferKeyRef.current;
    bufferKeyRef.current = bufferKey;
    if (previous === bufferKey) return;
    switchedBufferRef.current = true;
    const editor = editorRef.current;
    if (!editor || previous === undefined) return;
    const states = viewStatesRef.current;
    states.delete(previous);
    states.set(previous, editor.saveViewState());
    while (states.size > MAX_VIEW_STATES) {
      const oldest = states.keys().next().value;
      if (oldest === undefined) break;
      states.delete(oldest);
    }
  }, [bufferKey]);

  useEffect(() => {
    syncVirtualWrapper();
  }, [virtualWrapper, isEditorMounted]);
  // const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    languageExtensionsRef.current?.dispose?.();
    const config = editorConfigs[sourceFormat];
    // Diagnostics bind to the editor's model, so both refs must be live; on the
    // very first pass they aren't yet, and `handleEditorMount` registers
    // instead.
    languageExtensionsRef.current =
      monacoRef.current && editorRef.current
        ? (config.registerMonacoExtensions?.(
            monacoRef.current,
            editorRef.current,
            extensionContextRef.current,
          ) ?? null)
        : null;
  }, [sourceFormat]);

  usePretextDiagnostics(
    monacoRef,
    editorRef,
    sourceFormat === "pretext" ? pretextValidation : undefined,
    isEditorMounted,
  );

  usePlacementDiagnostics(
    monacoRef,
    editorRef,
    placementCheck?.sourceFormat === sourceFormat ? placementCheck : undefined,
    isEditorMounted,
    PLACEMENT_LANGUAGE_IDS,
  );

  useEffect(() => {
    return () => {
      contentListenerRef.current?.dispose?.();
      languageExtensionsRef.current?.dispose?.();
      mouseListenerRef.current?.dispose?.();
      pasteListenerRef.current?.();
      pasteListenerRef.current = null;
      cursorListenerRef.current?.dispose?.();
      selectionListenerRef.current?.dispose?.();
      findStateListenerRef.current?.dispose?.();
      // Deliver a change the debounce is still holding, never drop it: the
      // editor can unmount under the author's hands (crossing the tabbed/split
      // layout breakpoint remounts it), and the last 500 ms of typing would
      // otherwise vanish with it, unseen by the host and never saved.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const pending = pendingChangeRef.current;
      pendingChangeRef.current = null;
      pending?.();
    };
  }, []);

  /**
   * Draw `virtualWrapper` as view zones: its `before` lines above line 1 and its
   * `after` lines below the last line. The closing zone is anchored to a line
   * number, so it's re-anchored whenever the line count changes — called from
   * the content listener after every edit, local or remote. Reads only refs, so
   * the mount-time listener's copy of it is always current.
   */
  const syncVirtualWrapper = () => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel?.();
    if (!editor || !monaco || !model) return;
    if (typeof editor.changeViewZones !== "function") return;
    const zones = wrapperZonesRef.current;
    const wrapper = virtualWrapperRef.current;
    const lineCount = model.getLineCount();
    if (zones.wrapper === wrapper && zones.lineCount === lineCount) return;

    const fontInfo = editor.getOption(monaco.editor.EditorOption.fontInfo);
    const makeNode = (lines: string[]) => {
      const node = document.createElement("div");
      node.className =
        "pretext-plus-editor__locked-line pretext-plus-editor__virtual-wrapper";
      node.dataset.testid = "virtual-wrapper";
      if (wrapper?.hoverMessage) node.title = wrapper.hoverMessage;
      node.style.fontFamily = fontInfo.fontFamily;
      node.style.fontSize = `${fontInfo.fontSize}px`;
      node.style.lineHeight = `${fontInfo.lineHeight}px`;
      node.style.whiteSpace = "pre";
      for (const line of lines) {
        const row = document.createElement("div");
        row.className = "pretext-plus-editor__locked-line-text";
        row.textContent = line;
        node.appendChild(row);
      }
      return node;
    };

    editor.changeViewZones((accessor: any) => {
      for (const id of zones.ids) accessor.removeZone(id);
      zones.ids = [];
      if (!wrapper) return;
      const add = (afterLineNumber: number, lines: string[]) => {
        if (lines.length === 0) return;
        zones.ids.push(
          accessor.addZone({
            afterLineNumber,
            heightInLines: lines.length,
            domNode: makeNode(lines),
          }),
        );
      };
      add(0, wrapper.before);
      add(lineCount, wrapper.after);
    });
    zones.wrapper = wrapper;
    zones.lineCount = lineCount;
  };

  const setModelValueSafely = (model: any, nextValue: string) => {
    if (model.getValue() === nextValue) return;
    isProgrammaticUpdateRef.current = true;
    model.setValue(nextValue);
    queueMicrotask(() => {
      isProgrammaticUpdateRef.current = false;
    });
  };

  // When the content prop changes from an external source, update the editor
  // model only if it actually differs from what the editor currently contains.
  // This prevents cursor jumps caused by the parent re-rendering with the same
  // value the user just typed.
  //
  // Skipped entirely while a collab binding owns the model: the store's copy
  // can lag the model by the debounce interval, and a whole-model setValue on
  // a bound model would re-enter the shared doc as delete-everything+insert.
  useEffect(() => {
    if (collabRef.current) return;
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    // Leaving a shared buffer for one that isn't shared (collaboration off, or
    // an item not yet in the doc): this effect runs before the rebind effect
    // below, so the old binding is still listening. Drop it first, or the
    // setValue that follows would be written into the *previous* buffer's
    // shared text as a delete-everything + insert.
    if (collabBindingRef.current) {
      collabBindingRef.current.dispose();
      collabBindingRef.current = null;
    }
    if (model.getValue() !== content) {
      const position = editor.getPosition();
      const selections = editor.getSelections();
      setModelValueSafely(model, content);
      if (position) editor.setPosition(position);
      if (selections) editor.setSelections(selections);
    }
  }, [content]);

  // ── Collaboration binding lifecycle ───────────────────────────────────────
  // (Re)bind whenever the shared text changes: on entering collab mode, on
  // switching divisions, or after a just-created division's doc entry appears.
  // Also invoked from handleEditorMount, since the editor instance usually
  // arrives after the first render.
  const rebindCollab = () => {
    const previous = collabBindingRef.current;
    if (previous) {
      collabBindingRef.current = null;
      previous.dispose();
    }
    const c = collabRef.current;
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    if (!c) {
      // Unbound now. The content effect normally realigns the model, but it
      // only fires on a *changed* prop — if the unshared buffer happens to hold
      // what the prop already said, restore it here.
      if (previous) setModelValueSafely(model, contentPropRef.current);
      return;
    }
    // The shared text is authoritative; align the model before binding so the
    // binding never observes a divergent starting state.
    setModelValueSafely(model, c.ytext.toString());
    const binding = new MonacoCollabBinding({
      ytext: c.ytext,
      editor,
      monaco,
      awareness: c.awareness,
      user: c.user,
      bufferKey: c.bufferKey,
    });
    // The binding's transactions are local writes; the bridge must not echo
    // them back into the store as remote changes.
    c.registerLocalOrigin(binding);
    collabBindingRef.current = binding;
    const unregister = () => c.unregisterLocalOrigin(binding);
    const originalDispose = binding.dispose.bind(binding);
    binding.dispose = () => {
      unregister();
      originalDispose();
    };
  };

  useEffect(() => {
    rebindCollab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab?.ytext]);

  // The second half of the view-state effect above: the model now holds the
  // new buffer, so put the cursor back where it was in it — or at the top, for
  // a buffer not seen before (the content effect keeps the previous buffer's
  // cursor position, which means nothing in another text). A reveal the parent
  // asked for lands after this, since its effects run after ours.
  useEffect(() => {
    if (!switchedBufferRef.current) return;
    switchedBufferRef.current = false;
    const editor = editorRef.current;
    if (!editor || bufferKey === undefined) return;
    const saved = viewStatesRef.current.get(bufferKey);
    // Not a quiet move like `revealLine`'s: the preview is about to show this
    // buffer and should follow the cursor in *it*, so the move is reported
    // even to a line number the previous buffer's cursor happened to share.
    lastCursorLineRef.current = null;
    if (saved) {
      editor.restoreViewState(saved);
    } else {
      editor.setPosition({ lineNumber: 1, column: 1 });
      editor.setScrollTop(0);
    }
    lastCursorLineRef.current = editor.getPosition()?.lineNumber ?? null;
  }, [bufferKey]);

  useEffect(() => {
    return () => {
      collabBindingRef.current?.dispose();
      collabBindingRef.current = null;
    };
  }, []);

  const handleEditorMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Ensure the newly mounted editor has the latest content in case the
    // component was remounted while content changed without triggering the
    // content-sync effect (editorRef.current was null at that point). In
    // collab mode the binding (created below) aligns the model to the shared
    // text instead.
    const model = editor.getModel();
    if (!collabRef.current && model && model.getValue() !== contentRef.current) {
      setModelValueSafely(model, contentRef.current);
    }
    // Report line changes for source → preview sync.
    cursorListenerRef.current?.dispose?.();
    cursorListenerRef.current = editor.onDidChangeCursorPosition((e: any) => {
      if (suppressCursorReportRef.current) return;
      const line = e?.position?.lineNumber;
      if (typeof line !== "number" || line === lastCursorLineRef.current) return;
      lastCursorLineRef.current = line;
      onCursorLineChangeRef.current?.(line);
    });

    // Track whether anything is selected, so the Edit menu can disable Cut and
    // Copy when there is nothing to act on.
    selectionListenerRef.current?.dispose?.();
    selectionListenerRef.current = editor.onDidChangeCursorSelection((e: any) => {
      const selection = e?.selection;
      setHasSelection(
        !!selection &&
          !(
            selection.startLineNumber === selection.endLineNumber &&
            selection.startColumn === selection.endColumn
          ),
      );
    });

    // Subscribe to content changes to refresh undo/redo availability
    contentListenerRef.current?.dispose?.();
    contentListenerRef.current = editor.onDidChangeModelContent(() => {
      updateUndoRedoState();
      // The closing wrapper zone is anchored to the last line, which any edit,
      // local or remote, may move.
      syncVirtualWrapper();
    });
    updateUndoRedoState();

    // Paste-and-convert: LaTeX or Markdown pasted into a PreTeXt division
    // arrives as PreTeXt. The listener's placement and phase are both subtle
    // and both explained in `pasteConvert.ts`; everything this component owns
    // is the "should it run right now" answer below.
    pasteListenerRef.current?.();
    pasteListenerRef.current = installPasteConvertListener({
      getEditor: () => editorRef.current,
      // Read through the refs, not the props: this is registered once per
      // mount while the editor outlives division switches. Converting a paste
      // in a LaTeX or Markdown division would rewrite the author's own markup
      // into another language, so only PreTeXt buffers do it.
      isEnabled: () =>
        !!pasteAutoConvertRef.current &&
        !readOnlyRef.current &&
        sourceFormatRef.current === "pretext",
    });

    // Clicking a `virtualWrapper` line — drawn in a view zone, so it has no
    // model position — opens the settings drawer, where what those lines show
    // (a division's type/title/xml:id/label, an asset's alt text) is edited.
    mouseListenerRef.current?.dispose?.();
    mouseListenerRef.current = editor.onMouseDown((e: any) => {
      if (
        e?.target?.type === monaco.editor.MouseTargetType.CONTENT_VIEW_ZONE &&
        wrapperZonesRef.current.ids.includes(e.target.detail?.viewZoneId)
      ) {
        onRequestWrapperEditRef.current?.();
      }
    });

    // Register Ctrl+Enter to trigger a full rebuild
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRebuildRef.current?.();
    });

    // Register Ctrl+S to save (and rebuild if a rebuild handler is set)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.();
    });

    // Register Ctrl+Shift+F to open the project-wide Find/Replace drawer.
    // Unbound in standalone Monaco (it's a VS Code-workbench shortcut, not a
    // core editor one), so this doesn't shadow anything.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
      () => {
        onOpenFindInProjectRef.current?.();
      },
    );

    // Track Monaco's own find widget through its contribution's state model
    // (rather than watching its DOM) so the toolbar can show "Finding in
    // file" while it's open, and close it from there when switching to Find
    // in Project.
    findStateListenerRef.current?.dispose?.();
    const findController = editor.getContribution?.(
      "editor.contrib.findController",
    );
    findControllerRef.current = findController ?? null;
    const findState = findController?.getState?.();
    setIsFindingInFile(!!findState?.isRevealed);
    findStateListenerRef.current =
      findState?.onFindReplaceStateChange((e: any) => {
        if (e.isRevealed) setIsFindingInFile(!!findState.isRevealed);
      }) ?? null;

    languageExtensionsRef.current?.dispose?.();
    // Through the ref: Monaco's `onMount` is this function as of the first
    // render, and the format may have changed while Monaco loaded (a click on
    // a division in another format). The `[sourceFormat]` effect can't cover
    // that switch — it ran before there was an editor to register against.
    const config = editorConfigs[sourceFormatRef.current];
    languageExtensionsRef.current =
      config.registerMonacoExtensions?.(
        monaco,
        editor,
        extensionContextRef.current,
      ) ?? null;

    rebindCollab();
    setIsEditorMounted(true);
  };

  /**
   * Reads the Monaco model's undo/redo availability and updates state.
   * Falls back to enabling both buttons whenever an editor instance exists,
   * because some Monaco builds don't expose `canUndo`/`canRedo` on the model.
   */
  const updateUndoRedoState = () => {
    const model = editorRef.current?.getModel?.();
    if (
      model &&
      typeof (model as any).canUndo === "function" &&
      typeof (model as any).canRedo === "function"
    ) {
      try {
        setCanUndo((model as any).canUndo());
        setCanRedo((model as any).canRedo());
        return;
      } catch {
        // fall through to default
      }
    }
    // Fallback: enable buttons when editor exists
    const hasEditor = !!editorRef.current;
    setCanUndo(hasEditor);
    setCanRedo(hasEditor);
  };

  const handleContentChange = (newContent: string) => {
    onChange(newContent);
  };

  // Stable identities (read only through refs and stable setState setters) so
  // the `onMenuStateChange` effect below doesn't fire on every render — see
  // that effect for why the bundle's function identities matter.
  const handleUndo = useCallback(() => {
    editorRef.current?.trigger("", "undo");
    updateUndoRedoState();
  }, []);

  const handleRedo = useCallback(() => {
    editorRef.current?.trigger("", "redo");
    updateUndoRedoState();
  }, []);

  /**
   * Insert a snippet where it is legal, rather than only where the caret is.
   *
   * `planSnippetInsertion` reads the cursor's surroundings and decides both the
   * text and the spot: a list gains a `<p>` unless the cursor is already in one,
   * a theorem moves past the paragraph it can't nest inside.
   */
  const insertSnippetInContext = (snippet: EditorSnippet) => {
    const editor = editorRef.current;
    const model = editor?.getModel?.();
    const position = editor?.getPosition?.();
    if (!editor || !model || !position) return;

    const offset = model.getOffsetAt(position);
    const plan = planSnippetInsertion(
      model.getValue(),
      offset,
      snippet,
      sourceFormatRef.current,
    );
    if (plan.offset !== offset) editor.setPosition(model.getPositionAt(plan.offset));
    insertSnippet(editor, plan.body);
  };

  // Stable identity for the same reason as `handleUndo`/`handleRedo` above:
  // every method here reads the editor through `editorRef`, so there is no
  // state to go stale by memoizing it.
  const menuActions: EditorMenuActions = useMemo(
    () => ({
      runCommand: (id) => {
        runEditorCommand(editorRef.current, id);
        // Undo/redo run through here too, and the model's stacks have moved.
        updateUndoRedoState();
      },
      cut: () => cutSelection(editorRef.current),
      copy: () => copySelection(editorRef.current),
      selectAll: () => runEditorCommand(editorRef.current, MONACO_COMMANDS.selectAll.id),
      paste: () => pasteFromClipboard(editorRef.current),
      insertSnippet: insertSnippetInContext,
    }),
    [],
  );

  // Closes Monaco's own find widget before handing off to Find in Project,
  // so switching between the two never leaves both open at once.
  const handleSwitchToFindInProject = useCallback(() => {
    findControllerRef.current?.closeFindWidget?.();
    onOpenFindInProjectRef.current?.();
  }, []);

  // Reports the state a host renders the Edit/Insert/Tools toolbar from, once
  // after mount and again whenever one of the primitive booleans actually
  // changes. The callbacks bundled alongside them are the stable identities
  // above, so this doesn't fire (and the host doesn't re-render) on every
  // keystroke — only when undo/redo/selection/find-in-file availability
  // genuinely changes.
  useEffect(() => {
    onMenuStateChange?.({
      canUndo,
      canRedo,
      hasSelection,
      onUndo: handleUndo,
      onRedo: handleRedo,
      actions: menuActions,
      isFindingInFile,
      switchToFindInProject: handleSwitchToFindInProject,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUndo, canRedo, hasSelection, isFindingInFile, onMenuStateChange]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, position: "relative" }}>
        <Editor
          options={options}
          height="100%"
          language={editorConfigs[sourceFormat].language}
          defaultValue={content}
          onMount={handleEditorMount}
          onChange={(value, event) => {
            if (event?.isFlush || isProgrammaticUpdateRef.current) {
              return;
            }
            if (debounceRef.current) clearTimeout(debounceRef.current);
            const deliver = () => {
              debounceRef.current = null;
              pendingChangeRef.current = null;
              handleContentChange(value || "");
            };
            pendingChangeRef.current = deliver;
            debounceRef.current = setTimeout(deliver, 500);
          }}
        />
        <div className="absolute bottom-2 right-4 z-10 flex items-center gap-2">
          {presence}
          {onConvertToPretext && !readOnly && (
            <button
              type="button"
              className={CONVERT_BUTTON_CLASSES}
              onClick={onConvertToPretext}
              disabled={canConvertToPretext === false}
              title="Convert this division to use PreTeXt XML"
            >
              Convert to PreTeXt
            </button>
          )}
          {readOnly && (
            <span className="inline-flex items-center py-0.5 px-2 rounded-full bg-[#a32899] text-white text-xs font-semibold pointer-events-none shadow-sm">
              Read-only
            </span>
          )}
          <span className="inline-flex items-center py-0.5 px-2 rounded-full bg-gray-200/90 text-gray-800 text-xs font-semibold pointer-events-none shadow-sm">
            {FORMAT_LABELS[sourceFormat]}
          </span>
        </div>
      </div>
    </div>
  );
});

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;
