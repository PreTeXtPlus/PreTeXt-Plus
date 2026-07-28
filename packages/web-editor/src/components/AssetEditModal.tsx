import { useEffect, useRef, useState } from "react";
import { Editor } from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import type { Asset } from "../types/editor";
import { useEditorStore } from "../store/hooks";
import { assetEmbedCode } from "../sectionUtils";
import "./dialog.css";
import "./AssetManagerModal.css";

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

const KIND_TAG: Record<Asset["kind"], string> = { image: "image", doenet: "interactive" };

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

  const embedCode = assetEmbedCode(
    asset.kind,
    refValue.trim() || prevRef,
    activeFormat,
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(embedCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    const ref = refValue.trim();
    if (!ref) {
      setError("Reference can't be empty — it identifies the asset and is used by every embed of it.");
      return;
    }
    // A ref must stay unique within its kind: it's the key every
    // `<plus:KIND ref="..."/>` placeholder resolves against.
    if (
      ref !== prevRef &&
      projectAssets.some((a) => a.kind === asset.kind && a.ref === ref)
    ) {
      setError(`Reference "${ref}" is already used by another asset. Choose a unique reference.`);
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await onSave({ ...asset, title: titleValue.trim() || ref, ref, source: sourceValue }, prevRef);
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
  const showPreview = asset.kind === "image" && !!asset.url;
  const canReplace = asset.kind === "image" && !!onReplace;

  return (
    <div
      className="pretext-plus-editor__dialog-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="pretext-plus-editor__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit asset ${asset.title}`}
      >
        <div className="pretext-plus-editor__dialog-header">
          <h2 className="pretext-plus-editor__dialog-title">Edit asset</h2>
          <button
            type="button"
            className="pretext-plus-editor__dialog-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div
          ref={contentRef}
          className="pretext-plus-editor__dialog-content pretext-plus-editor__dialog-content--single pretext-plus-editor__am-edit-content"
        >
          <div className="pretext-plus-editor__dialog-section">
            <div className="pretext-plus-editor__am-edit-grid">
              {/* Left column: preview, replace, embed code */}
              <div className="pretext-plus-editor__am-edit-col">
                {showPreview && (
                  <img
                    src={asset.url}
                    alt={titleValue}
                    className="pretext-plus-editor__am-url-preview"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                )}

                {canReplace && (
                  <div className="pretext-plus-editor__am-replace-row">
                    <button
                      type="button"
                      className="pretext-plus-editor__am-action-btn"
                      onClick={() => onReplace?.(asset)}
                      disabled={busy}
                      title="Choose or upload a different asset to use here"
                    >
                      Replace image…
                    </button>
                  </div>
                )}
              </div>

              {/* Right column: title and id fields, then embed code */}
              <div className="pretext-plus-editor__am-edit-col">
                <label className="pretext-plus-editor__dialog-label" htmlFor="am-edit-title">Title</label>
                <input
                  id="am-edit-title"
                  type="text"
                  className="pretext-plus-editor__am-input"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  disabled={busy}
                />

                <label className="pretext-plus-editor__dialog-label" htmlFor="am-edit-ref">Id</label>
                <input
                  id="am-edit-ref"
                  type="text"
                  className="pretext-plus-editor__am-input"
                  value={refValue}
                  onChange={(e) => setRefValue(e.target.value)}
                  disabled={busy}
                />
                <p className="pretext-plus-editor__dialog-helper-copy">
                  Used in the embed code. Changing it updates every reference to this
                  asset already in your document.
                </p>

                <div className="pretext-plus-editor__am-embed-row">
                  <code className="pretext-plus-editor__am-embed-code">{embedCode}</code>
                  <button
                    type="button"
                    className={`pretext-plus-editor__am-action-btn${copied ? " pretext-plus-editor__am-action-btn--done" : ""}`}
                    onClick={handleCopy}
                    title="Copy embed code to clipboard"
                  >
                    {copied ? "Copied!" : "Copy embed code"}
                  </button>
                </div>
              </div>
            </div>

            <label className="pretext-plus-editor__dialog-label">Asset content</label>
            <p className="pretext-plus-editor__dialog-helper-copy">
              Inserted verbatim inside the generated <code>{`<${KIND_TAG[asset.kind]}>`}</code> element
              — e.g. <code>{"<shortdescription>...</shortdescription>"}</code>.
            </p>
            <div
              className="pretext-plus-editor__dialog-editor pretext-plus-editor__am-edit-editor"
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
            </div>
            {error && <p className="pretext-plus-editor__am-error">{error}</p>}
          </div>
        </div>

        <div className="pretext-plus-editor__dialog-actions">
          {onDuplicate && (
            <button
              type="button"
              className="pretext-plus-editor__dialog-button pretext-plus-editor__dialog-button--secondary pretext-plus-editor__am-duplicate-btn"
              onClick={handleDuplicate}
              disabled={busy}
              title="Create a copy of this asset under a new reference"
            >
              {isDuplicating ? "Duplicating…" : "Duplicate"}
            </button>
          )}
          <button
            type="button"
            className="pretext-plus-editor__dialog-button pretext-plus-editor__dialog-button--secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="pretext-plus-editor__dialog-button"
            onClick={handleSave}
            disabled={busy}
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssetEditModal;
