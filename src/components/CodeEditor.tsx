import { Editor } from "@monaco-editor/react";
import { constrainedEditor } from "constrained-editor-plugin";
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { editorConfigs } from "./editorConfigs";
import CodeEditorMenu from "./CodeEditorMenu";
import { MonacoCollabBinding } from "../collab/monacoBinding";
import { installEditGuard } from "../collab/editGuard";
import { computeLockedRegion, findPretextHeaderEnd } from "./lockedRegion";
import type { CollabUser } from "../collab/types";
import type { SourceFormat } from "../types/editor";
import "./CodeEditor.css";

/** Live-collaboration wiring for the active division's shared text. */
export interface CodeEditorCollab {
  ytext: Y.Text;
  awareness: Awareness;
  user: CollabUser;
  /** Identifies the division (for scoping remote cursors to this buffer). */
  divisionKey: string;
  /** Register/unregister the Monaco binding as a local Y.Doc origin. */
  registerLocalOrigin: (origin: unknown) => void;
  unregisterLocalOrigin: (origin: unknown) => void;
}

interface CodeEditorProps {
  /** The current source content to display. */
  content: string;
  /**
   * Determines the Monaco language mode — see `editorConfigs`, which maps this
   * to `"xml"`, `"pretext-latex"`, or `"pretext-markdown"`.
   */
  sourceFormat: SourceFormat;
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
  /** Called when the user clicks "Import LaTeX" in the toolbar. */
  onOpenLatexImport: () => void;
  /** Called when the user clicks "Edit Macros" in the toolbar. */
  onOpenDocinfoEditor: () => void;
  /**
   * If provided, a "Convert to PreTeXt" button is shown in the toolbar.
   * Called when the user clicks to open the conversion confirmation dialog.
   */
  onOpenConvertToPretext?: () => void;
  /**
   * Controls whether the "Convert to PreTeXt" button is enabled.
   * Should be `false` when conversion has failed.
   */
  canConvertToPretext?: boolean;
  /** If provided, an "Assets" button is shown in the toolbar (PreTeXt mode only). */
  onOpenAssets?: () => void;
  /** Called when the user clicks "Display Full Source" to open the assembled-source modal. */
  onShowFullSource: () => void;
  /**
   * Called when the user clicks any locked leading line of the wrapper (the
   * opening tag, and the title line right after it when present). Hosts use
   * this to open the division's properties editor in the Table of Contents,
   * since the tag/title/xml:id aren't editable in-place.
   */
  onRequestWrapperEdit?: () => void;
  hideAssets?: boolean;
  /**
   * When set, the editor model is bound to this shared `Y.Text` instead of
   * being driven by the `content` prop: keystrokes emit CRDT deltas, remote
   * edits land in the model directly, and remote cursors render as colored
   * carets. The structural lines stay locked, but enforcement switches from
   * the constrained-editor plugin (which reverts, and cannot tell a remote
   * delta from local typing) to the preventive guard in
   * `src/collab/editGuard.ts`.
   */
  collab?: CodeEditorCollab;
}

/** Imperative handle exposed via `forwardRef` for programmatic control. */
export interface CodeEditorHandle {
  /** Insert `text` at the current cursor position (or replace the selection). */
  insertAtCursor: (text: string) => void;
  /** Move keyboard focus into the editor, ready for typing. */
  focus: () => void;
  /** Put the cursor on `line`, scrolling it into view if it is off-screen. */
  revealLine: (line: number) => void;
}

/** Static Monaco editor options shared across all instances of this component. */
const options = {
  automaticLayout: true,
  minimap: { enabled: false },
  acceptSuggestionOnCommitCharacter: false,
  quickSuggestions: false,
  wordWrap: "on" as const,
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
const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(({
  content,
  sourceFormat,
  onChange,
  onRebuild,
  onSave,
  onCursorLineChange,
  onOpenLatexImport,
  onOpenDocinfoEditor,
  onOpenConvertToPretext,
  canConvertToPretext,
  onOpenAssets,
  onShowFullSource,
  onRequestWrapperEdit,
  hideAssets,
  collab,
}, ref) => {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  // The live Monaco↔Y.Text binding when collaboration is on. Read through a
  // ref inside applyConstraints/mount handlers, which aren't re-created per
  // render.
  const collabRef = useRef(collab);
  collabRef.current = collab;
  const collabBindingRef = useRef<MonacoCollabBinding | null>(null);
  const constrainedRef = useRef<ReturnType<typeof constrainedEditor> | null>(null);
  // Removes the collab edit guard's patch from the model. Installed once at
  // mount; the guard itself only enforces while a collab binding is live.
  const editGuardRef = useRef<(() => void) | null>(null);
  // Set while the editor applies its own structural normalization, so those
  // edits — which deliberately write to the locked lines — pass the guard.
  const guardBypassRef = useRef(false);
  // Set while the structural normalizations run, so the content-change they
  // trigger doesn't re-enter applyConstraints halfway through it.
  const normalizingRef = useRef(false);
  // The live source format, read from inside the mount-time guard closure.
  const sourceFormatRef = useRef(sourceFormat);
  sourceFormatRef.current = sourceFormat;
  const lockedDecorationsRef = useRef<any>(null);
  const lockedRef = useRef(false);
  // How many lines at the very top are locked (the wrapper tag + title for
  // PreTeXt, the frontmatter block — title included — for Markdown). Clicking
  // any of them opens the TOC properties form.
  const leadingLockedLinesRef = useRef(0);
  const contentListenerRef = useRef<{ dispose: () => void } | null>(null);
  const mouseListenerRef = useRef<{ dispose: () => void } | null>(null);
  const cursorListenerRef = useRef<{ dispose: () => void } | null>(null);
  const onCursorLineChangeRef = useRef(onCursorLineChange);
  // Last line reported, so a cursor moving along one line stays quiet.
  const lastCursorLineRef = useRef<number | null>(null);
  // Set while `revealLine` moves the cursor itself. Without it, syncing from
  // the preview would move the cursor, which would report a line change, which
  // would scroll the preview back — a loop between the two panes.
  const suppressCursorReportRef = useRef(false);
  const onRequestWrapperEditRef = useRef(onRequestWrapperEdit);
  // Per-format Monaco language extensions (completions, diagnostics, syntax),
  // torn down and re-registered whenever the source format changes.
  const languageExtensionsRef = useRef<{ dispose: () => void } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProgrammaticUpdateRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const onRebuildRef = useRef(onRebuild);
  const onSaveRef = useRef(onSave);

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
  }), []);

  useEffect(() => {
    onRebuildRef.current = onRebuild;
  }, [onRebuild]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    onCursorLineChangeRef.current = onCursorLineChange;
  }, [onCursorLineChange]);

  useEffect(() => {
    onRequestWrapperEditRef.current = onRequestWrapperEdit;
  }, [onRequestWrapperEdit]);
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
          ) ?? null)
        : null;
    // Switching format toggles whether the wrapper is locked (PreTeXt only).
    applyConstraints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFormat]);

  useEffect(() => {
    return () => {
      contentListenerRef.current?.dispose?.();
      languageExtensionsRef.current?.dispose?.();
      mouseListenerRef.current?.dispose?.();
      cursorListenerRef.current?.dispose?.();
      constrainedRef.current?.disposeConstrainer?.();
      editGuardRef.current?.();
      editGuardRef.current = null;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // When a PreTeXt division has collapsed to exactly its locked header
  // (opening tag, plus a title line when present) directly above its closing
  // tag, insert a blank line between them so the body always has at least one
  // editable, non-locked line. The edit is flagged programmatic so it doesn't
  // echo back to the host as a content change (it's a display normalization,
  // not a user edit).
  const ensurePretextBodyLine = (editor: any, model: any, monaco: any) => {
    if (sourceFormat !== "pretext") return;
    const lineCount = model.getLineCount();
    if (lineCount < 2) return;
    const open = model.getLineContent(1).trim();
    if (!open.startsWith("<") || open.startsWith("</") || open.endsWith("/>")) {
      return;
    }
    const headerEnd = findPretextHeaderEnd(model);
    if (lineCount !== headerEnd + 1) return;
    const close = model.getLineContent(lineCount).trim();
    if (!/^<\/[A-Za-z][\w.:-]*\s*>$/.test(close)) return;

    isProgrammaticUpdateRef.current = true;
    const endCol = model.getLineMaxColumn(headerEnd);
    // The insertion point is the end of the locked header, so it has to skip
    // the collab guard (which would otherwise reject its own repair).
    guardBypassRef.current = true;
    try {
      editor.executeEdits("ensure-body-line", [
        {
          range: new monaco.Range(headerEnd, endCol, headerEnd, endCol),
          text: "\n",
          forceMoveMarkers: true,
        },
      ]);
    } finally {
      guardBypassRef.current = false;
    }
    queueMicrotask(() => {
      isProgrammaticUpdateRef.current = false;
    });
  };

  // An imported PreTeXt division can end with one or more trailing blank
  // lines after its closing tag (e.g. carried over from a file that ended
  // with a newline). `computeLockedRegion` always locks the model's last
  // line as the closing tag, so a trailing blank line leaves the real
  // closing tag sitting inside the "editable" region, unprotected. Strip
  // any such trailing blank lines so the closing tag is truly last and gets
  // locked correctly.
  const trimPretextTrailingBlankLines = (editor: any, model: any, monaco: any) => {
    if (sourceFormat !== "pretext") return;
    const lineCount = model.getLineCount();
    if (lineCount < 2 || model.getLineContent(lineCount).trim() !== "") return;
    let lastContentLine = lineCount - 1;
    while (lastContentLine > 1 && model.getLineContent(lastContentLine).trim() === "") {
      lastContentLine--;
    }
    const closing = model.getLineContent(lastContentLine).trim();
    if (!/^<\/[A-Za-z][\w.:-]*\s*>$/.test(closing)) return;

    isProgrammaticUpdateRef.current = true;
    // Spans the (currently unlocked) trailing blank lines down past what will
    // become the locked closing tag, so it too must skip the collab guard.
    guardBypassRef.current = true;
    try {
      editor.executeEdits("trim-trailing-blank-lines", [
        {
          range: new monaco.Range(
            lastContentLine,
            model.getLineMaxColumn(lastContentLine),
            lineCount,
            model.getLineMaxColumn(lineCount),
          ),
          text: "",
          forceMoveMarkers: true,
        },
      ]);
    } finally {
      guardBypassRef.current = false;
    }
    queueMicrotask(() => {
      isProgrammaticUpdateRef.current = false;
    });
  };

  // Lock the division's structural metadata so it can't be edited in the code
  // editor: the body stays editable, but the type/xml:id/label are edited from
  // the Table of Contents instead. For PreTeXt this is the wrapper tag on the
  // first/last lines; for Markdown it's the leading YAML frontmatter block.
  // Recomputed whenever the content or source format changes; see
  // {@link computeLockedRegion} for the per-format geometry.
  const applyConstraints = () => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const instance = constrainedRef.current;
    if (!editor || !monaco || !instance) return;
    const model = editor.getModel();
    if (!model) return;
    // Re-entered from the collab content listener by the normalizations below.
    // That inner pass is redundant — this one goes on to recompute the region
    // against the normalized model — so drop it.
    if (normalizingRef.current) return;

    // Start clean — the previous restrictions reference stale line numbers.
    // This also tears the plugin off a model that has just entered collab mode
    // (a newly created division reaches the shared doc mid-session), where the
    // guard takes over enforcement instead.
    if (typeof model.disposeRestrictions === "function") {
      model.disposeRestrictions();
    }

    normalizingRef.current = true;
    try {
      trimPretextTrailingBlankLines(editor, model, monaco);

      // A PreTeXt division whose body is emptied collapses to just its locked
      // wrapper tags (`<section…>` / `</section>`) on adjacent lines. With no line
      // between them there's nowhere unlocked to type — and `computeLockedRegion`
      // bails (`lineCount < 3`), dropping the wrapper protection entirely. Insert a
      // blank middle line so the wrapper stays locked and there is always a clean,
      // editable line in between to add content back into.
      //
      // This runs in collab mode too. Two peers staring at the same emptied
      // division would each insert a newline, leaving one stray blank line — a
      // cosmetic, self-limiting outcome (the condition stops holding once either
      // lands), and far cheaper than leaving the wrapper unguarded.
      ensurePretextBodyLine(editor, model, monaco);
    } finally {
      normalizingRef.current = false;
    }

    const region = computeLockedRegion(model, sourceFormat);
    lockedRef.current = region !== null;
    leadingLockedLinesRef.current = region?.leadingLockedLines ?? 0;

    // Solo editing enforces through the plugin. Collab editing must not: the
    // plugin reverts an out-of-range change by calling `model.undo()` from a
    // content listener that cannot distinguish local typing from a remote CRDT
    // delta, so it would undo a peer's edit — and re-broadcast that undo. The
    // guard installed at mount enforces the same geometry by prevention
    // instead; see `src/collab/editGuard.ts`.
    if (region && !collabRef.current) {
      instance.addRestrictionsTo(model, [
        { range: region.editableRange, allowMultiline: true },
      ]);
    }

    // Cosmetic: dim the locked lines so they read as structural.
    if (typeof editor.createDecorationsCollection === "function") {
      if (!lockedDecorationsRef.current) {
        lockedDecorationsRef.current = editor.createDecorationsCollection();
      }
      if (!region) {
        lockedDecorationsRef.current.clear();
      } else {
        const hoverMessage = {
          value:
            "These properties are structural — edit them from the Table of Contents.",
        };
        // `className` + `isWholeLine` paints a full-width tint *behind* the text;
        // `inlineClassName` is merged onto the token spans themselves so we can
        // recolor them. The latter only applies to the decoration's range, so
        // each range must span the whole line's text (col 1 → last column).
        const lockedLineOptions = {
          isWholeLine: true,
          className: "pretext-plus-editor__locked-line",
          inlineClassName: "pretext-plus-editor__locked-line-text",
          // Never let the gray inline style grow onto text typed at a locked
          // line's edges — otherwise content re-added next to the wrapper tags
          // inherits the structural styling and looks (and reads) as locked.
          stickiness:
            monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          hoverMessage,
        };
        lockedDecorationsRef.current.set(
          region.lockedLines.map((ln) => ({
            range: new monaco.Range(ln, 1, ln, model.getLineMaxColumn(ln)),
            options: lockedLineOptions,
          })),
        );
      }
    }
  };

  const setModelValueSafely = (model: any, nextValue: string) => {
    if (model.getValue() === nextValue) return;
    isProgrammaticUpdateRef.current = true;
    // Restrictions must be removed before a programmatic full-document setValue,
    // or the plugin reverts it as an edit to the locked ranges. They're
    // re-applied (against the new line count) immediately after.
    if (typeof model.disposeRestrictions === "function") {
      model.disposeRestrictions();
    }
    model.setValue(nextValue);
    applyConstraints();
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
    if (model.getValue() !== content) {
      const position = editor.getPosition();
      const selections = editor.getSelections();
      setModelValueSafely(model, content);
      if (position) editor.setPosition(position);
      if (selections) editor.setSelections(selections);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!c || !editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    // The shared text is authoritative; align the model before binding so the
    // binding never observes a divergent starting state.
    setModelValueSafely(model, c.ytext.toString());
    // Entering collab mode has to hand enforcement from the plugin to the guard
    // even when the model already held the shared text — `setModelValueSafely`
    // short-circuits on an identical value and would leave the plugin attached.
    applyConstraints();
    const binding = new MonacoCollabBinding({
      ytext: c.ytext,
      editor,
      monaco,
      awareness: c.awareness,
      user: c.user,
      divisionKey: c.divisionKey,
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

  useEffect(() => {
    return () => {
      collabBindingRef.current?.dispose();
      collabBindingRef.current = null;
    };
  }, []);

  const handleEditorMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Wire up the constrained-editor instance once per mount; restrictions
    // themselves are (re)applied by applyConstraints below and on every sync.
    constrainedRef.current = constrainedEditor(monaco);
    constrainedRef.current.initializeIn(editor);
    // Ensure the newly mounted editor has the latest content in case the
    // component was remounted while content changed without triggering the
    // content-sync effect (editorRef.current was null at that point). In
    // collab mode the binding (created below) aligns the model to the shared
    // text instead.
    const model = editor.getModel();
    if (!collabRef.current && model && model.getValue() !== content) {
      setModelValueSafely(model, content);
    }
    // Install the collab edit guard once per mount. It enforces only while a
    // binding is live (`isEnabled`), so it is inert in solo mode where the
    // constrained-editor plugin owns the locked ranges, and it takes over
    // without a re-install when a division later joins the shared doc.
    editGuardRef.current?.();
    editGuardRef.current = installEditGuard(model, {
      isEnabled: () => Boolean(collabRef.current),
      isBypassed: () => guardBypassRef.current,
      // Recomputed per edit: the locked lines move as the body grows and
      // shrinks, and remote deltas move them with no local event to react to.
      getEditableRange: () => {
        const current = editorRef.current?.getModel?.();
        if (!current) return null;
        return (
          computeLockedRegion(current, sourceFormatRef.current)?.editableRange ??
          null
        );
      },
    });
    // Report line changes for source → preview sync.
    cursorListenerRef.current?.dispose?.();
    cursorListenerRef.current = editor.onDidChangeCursorPosition((e: any) => {
      if (suppressCursorReportRef.current) return;
      const line = e?.position?.lineNumber;
      if (typeof line !== "number" || line === lastCursorLineRef.current) return;
      lastCursorLineRef.current = line;
      onCursorLineChangeRef.current?.(line);
    });

    // Subscribe to content changes to refresh undo/redo availability
    contentListenerRef.current?.dispose?.();
    contentListenerRef.current = editor.onDidChangeModelContent(() => {
      updateUndoRedoState();
      // Solo mode leaves this to the plugin, which tracks its own ranges as the
      // text shifts. Collab mode has no such bookkeeping, and the geometry does
      // move — a PreTeXt division's closing tag is whatever line is last — so
      // recompute the locked lines (and their dimming) after every change,
      // local or remote.
      if (collabRef.current) applyConstraints();
    });
    updateUndoRedoState();

    // Clicking any locked leading line (the PreTeXt opening tag/title, or the
    // Markdown frontmatter block) opens the division's properties editor in
    // the TOC, since the type/title/xml:id/label can't
    // be edited in place.
    mouseListenerRef.current?.dispose?.();
    mouseListenerRef.current = editor.onMouseDown((e: any) => {
      const line = e?.target?.position?.lineNumber;
      if (
        lockedRef.current &&
        typeof line === "number" &&
        line <= leadingLockedLinesRef.current
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

    languageExtensionsRef.current?.dispose?.();
    const config = editorConfigs[sourceFormat];
    languageExtensionsRef.current =
      config.registerMonacoExtensions?.(monaco, editor) ?? null;

    applyConstraints();
    rebindCollab();
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

  const handleUndo = () => {
    editorRef.current?.trigger("", "undo");
    updateUndoRedoState();
  };

  const handleRedo = () => {
    editorRef.current?.trigger("", "redo");
    updateUndoRedoState();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <CodeEditorMenu
        content={content}
        sourceFormat={sourceFormat}
        onContentChange={handleContentChange}
        onOpenLatexImport={onOpenLatexImport}
        onOpenDocinfoEditor={onOpenDocinfoEditor}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        onConvertToPretext={onOpenConvertToPretext}
        canConvertToPretext={canConvertToPretext}
        onOpenAssets={onOpenAssets}
        onShowFullSource={onShowFullSource}
        hideAssets={hideAssets}
      />
      <div style={{ flex: 1 }}>
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
            debounceRef.current = setTimeout(() => {
              handleContentChange(value || "");
            }, 500);
          }}
        />
      </div>
    </div>
  );
});

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;
