import { useEffect, useRef, useState } from "react";
import { Editor } from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import clsx from "clsx";
import type { Snippet } from "../types/editor";
import { useEditorStore } from "../store/hooks";
import { snippetEmbedCode } from "../sectionUtils";
import {
  DialogOverlay,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogContent,
  DialogSection,
  DialogLabel,
  DialogHelperCopy,
  DialogEditorPane,
  DialogActions,
  DialogButton,
} from "./Dialog";

const ACTION_BTN_CLASSES =
  "text-[0.75rem] py-0.5 px-2 border rounded cursor-pointer leading-[1.5] whitespace-nowrap transition-colors duration-100";
const ACTION_BTN_DEFAULT_CLASSES =
  "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 hover:border-slate-400";
const ACTION_BTN_DONE_CLASSES =
  "text-emerald-600 border-emerald-300 bg-emerald-50";

const editorOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  wordWrap: "on" as const,
  insertSpaces: true,
  tabSize: 2,
  padding: { top: 10, bottom: 10 },
  scrollBeyondLastLine: false,
};

/** Floor for the auto-sized editor so a short/empty snippet still has room to type. */
const MIN_EDITOR_HEIGHT = 240;

const MONACO_LANGUAGE_FOR_FORMAT: Record<Snippet["sourceFormat"], string> = {
  pretext: "xml",
  latex: "latex",
  markdown: "markdown",
};

export interface SnippetEditModalProps {
  snippet: Snippet;
  /** The full project pool, used to reject a `ref` that collides with another snippet. */
  projectSnippets: Snippet[];
  onClose: () => void;
  /**
   * Persist the edited snippet. `prevRef` is the snippet's ref *before* this
   * edit so the caller can rewrite in-document placeholders when the ref changed.
   */
  onSave: (snippet: Snippet, prevRef: string) => Promise<void> | void;
  /**
   * Duplicate this snippet under a fresh ref. When omitted, the button is
   * hidden. May be async; the modal shows a busy state until it settles.
   */
  onDuplicate?: (snippet: Snippet) => void | Promise<void>;
}

const SnippetEditModal = ({
  snippet,
  projectSnippets,
  onClose,
  onSave,
  onDuplicate,
}: SnippetEditModalProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const activeDivisionId = useEditorStore((s) => s.activeDivisionId);
  // Match the copyable embed code to the division being edited — Markdown needs
  // the `::snippet{ref="x"}` directive form. Defaults to PreTeXt.
  const activeFormat =
    divisions?.find((d) => d.xmlId === activeDivisionId)?.sourceFormat ??
    "pretext";

  const prevRef = snippet.ref;
  const [refValue, setRefValue] = useState(prevRef);
  const [sourceValue, setSourceValue] = useState(snippet.source);
  const [sourceFormatValue, setSourceFormatValue] = useState(snippet.sourceFormat);
  const [isSaving, setIsSaving] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, []);

  const handleEditorMount: OnMount = (editor) => {
    const sync = () =>
      setEditorHeight(Math.max(MIN_EDITOR_HEIGHT, editor.getContentHeight()));
    editor.onDidContentSizeChange(sync);
    sync();
  };

  const embedCode = snippetEmbedCode(refValue.trim() || prevRef, activeFormat);

  const handleCopy = () => {
    navigator.clipboard?.writeText(embedCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    navigator.clipboard?.writeText(embedCode).catch(() => {});
    const ref = refValue.trim();
    if (!ref) {
      setError("Reference can't be empty — it identifies the snippet and is used by every embed of it.");
      return;
    }
    if (ref !== prevRef && projectSnippets.some((s) => s.ref === ref)) {
      setError(`Reference "${ref}" is already used by another snippet. Choose a unique reference.`);
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await onSave(
        { ...snippet, ref, source: sourceValue, sourceFormat: sourceFormatValue },
        prevRef,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save snippet.");
      setIsSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!onDuplicate) return;
    setError(null);
    setIsDuplicating(true);
    try {
      // On success the parent re-opens the editor on the new copy, which
      // remounts this modal (see the `key` in Editors), so no need to clear
      // the busy flag here — the instance is gone.
      await onDuplicate(snippet);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate snippet.");
      setIsDuplicating(false);
    }
  };

  const busy = isSaving || isDuplicating;
  const canDuplicate = !!onDuplicate;

  return (
    <DialogOverlay onClick={(e) => e.target === e.currentTarget && onClose()}>
      <Dialog role="dialog" aria-modal="true" aria-label={`Manage snippet ${snippet.ref}`}>
        <DialogHeader>
          <DialogTitle>Manage snippet</DialogTitle>
          <DialogClose onClick={onClose} aria-label="Close">
            ✕
          </DialogClose>
        </DialogHeader>

        <DialogContent single ref={contentRef} className="flex flex-col">
          <DialogSection>
            <div className="flex items-center gap-2 mt-[0.35rem] mb-3">
              <DialogLabel>Copy/paste this code to embed in your document:</DialogLabel>
              <button
                type="button"
                className={clsx(
                  ACTION_BTN_CLASSES,
                  copied ? ACTION_BTN_DONE_CLASSES : ACTION_BTN_DEFAULT_CLASSES,
                )}
                onClick={handleCopy}
                title="Copy embed code to clipboard"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
              <code className="flex-1 min-w-0 font-mono text-[0.78rem] text-slate-900 bg-slate-100 border border-slate-200 rounded py-1 px-2 overflow-x-auto whitespace-nowrap">
                {embedCode}
              </code>
            </div>

            <div className="flex flex-col gap-2 min-w-0 max-w-[420px]">
              <DialogLabel htmlFor="sm-edit-ref">
                Id
                <DialogHelperCopy>
                  Used in the embed code. Changing it updates every reference to
                  this snippet already in your document.
                </DialogHelperCopy>
              </DialogLabel>
              <input
                id="sm-edit-ref"
                type="text"
                className="text-[0.9rem] border border-slate-300 rounded py-1.5 px-2.5 bg-white outline-none text-slate-900 w-full focus:border-[#0e639c] focus:shadow-[0_0_0_2px_rgba(14,99,156,0.15)]"
                value={refValue}
                onChange={(e) => setRefValue(e.target.value)}
                disabled={busy}
              />

              <DialogLabel htmlFor="sm-edit-format">Source format</DialogLabel>
              <select
                id="sm-edit-format"
                className="text-[0.9rem] border border-slate-300 rounded py-1.5 px-2.5 bg-white outline-none text-slate-900 w-full focus:border-[#0e639c] focus:shadow-[0_0_0_2px_rgba(14,99,156,0.15)]"
                value={sourceFormatValue}
                onChange={(e) => setSourceFormatValue(e.target.value as Snippet["sourceFormat"])}
                disabled={busy}
              >
                <option value="pretext">PreTeXt</option>
                <option value="latex">LaTeX</option>
                <option value="markdown">Markdown</option>
              </select>
            </div>

            <DialogLabel>
              Source
              <DialogHelperCopy>
                Copied into the document wherever the embed code is included.
              </DialogHelperCopy>
            </DialogLabel>
            <DialogEditorPane
              data-testid="snippet-edit-source-editor"
              className="flex-none min-h-0"
              style={{ height: editorHeight }}
            >
              <Editor
                options={{ ...editorOptions, readOnly: busy }}
                height="100%"
                language={MONACO_LANGUAGE_FOR_FORMAT[sourceFormatValue]}
                value={sourceValue}
                onMount={handleEditorMount}
                onChange={(value) => setSourceValue(value ?? "")}
              />
            </DialogEditorPane>
            {error && (
              <p className="m-0 py-[0.4rem] px-[0.6rem] bg-[#fde8e8] text-red-700 rounded text-[0.83rem]">
                {error}
              </p>
            )}
          </DialogSection>
        </DialogContent>

        <DialogActions>
          {canDuplicate && (
            <DialogButton
              variant="secondary"
              className="mr-auto"
              onClick={handleDuplicate}
              disabled={busy}
              title="Create a copy of this snippet under a new reference"
            >
              {isDuplicating ? "Duplicating…" : "Duplicate"}
            </DialogButton>
          )}
          <DialogButton variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </DialogButton>
          <DialogButton onClick={handleSave} disabled={busy}>
            {isSaving ? "Saving…" : "Save and copy embed code"}
          </DialogButton>
        </DialogActions>
      </Dialog>
    </DialogOverlay>
  );
};

export default SnippetEditModal;
