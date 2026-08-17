import { useEffect, useRef, useState } from "react";
import { Editor } from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import clsx from "clsx";
import type { Asset } from "../types/editor";
import { useEditorStore } from "../store/hooks";
import { assetEmbedCode } from "../sectionUtils";
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
  // The editor grows to fit its content (see onMount) so it never shows its own
  // scrollbar — the modal is the only thing that scrolls.
  scrollBeyondLastLine: false,
};

/** Floor for the auto-sized editor so a short/empty asset still has room to type. */
const MIN_EDITOR_HEIGHT = 160;

export interface AssetEditModalProps {
  asset: Asset;
  /** The full project pool, used to reject a `ref` that collides with another asset. */
  projectAssets: Asset[];
  onClose: () => void;
  /**
   * Persist the edited asset. `prevRef` is the asset's ref *before* this edit so
   * the caller can rewrite in-document placeholders when the ref changed.
   */
  onSave: (asset: Asset, prevRef: string) => Promise<void> | void;
  /**
   * Begin replacing this asset — opens the asset manager's replace mode, where
   * the user picks/uploads a new asset. When omitted, the Replace control is
   * hidden.
   */
  onReplace?: (asset: Asset) => void;
  /**
   * Duplicate this asset under a fresh ref. When omitted, the button is hidden.
   * May be async; the modal shows a busy state until it settles.
   */
  onDuplicate?: (asset: Asset) => void | Promise<void>;
}

const AssetEditModal = ({
  asset,
  projectAssets,
  onClose,
  onSave,
  onReplace,
  onDuplicate,
}: AssetEditModalProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const activeDivisionId = useEditorStore((s) => s.activeDivisionId);
  // Match the copyable embed code to the division being edited — Markdown needs
  // the `::image{ref="x"}` directive form (raw `<plus:.../>` XML doesn't survive
  // Markdown conversion). Defaults to PreTeXt.
  const activeFormat =
    divisions?.find((d) => d.xmlId === activeDivisionId)?.sourceFormat ??
    "pretext";

  const prevRef = asset.ref ?? "";
  const [titleValue, setTitleValue] = useState(asset.title);
  const [refValue, setRefValue] = useState(prevRef);
  const [sourceValue, setSourceValue] = useState(asset.source ?? "");
  const [shortDescriptionValue, setShortDescriptionValue] = useState(asset.shortDescription ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);
  const contentRef = useRef<HTMLDivElement>(null);

  // When the modal opens, keep it scrolled to the top so the user sees the
  // preview and fields first — not the code editor lower down.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, []);

  // Size the editor to its content so it never scrolls internally; the modal
  // scrolls as a whole instead of nesting a second scrollbar.
  const handleEditorMount: OnMount = (editor) => {
    const sync = () =>
      setEditorHeight(Math.max(MIN_EDITOR_HEIGHT, editor.getContentHeight()));
    editor.onDidContentSizeChange(sync);
    sync();
  };

  const embedCode = assetEmbedCode(refValue.trim() || prevRef, activeFormat);

  const handleCopy = () => {
    navigator.clipboard?.writeText(embedCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    const ref = refValue.trim();
    if (!ref) {
      setError("Reference can't be empty — it identifies the asset and is used by every embed of it.");
      return;
    }
    // A ref must stay unique project-wide: it's the key every
    // `<plus:image ref="..."/>` placeholder resolves against.
    if (
      ref !== prevRef &&
      projectAssets.some((a) => a.ref === ref)
    ) {
      setError(`Reference "${ref}" is already used by another asset. Choose a unique reference.`);
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await onSave(
        {
          ...asset,
          title: titleValue.trim() || ref,
          ref,
          source: sourceValue,
          shortDescription: shortDescriptionValue.trim() || undefined,
        },
        prevRef,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save asset.");
      setIsSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!onDuplicate) return;
    setError(null);
    setIsDuplicating(true);
    try {
      // On success the parent re-opens the editor on the new copy, which
      // remounts this modal (see the `key` in Editors), so there's no need to
      // clear the busy flag here — the instance is gone.
      await onDuplicate(asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate asset.");
      setIsDuplicating(false);
    }
  };

  const busy = isSaving || isDuplicating;
  const showPreview = !!asset.url;
  const canReplace = !!onReplace;
  // Duplicate re-fetches the asset's bytes and re-uploads them (see
  // Editors.tsx's handleAssetDuplicate), so it's meaningless for an authored
  // asset with no file to fetch -- Editors.tsx silently no-ops rather than
  // resolving/rejecting when `asset.url` is missing, which would otherwise
  // leave this button stuck on "Duplicating…" forever.
  const canDuplicate = !!onDuplicate && !!asset.url;

  // For a file-backed asset this is genuinely optional/secondary (an extra
  // `<description>`), so it stays collapsed under "Advanced". For an authored
  // asset it *is* the asset's entire content, so it's shown directly instead
  // -- see the `asset.isFile` branch below.
  const sourceEditor = (
    <>
      <DialogLabel>
        {asset.isFile ? "Additional source" : "PreTeXt source"}
        <DialogHelperCopy>
          {asset.isFile ? (
            <>
              Inserted verbatim inside the generated <code>{"<image>"}</code>{" "}
              element — e.g. <code>{"<description>...</description>"}</code>.
            </>
          ) : (
            <>
              The PreTeXt element(s) this reference resolves to, inserted
              verbatim inside the generated <code>{"<image>"}</code> element —
              e.g. <code>{"<latex-image>...</latex-image>"}</code>.
            </>
          )}
        </DialogHelperCopy>
      </DialogLabel>
      <DialogEditorPane
        data-testid="asset-edit-source-editor"
        className="flex-none min-h-0"
        style={{ height: editorHeight }}
      >
        <Editor
          options={{ ...editorOptions, readOnly: busy }}
          height="100%"
          language="xml"
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
    </>
  );

  return (
    <DialogOverlay onClick={(e) => e.target === e.currentTarget && onClose()}>
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-label={`Manage asset ${asset.title}`}
      >
        <DialogHeader>
          <DialogTitle>Manage asset</DialogTitle>
          <DialogClose onClick={onClose} aria-label="Close">
            ✕
          </DialogClose>
        </DialogHeader>

        <DialogContent
          single
          ref={contentRef}
          className="flex flex-col"
        >
          <DialogSection>
            <div className="grid gap-5 items-start shrink-0 max-[700px]:grid-cols-1 max-[700px]:gap-2">
              {/* Left column: preview, replace, embed code */}
              {showPreview && (
                <div className="flex flex-col gap-2 min-w-0">
                  <DialogLabel>Asset preview:</DialogLabel>
                  <img
                    src={asset.url}
                    alt={titleValue}
                    className="max-w-full max-h-[200px] object-contain border border-slate-200 rounded bg-slate-50"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />

                  {canReplace && (
                    <div className="flex justify-end items-center gap-2 mb-2">
                      <span className="text-[0.72rem] text-slate-400 font-mono whitespace-nowrap overflow-hidden text-ellipsis">
                        {asset?.contentType && `${asset.contentType}`}
                      </span>
                      <button
                        type="button"
                        className={clsx(ACTION_BTN_CLASSES, ACTION_BTN_DEFAULT_CLASSES)}
                        onClick={() => onReplace?.(asset)}
                        disabled={busy}
                        title="Choose or upload a different asset to use here"
                      >
                        Replace image…
                      </button>
                    </div>
                  )}
                </div>
              )}

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


              {/* Right column: title and id fields, then embed code */}
              <div className="flex flex-col gap-2 min-w-0">
                <DialogLabel htmlFor="am-edit-title">Title</DialogLabel>
                <input
                  id="am-edit-title"
                  type="text"
                  className="text-[0.9rem] border border-slate-300 rounded py-1.5 px-2.5 bg-white outline-none text-slate-900 w-full focus:border-[#0e639c] focus:shadow-[0_0_0_2px_rgba(14,99,156,0.15)]"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  disabled={busy}
                />

                <DialogLabel htmlFor="am-edit-ref">Id
                <DialogHelperCopy>
                  Used in the embed code. Changing it updates every reference to this
                  asset already in your document.
                </DialogHelperCopy></DialogLabel>
                <input
                  id="am-edit-ref"
                  type="text"
                  className="text-[0.9rem] border border-slate-300 rounded py-1.5 px-2.5 bg-white outline-none text-slate-900 w-full focus:border-[#0e639c] focus:shadow-[0_0_0_2px_rgba(14,99,156,0.15)]"
                  value={refValue}
                  onChange={(e) => setRefValue(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>

            <DialogLabel htmlFor="am-edit-short-description">
              Short description (Alt text)
              <DialogHelperCopy>
                A brief plaintext description of the image for accessibility,
                automatically inserted as a PreTeXt <code>&lt;shortdescription/&gt;</code>
              </DialogHelperCopy>
            </DialogLabel>
            <input
              id="am-edit-short-description"
              type="text"
              className="text-[0.9rem] border border-slate-300 rounded py-1.5 px-2.5 bg-white outline-none text-slate-900 w-full focus:border-[#0e639c] focus:shadow-[0_0_0_2px_rgba(14,99,156,0.15)]"
              value={shortDescriptionValue}
              onChange={(e) => setShortDescriptionValue(e.target.value)}
              disabled={busy}
            />
            {!shortDescriptionValue.trim() && (
              <p className="m-0 py-[0.4rem] px-[0.6rem] bg-amber-100 text-amber-800 rounded text-[0.83rem]">
                ⚠ A short description is required for accessibility.
              </p>
            )}

            {asset.isFile ? (
              <details data-testid="asset-edit-advanced">
                <summary className="cursor-pointer select-none">Advanced</summary>
                {sourceEditor}
              </details>
            ) : (
              sourceEditor
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
              title="Create a copy of this asset under a new reference"
            >
              {isDuplicating ? "Duplicating…" : "Duplicate"}
            </DialogButton>
          )}
          <DialogButton variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </DialogButton>
          <DialogButton onClick={handleSave} disabled={busy}>
            {isSaving ? "Saving…" : "Save"}
          </DialogButton>
        </DialogActions>
      </Dialog>
    </DialogOverlay>
  );
};

export default AssetEditModal;
