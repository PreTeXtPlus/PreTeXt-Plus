import { useState, useEffect, useRef, type ReactNode } from "react";
import type { Asset, AssetKind } from "../types/editor";
import { useEditorStore } from "../store/hooks";
import { assetEmbedCode } from "../sectionUtils";
import { buildProjectAssetView, type AssetRow } from "../assetView";
import { ASSET_KIND_LABELS, SHOW_DOENET, VISIBLE_ASSET_KINDS } from "../assetKinds";
import "./dialog.css";
import "./AssetManagerModal.css";
import doenetLogo from "../assets/doenet.png";

export interface AssetManagerModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Which main tab to show on open. Defaults to "in-document". Has no effect
   * in resolve/replace mode, which always goes straight to the source picker.
   */
  initialTab?: AssetManagerMainTab;
  /**
   * When set, the modal opens in "resolve" mode for an unresolved
   * `<plus:KIND ref="..."/>` placeholder: it goes straight to the source picker
   * for that kind, and whatever asset the user picks/uploads/creates is bound to
   * this placeholder (its ref is rewritten in the source) instead of copying an
   * embed code.
   */
  resolveTarget?: { kind: AssetKind; ref: string } | null;
  /**
   * When set, the modal opens in "replace" mode for an existing asset: it goes
   * straight to the source picker, and whatever the user picks/uploads/creates
   * takes over from this asset (handled by `onReplaceAsset`).
   */
  replaceTarget?: Asset | null;
  /**
   * Upload an image file; host returns the created asset. `title` is the
   * human-readable title the user entered — distinct from `file.name` — and
   * should be persisted as the asset's title.
   */
  onUpload?: (file: File, title?: string) => Promise<Asset>;
  /**
   * Fetch an external URL on the user's behalf (server-side, to avoid CORS)
   * and return the raw file bytes. Must not create a persisted asset — the
   * returned file is then committed via `onUpload`, the same as a local
   * file pick, so there is a single code path that creates project assets.
   */
  onFetchUrl?: (url: string) => Promise<File>;
  /** Create a new Doenet activity; host returns the created asset. */
  onCreateDoenet?: (title: string, ref: string) => Promise<Asset>;
  /** Remove an asset from the project. */
  onRemoveAsset?: (asset: Asset) => void;
  /**
   * Duplicate an asset under a fresh ref (same behaviour as Duplicate in the
   * asset editor). May be async; the row shows a busy state until it settles,
   * then the manager closes as the editor opens on the new copy. When omitted,
   * the Duplicate control is hidden.
   */
  onDuplicateAsset?: (asset: Asset) => void | Promise<void>;
  /** Notify that an asset now exists in the project (optimistic pool add). */
  onAssetAdded: (asset: Asset) => void;
  /** Rewrite in-document `<plus:KIND ref="oldRef"/>` placeholders to `newRef`. */
  onResolveRef: (kind: AssetKind, oldRef: string, newRef: string) => void;
  /**
   * Replace `oldAsset` with the user's freshly created `newAsset`, which adopts
   * the old asset's ref so the document's references don't move.
   */
  onReplaceAsset: (oldAsset: Asset, newAsset: Asset) => void;
}

export type AssetManagerMainTab = "in-document" | "add";
type MainTab = AssetManagerMainTab;
type ImageSourceTab = "upload" | "url";

/**
 * A throwaway client-side id for a locally-created asset, used only in the
 * demo/no-host fallback branches where the host provides no persistence
 * callback to mint a real id. Kept at module scope (not inline in the
 * component) so its impure `Date.now()` isn't flagged by the React Compiler's
 * purity check for component-body code.
 */
function localAssetId(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

/**
 * Clipboard image files never carry a meaningful filename — browsers hand
 * back either an empty string (Firefox) or a generic placeholder like
 * "image.png" (Chromium) that looks legitimate but isn't. Always replace it
 * with a fresh, uniquely-timestamped name.
 */

function namePastedImageFile(file: File): File {
  return new File([file], `pasted-image-${Date.now()}`, { type: file.type });
}

const AssetManagerModal = ({
  open,
  onClose,
  initialTab,
  resolveTarget,
  replaceTarget,
  onUpload,
  onFetchUrl,
  onCreateDoenet,
  onRemoveAsset,
  onDuplicateAsset,
  onAssetAdded,
  onResolveRef,
  onReplaceAsset,
}: AssetManagerModalProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const activeDivisionId = useEditorStore((s) => s.activeDivisionId);
  // The embed code the user copies is matched to the division they're editing:
  // a Markdown division needs `::image{ref="x"}`, since raw `<plus:.../>` XML
  // pasted into Markdown doesn't survive conversion. Falls back to PreTeXt.
  const activeFormat =
    divisions?.find((d) => d.xmlId === activeDivisionId)?.sourceFormat ??
    "pretext";
  const embedFor = (kind: AssetKind, ref: string) =>
    assetEmbedCode(kind, ref, activeFormat);
  // Authoritative project-asset pool, owned by the store.
  const projectAssets = useEditorStore((s) => s.projectAssets) ?? [];
  const openAssetEditor = useEditorStore((s) => s.openAssetEditor);
  const openAssetResolver = useEditorStore((s) => s.openAssetResolver);
  const removeAssetRefFromDocument = useEditorStore((s) => s.removeAssetRefFromDocument);

  const [tab, setTab] = useState<MainTab>(initialTab ?? "in-document");
  const [addKind, setAddKind] = useState<AssetKind | null>(null);
  const [imageTab, setImageTab] = useState<ImageSourceTab>("upload");

  // Upload state
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // A file picked for upload but not yet committed — held so the user can
  // preview it and set a title before the actual upload fires (mirrors the
  // External URL tab's preview-then-confirm flow).
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [pendingUploadPreviewUrl, setPendingUploadPreviewUrl] = useState<string | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");

  // URL state
  const [urlValue, setUrlValue] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  // Create Doenet state
  const [doenetTitle, setDoenetTitle] = useState("");
  const [doenetRef, setDoenetRef] = useState("");
  const [isCreatingDoenet, setIsCreatingDoenet] = useState(false);
  const [doenetError, setDoenetError] = useState<string | null>(null);

  // Copy feedback (keyed by `kind:ref`)
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Row whose Duplicate round-trip (fetch + re-upload) is in flight (keyed by `kind:ref`).
  const [duplicatingKey, setDuplicatingKey] = useState<string | null>(null);

  // Success panel shown after a normal-mode add (asset added + embed copied).
  const [addedAsset, setAddedAsset] = useState<Asset | null>(null);

  // Stash a picked/dropped file for preview; the actual upload is deferred
  // until the user confirms via "Add to Project". `title` defaults to the
  // filename, but callers can override it — a pasted image's filename is a
  // disposable, timestamped placeholder (see `namePastedImageFile`), not
  // something worth showing as the default title/ref.
  const selectPendingUpload = (file: File, title = file.name) => {
    setUploadError(null);
    setPendingUploadFile(file);
    setUploadTitle(title);
    setPendingUploadPreviewUrl(URL.createObjectURL(file));
  };

  // Escape-to-close. Re-binds when `onClose` changes, but never triggers a load.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Revoke the preview object URL whenever it's replaced or the modal unmounts.
  useEffect(() => {
    return () => {
      if (pendingUploadPreviewUrl) URL.revokeObjectURL(pendingUploadPreviewUrl);
    };
  }, [pendingUploadPreviewUrl]);

  // Is pasting an image a sensible thing to do right now? Any time this
  // modal is open and uploads are supported — including the "Assets" tab,
  // the kind picker, mid-Doenet-form, or with an image already staged (a
  // fresh paste replaces it) — a stray Ctrl/Cmd+V with an image on the
  // clipboard jumps straight to Image/Upload. The one exception is a
  // resolve/replace target locked to a non-image kind (e.g. an unresolved
  // Doenet placeholder), which has no Image view to receive it.
  const pasteImageActive =
    open &&
    !!onUpload &&
    (resolveTarget ? resolveTarget.kind === "image"
      : replaceTarget ? replaceTarget.kind === "image"
      : true);

  // Bound at the window level (rather than the drop zone's onPaste) so it
  // fires no matter what currently has focus inside the modal.
  useEffect(() => {
    if (!pasteImageActive) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            // Clear the prior success panel (if any) — the newly staged
            // upload should show, not a stale "added" confirmation.
            setAddedAsset(null);
            setTab("add");
            setAddKind("image");
            setImageTab("upload");
            selectPendingUpload(namePastedImageFile(file), "Pasted Image");
          }
          return;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [pasteImageActive]);

  if (!open) return null;

  const assetView = buildProjectAssetView(divisions, projectAssets);

  // ── Commit a freshly-produced asset (upload/url/create) ───────────────────
  // Replace mode swaps it in for `replaceTarget`. Resolve mode binds it to the
  // placeholder being resolved (rewriting that placeholder's ref). Otherwise
  // (normal add) it's dropped in the pool, its embed code is copied, and the
  // success panel is shown so the user can paste it where they want it.
  const commitAsset = (asset: Asset) => {
    if (replaceTarget) {
      onReplaceAsset(replaceTarget, asset);
      onClose();
      return;
    }
    onAssetAdded(asset);
    if (resolveTarget) {
      if (asset.ref) onResolveRef(resolveTarget.kind, resolveTarget.ref, asset.ref);
      onClose();
      return;
    }
    if (asset.ref) navigator.clipboard.writeText(embedFor(asset.kind, asset.ref)).catch(() => {});
    setAddedAsset(asset);
  };

  const handleCopy = (kind: AssetKind, ref: string) => {
    const key = `${kind}:${ref}`;
    navigator.clipboard.writeText(embedFor(kind, ref)).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
  };

  const clearPendingUpload = () => {
    setPendingUploadFile(null);
    setPendingUploadPreviewUrl(null);
    setUploadTitle("");
  };

  const handleUploadConfirm = async () => {
    if (!onUpload || !pendingUploadFile) return;
    setUploadError(null);
    setIsUploading(true);
    try {
      const title = uploadTitle.trim() || pendingUploadFile.name;
      const asset = await onUpload(pendingUploadFile, title);
      commitAsset(asset);
      clearPendingUpload();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleUrlInsert = async () => {
    const url = urlValue.trim();
    if (!url) return;
    const title = urlTitle.trim();
    if (onFetchUrl && onUpload) {
      setUrlError(null);
      setIsAddingUrl(true);
      try {
        const fetched = await onFetchUrl(url);
        const asset = await onUpload(fetched, title || undefined);
        commitAsset(asset);
      } catch (err) {
        setUrlError(err instanceof Error ? err.message : "Failed to add URL.");
      } finally {
        setIsAddingUrl(false);
      }
    } else {
      commitAsset({
        id: localAssetId("url"),
        title: title || url,
        ref: url.split("/").pop() ?? "image",
        kind: "image",
        url,
      });
    }
  };

  const handleCreateDoenet = async () => {
    const title = doenetTitle.trim();
    const ref = doenetRef.trim();
    if (!title || !ref) return;
    if (onCreateDoenet) {
      setDoenetError(null);
      setIsCreatingDoenet(true);
      try {
        const asset = await onCreateDoenet(title, ref);
        commitAsset(asset);
      } catch (err) {
        setDoenetError(err instanceof Error ? err.message : "Failed to create activity.");
      } finally {
        setIsCreatingDoenet(false);
      }
    } else {
      commitAsset({ id: localAssetId("doenet"), title, ref, kind: "doenet" });
    }
  };

  // ── "In Document" tab — the joined project-asset view ─────────────────────
  const renderInDocument = () => {
    if (assetView.length === 0) {
      return (
        <div className="pretext-plus-editor__am-placeholder">
          <p>No assets in this project yet.</p>
          <button
            type="button"
            className="pretext-plus-editor__dialog-button"
            onClick={() => { setTab("add"); setAddKind(null); }}
          >
            Add an asset
          </button>
        </div>
      );
    }

    const byKind = VISIBLE_ASSET_KINDS.map((kind) => ({
      kind,
      rows: assetView.filter((r) => r.kind === kind),
    })).filter((g) => g.rows.length > 0);

    const renderRow = (row: AssetRow) => {
      const ck = `${row.kind}:${row.ref}`;
      const isDuplicating = duplicatingKey === ck;
      const onOpen = () => {
        if (row.status === "unlinked") {
          // Switches this same modal into resolve mode (resolveTarget wins in render).
          openAssetResolver(row.kind, row.ref);
        } else {
          // Hand off to the standalone asset editor; close the manager so the
          // two dialogs don't stack.
          openAssetEditor(row.kind, row.ref);
          onClose();
        }
      };
      return (
        <li key={ck} className="pretext-plus-editor__am-doc-row">
          <button
            type="button"
            className="pretext-plus-editor__am-row-info pretext-plus-editor__am-row-info--btn"
            onClick={onOpen}
            title={row.status === "unlinked" ? "No asset for this reference — click to link or create one" : "Edit asset"}
          >
            <span className="pretext-plus-editor__am-row-name">{row.asset?.title ?? row.ref}</span>
            <span className="pretext-plus-editor__am-row-ref">{row.ref}</span>
          </button>
          {row.status === "unlinked" && (
            <span className="pretext-plus-editor__am-status pretext-plus-editor__am-status--warn" title="No asset for this reference">
              needs asset
            </span>
          )}
          {row.status === "unused" && (
            <span className="pretext-plus-editor__am-status" title="Not referenced in the document yet">
              not placed
            </span>
          )}
          <div className="pretext-plus-editor__am-row-actions">
            <button
              type="button"
              className="pretext-plus-editor__am-action-btn"
              onClick={onOpen}
            >
              {row.status === "unlinked" ? "Link / create" : "Edit"}
            </button>
            <button
              type="button"
              className={`pretext-plus-editor__am-action-btn${copiedKey === ck ? " pretext-plus-editor__am-action-btn--done" : ""}`}
              onClick={() => handleCopy(row.kind, row.ref)}
              title={`Copy ${embedFor(row.kind, row.ref)}`}
            >
              {copiedKey === ck ? "Copied!" : "Copy embed code"}
            </button>
            {onDuplicateAsset && row.asset?.url && (
              <button
                type="button"
                className="pretext-plus-editor__am-action-btn"
                disabled={isDuplicating}
                onClick={async () => {
                  setDuplicatingKey(ck);
                  try {
                    // On success the editor opens on the new copy; close the
                    // manager so the two dialogs don't stack (mirrors Edit).
                    await onDuplicateAsset(row.asset!);
                    onClose();
                  } catch {
                    setDuplicatingKey(null);
                  }
                }}
                title="Create a copy of this asset under a new reference"
              >
                {isDuplicating ? "Duplicating…" : "Duplicate"}
              </button>
            )}
            {onRemoveAsset && row.asset && (
              <button
                type="button"
                className="pretext-plus-editor__am-action-btn pretext-plus-editor__am-action-btn--danger"
                onClick={() => {
                  // Also strip the placeholders, else the row would return as
                  // "needs asset" (mirrors the sidebar's Remove from project).
                  if (
                    row.inDocument &&
                    !window.confirm(
                      `Remove "${row.asset!.title}" from the project? This also deletes its reference(s) from the document.`,
                    )
                  ) {
                    return;
                  }
                  onRemoveAsset(row.asset!);
                  removeAssetRefFromDocument(row.kind, row.ref);
                  onClose();
                }}
                title="Remove from project"
              >
                Remove
              </button>
            )}
          </div>
        </li>
      );
    };

    return (
      <div className="pretext-plus-editor__am-in-doc">
        {byKind.map(({ kind, rows }) => (
          <div key={kind} className="pretext-plus-editor__am-kind-group">
            <div className="pretext-plus-editor__am-kind-header">
              <span aria-hidden="true">📁</span>
              <span>{ASSET_KIND_LABELS[kind]}</span>
              <span className="pretext-plus-editor__am-kind-count">{rows.length}</span>
            </div>
            <ul className="pretext-plus-editor__am-list">{rows.map(renderRow)}</ul>
          </div>
        ))}
      </div>
    );
  };

  // ── Success panel after a normal-mode add ─────────────────────────────────
  const renderAddedSuccess = (asset: Asset) => (
    <div className="pretext-plus-editor__am-success">
      <p className="pretext-plus-editor__am-success-title">
        ✓ Added “{asset.title}” — embed code copied to clipboard
      </p>
      <p className="pretext-plus-editor__dialog-helper-copy">
        It now appears in the Assets list. Paste this where you want it to appear:
      </p>
      {asset.ref && (
        <div className="pretext-plus-editor__am-embed-row">
          <code className="pretext-plus-editor__am-embed-code">{embedFor(asset.kind, asset.ref)}</code>
          <button
            type="button"
            className={`pretext-plus-editor__am-action-btn${copiedKey === `${asset.kind}:${asset.ref}` ? " pretext-plus-editor__am-action-btn--done" : ""}`}
            onClick={() => handleCopy(asset.kind, asset.ref!)}
          >
            {copiedKey === `${asset.kind}:${asset.ref}` ? "Copied!" : "Copy again"}
          </button>
        </div>
      )}
      <div className="pretext-plus-editor__am-success-actions">
        <button
          type="button"
          className="pretext-plus-editor__dialog-button pretext-plus-editor__dialog-button--secondary"
          onClick={() => { setAddedAsset(null); setAddKind(null); setTab("add"); }}
        >
          Add another
        </button>
        <button
          type="button"
          className="pretext-plus-editor__dialog-button"
          onClick={() => { setAddedAsset(null); setTab("in-document"); }}
        >
          Done
        </button>
      </div>
    </div>
  );

  // ── "Add Asset" tab ────────────────────────────────────────────────────────
  const renderKindPicker = () => (
    <div className="pretext-plus-editor__am-kind-picker">
      <p className="pretext-plus-editor__am-kind-picker-label">What kind of asset?</p>
      <div className="pretext-plus-editor__am-kind-cards">
        <button
          type="button"
          className="pretext-plus-editor__am-kind-card"
          onClick={() => { setAddKind("image"); setImageTab(onUpload ? "upload" : "url"); }}
        >
          <span className="pretext-plus-editor__am-kind-card-icon" aria-hidden="true">🖼️</span>
          <span className="pretext-plus-editor__am-kind-card-label">Image</span>
          <span className="pretext-plus-editor__am-kind-card-hint">PNG, JPEG, SVG, etc.</span>
        </button>
        {SHOW_DOENET && (
          <button
            type="button"
            className="pretext-plus-editor__am-kind-card"
            onClick={() => setAddKind("doenet")}
          >
            <span className="pretext-plus-editor__am-kind-card-icon" aria-hidden="true"><img src={doenetLogo} alt="Doenet" /></span>
            <span className="pretext-plus-editor__am-kind-card-label">Doenet</span>
            <span className="pretext-plus-editor__am-kind-card-hint">Interactive activity</span>
          </button>
        )}
        {!SHOW_DOENET && (
          <div
            className="pretext-plus-editor__am-kind-card pretext-plus-editor__am-kind-card--soon"
            aria-disabled="true"
          >
            <span className="pretext-plus-editor__am-kind-card-icon" aria-hidden="true">✨</span>
            <span className="pretext-plus-editor__am-kind-card-label">More coming soon</span>
            <span className="pretext-plus-editor__am-kind-card-hint">Interactive activities and more</span>
          </div>
        )}
      </div>
    </div>
  );

  const renderImageAdd = (showBack: boolean) => (
    <div className="pretext-plus-editor__am-configure">
      {showBack && (
        <button type="button" className="pretext-plus-editor__am-back-btn" onClick={() => setAddKind(null)}>
          ← Back
        </button>
      )}
      <div className="pretext-plus-editor__dialog-tab-bar pretext-plus-editor__am-sub-tabs">
        {onUpload && (
          <button
            type="button"
            className={`pretext-plus-editor__dialog-tab${imageTab === "upload" ? " pretext-plus-editor__dialog-tab--active" : ""}`}
            onClick={() => setImageTab("upload")}
          >
            Upload
          </button>
        )}
        <button
          type="button"
          className={`pretext-plus-editor__dialog-tab${imageTab === "url" ? " pretext-plus-editor__dialog-tab--active" : ""}`}
          onClick={() => setImageTab("url")}
        >
          External URL
        </button>
      </div>
      <div className="pretext-plus-editor__am-configure-body">
        {imageTab === "upload" && onUpload && (
          <div className="pretext-plus-editor__am-upload">
            {!pendingUploadFile ? (
              <div
                className={[
                  "pretext-plus-editor__am-drop-zone",
                  isDragging ? "pretext-plus-editor__am-drop-zone--active" : "",
                ].filter(Boolean).join(" ")}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) selectPendingUpload(f); }}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
                aria-label="Paste an image, drag and drop to upload, or click to browse files"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="pretext-plus-editor__dialog-file-input"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) selectPendingUpload(f); }}
                />
                <span className="pretext-plus-editor__am-drop-icon" aria-hidden="true">↑</span>
                <p className="pretext-plus-editor__am-drop-text">Paste your image, drag &amp; drop a file, or click to browse</p>
                <p className="pretext-plus-editor__dialog-helper-copy">PNG, JPEG, GIF, SVG, WebP</p>
              </div>
            ) : (
              <div className="pretext-plus-editor__am-url-form">
                <img
                  src={pendingUploadPreviewUrl ?? undefined}
                  alt="Preview"
                  className="pretext-plus-editor__am-url-preview"
                />
                <label className="pretext-plus-editor__dialog-label" htmlFor="am-upload-title">
                  Title <span className="pretext-plus-editor__dialog-helper-copy">(optional)</span>
                </label>
                <input
                  id="am-upload-title"
                  type="text"
                  className="pretext-plus-editor__am-input"
                  placeholder={pendingUploadFile.name}
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  disabled={isUploading}
                  autoFocus
                />
                {uploadError && <p className="pretext-plus-editor__am-error">{uploadError}</p>}
                <button
                  type="button"
                  className="pretext-plus-editor__dialog-button pretext-plus-editor__dialog-button--secondary"
                  onClick={clearPendingUpload}
                  disabled={isUploading}
                >
                  Choose a different file
                </button>
              </div>
            )}
          </div>
        )}
        {imageTab === "url" && (
          <div className="pretext-plus-editor__am-url-form">
            <label className="pretext-plus-editor__dialog-label" htmlFor="am-url-value">Image URL</label>
            <input
              id="am-url-value"
              type="url"
              className="pretext-plus-editor__am-input"
              placeholder="https://example.com/image.png"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              disabled={isAddingUrl}
              autoFocus
            />
            <label className="pretext-plus-editor__dialog-label" htmlFor="am-url-title">
              Title <span className="pretext-plus-editor__dialog-helper-copy">(optional)</span>
            </label>
            <input
              id="am-url-title"
              type="text"
              className="pretext-plus-editor__am-input"
              placeholder="My image"
              value={urlTitle}
              onChange={(e) => setUrlTitle(e.target.value)}
              disabled={isAddingUrl}
            />
            {urlError && <p className="pretext-plus-editor__am-error">{urlError}</p>}
            {urlValue.trim() && (
              <img
                src={urlValue.trim()}
                alt="Preview"
                className="pretext-plus-editor__am-url-preview"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );

  // ── Footer "Add to Project" actions for the image sub-tabs ─────────────────
  // Rendered in the dialog's shared footer (next to Close/Cancel) rather than
  // inline, so both the URL and Upload flows commit from the same place once
  // the user has previewed what they're adding.
  const renderUrlAddAction = () => (
    <button
      type="button"
      className="pretext-plus-editor__dialog-button"
      onClick={handleUrlInsert}
      disabled={!urlValue.trim() || isAddingUrl}
    >
      {isAddingUrl ? "Adding…" : onFetchUrl && onUpload ? "Add to Project" : "Add"}
    </button>
  );

  const renderUploadAddAction = () => (
    <button
      type="button"
      className="pretext-plus-editor__dialog-button"
      onClick={handleUploadConfirm}
      disabled={!pendingUploadFile || isUploading}
    >
      {isUploading ? "Uploading…" : "Add to Project"}
    </button>
  );

  const renderDoenetAdd = (showBack: boolean) => (
    <div className="pretext-plus-editor__am-configure">
      {showBack && (
        <button type="button" className="pretext-plus-editor__am-back-btn" onClick={() => setAddKind(null)}>
          ← Back
        </button>
      )}
      <div className="pretext-plus-editor__am-configure-body">
        <div className="pretext-plus-editor__am-create-form">
            <label className="pretext-plus-editor__dialog-label" htmlFor="am-doenet-title">Title</label>
            <input
              id="am-doenet-title"
              type="text"
              className="pretext-plus-editor__am-input"
              placeholder="My Activity"
              value={doenetTitle}
              onChange={(e) => setDoenetTitle(e.target.value)}
              disabled={isCreatingDoenet}
              autoFocus
            />
            <label className="pretext-plus-editor__dialog-label" htmlFor="am-doenet-ref">Id</label>
            <input
              id="am-doenet-ref"
              type="text"
              className="pretext-plus-editor__am-input"
              placeholder="my-activity"
              value={doenetRef}
              onChange={(e) => setDoenetRef(e.target.value)}
              disabled={isCreatingDoenet}
            />
            <p className="pretext-plus-editor__dialog-helper-copy">
              The id is used in the embed code: <code>{embedFor("doenet", doenetRef || "my-activity")}</code>
            </p>
            {doenetError && <p className="pretext-plus-editor__am-error">{doenetError}</p>}
            <button
              type="button"
              className="pretext-plus-editor__dialog-button"
              onClick={handleCreateDoenet}
              disabled={!doenetTitle.trim() || !doenetRef.trim() || isCreatingDoenet}
            >
              {isCreatingDoenet ? "Creating…" : onCreateDoenet ? "Create" : "Add"}
            </button>
        </div>
      </div>
    </div>
  );

  // ── Source-picker mode (resolve / replace): go straight to the picker ──────
  const renderSourcePickerMode = (kind: AssetKind, title: string, hint: ReactNode) => (
    <>
      <div className="pretext-plus-editor__dialog-header">
        <h2 className="pretext-plus-editor__dialog-title">{title}</h2>
        <button
          type="button"
          className="pretext-plus-editor__dialog-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="pretext-plus-editor__dialog-content pretext-plus-editor__dialog-content--single">
        <p className="pretext-plus-editor__dialog-helper-copy pretext-plus-editor__am-resolve-hint">
          {hint}
        </p>
        {kind === "doenet" ? renderDoenetAdd(false) : renderImageAdd(false)}
      </div>
      <div className="pretext-plus-editor__dialog-actions">
        <button
          type="button"
          className="pretext-plus-editor__dialog-button pretext-plus-editor__dialog-button--secondary"
          onClick={onClose}
        >
          Cancel
        </button>
        {kind === "image" && imageTab === "url" && renderUrlAddAction()}
        {kind === "image" && imageTab === "upload" && onUpload && renderUploadAddAction()}
      </div>
    </>
  );

  const renderResolveMode = (target: { kind: AssetKind; ref: string }) =>
    renderSourcePickerMode(
      target.kind,
      "Link asset",
      <>
        The reference <code>{target.ref}</code> has no asset yet. Choose or create one — the
        reference in your document will be updated to match.
      </>,
    );

  const renderReplaceMode = (target: Asset) =>
    renderSourcePickerMode(
      target.kind,
      "Replace asset",
      <>
        Choose or upload a new asset to replace <code>{target.title}</code>. Every place
        it’s used in your document will show the new asset.
      </>,
    );

  return (
    <div
      className="pretext-plus-editor__dialog-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="pretext-plus-editor__dialog pretext-plus-editor__dialog--asset-manager"
        role="dialog"
        aria-modal="true"
        aria-label="Asset manager"
      >
        {resolveTarget ? (
          renderResolveMode(resolveTarget)
        ) : replaceTarget ? (
          renderReplaceMode(replaceTarget)
        ) : (
          <>
            <div className="pretext-plus-editor__dialog-header">
              <h2 className="pretext-plus-editor__dialog-title">Assets</h2>
              <button
                type="button"
                className="pretext-plus-editor__dialog-close"
                onClick={onClose}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {addedAsset ? (
              <div className="pretext-plus-editor__dialog-content pretext-plus-editor__dialog-content--single">
                {renderAddedSuccess(addedAsset)}
              </div>
            ) : (
              <>
                <div className="pretext-plus-editor__dialog-tab-bar">
                  <button
                    type="button"
                    className={`pretext-plus-editor__dialog-tab${tab === "in-document" ? " pretext-plus-editor__dialog-tab--active" : ""}`}
                    onClick={() => setTab("in-document")}
                  >
                    Assets
                    {assetView.length > 0 && (
                      <span className="pretext-plus-editor__asset-tab-count">{assetView.length}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={`pretext-plus-editor__dialog-tab${tab === "add" ? " pretext-plus-editor__dialog-tab--active" : ""}`}
                    onClick={() => { setTab("add"); setAddKind(null); }}
                  >
                    Add Asset
                  </button>
                </div>

                <div className="pretext-plus-editor__dialog-content pretext-plus-editor__dialog-content--single">
                  {tab === "in-document"
                    ? renderInDocument()
                    : addKind === null
                      ? renderKindPicker()
                      : addKind === "image"
                        ? renderImageAdd(true)
                        : renderDoenetAdd(true)}
                </div>
              </>
            )}

            <div className="pretext-plus-editor__dialog-actions">
              <button
                type="button"
                className="pretext-plus-editor__dialog-button pretext-plus-editor__dialog-button--secondary"
                onClick={onClose}
              >
                Close
              </button>
              {!addedAsset && tab === "add" && addKind === "image" && imageTab === "url" && renderUrlAddAction()}
              {!addedAsset && tab === "add" && addKind === "image" && imageTab === "upload" && onUpload && renderUploadAddAction()}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AssetManagerModal;
