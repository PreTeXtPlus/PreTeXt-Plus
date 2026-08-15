import { useState, useEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";
import type { Asset, AssetKind } from "../types/editor";
import { useEditorStore } from "../store/hooks";
import { assetEmbedCode } from "../sectionUtils";
import { buildProjectAssetView, type AssetRow } from "../assetView";
import { ASSET_KIND_LABELS, SHOW_DOENET, VISIBLE_ASSET_KINDS } from "../assetKinds";
import {
  DialogOverlay,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogTabBar,
  DialogTab,
  DialogContent,
  DialogLabel,
  DialogHelperCopy,
  DialogFileInput,
  DialogActions,
  DialogButton,
} from "./Dialog";
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
  // user is handed off to the standalone asset editor -- same as opening an
  // existing row (AssetManagerModal's own onOpen, below) -- so they can set
  // its title/short description right away instead of stopping at a
  // confirmation screen.
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
    if (asset.ref) {
      navigator.clipboard.writeText(embedFor(asset.kind, asset.ref)).catch(() => {});
      openAssetEditor(asset.kind, asset.ref);
    }
    onClose();
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
        <div className="flex flex-col items-center justify-center min-h-[200px] gap-4 text-slate-500 text-[0.9rem] text-center">
          <p>No assets in this project yet.</p>
          <DialogButton onClick={() => { setTab("add"); setAddKind(null); }}>
            Add an asset
          </DialogButton>
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
        <li
          key={ck}
          data-testid="am-doc-row"
          className="flex items-center justify-between gap-2 py-[0.45rem] px-2 rounded hover:bg-slate-50"
        >
          <button
            type="button"
            data-testid="am-row-info-btn"
            className="group flex-1 min-w-0 flex flex-row items-center gap-2 overflow-hidden text-left bg-transparent border-none p-0 cursor-pointer"
            onClick={onOpen}
            title={row.status === "unlinked" ? "No asset for this reference — click to link or create one" : "Manage asset"}
          >
            {(row.asset?.thumbnailUrl ?? row.asset?.url) && (
              <img
                className="shrink-0 w-8 h-8 rounded object-cover bg-slate-100 border border-slate-200"
                src={row.asset?.thumbnailUrl ?? row.asset?.url}
                alt=""
              />
            )}
            <span className="flex flex-col gap-0.5 min-w-0 overflow-hidden">
              <span className="text-sm text-slate-900 whitespace-nowrap overflow-hidden text-ellipsis group-hover:underline">
                {row.asset?.title ?? row.ref}
              </span>
              <span className="text-[0.72rem] text-slate-400 font-mono whitespace-nowrap overflow-hidden text-ellipsis">
                {row.ref}
                {row.asset?.contentType && ` · ${row.asset.contentType}`}
              </span>
            </span>
          </button>
          {row.status === "unlinked" && (
            <span
              className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-[0.04em] whitespace-nowrap rounded-full py-px px-[7px] text-amber-800 bg-amber-100"
              title="No asset for this reference"
            >
              needs asset
            </span>
          )}
          {row.status === "unused" && (
            <span
              className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-[0.04em] whitespace-nowrap rounded-full py-px px-[7px] text-slate-600 bg-slate-200"
              title="Not referenced in the document yet"
            >
              not placed
            </span>
          )}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              className="text-[0.75rem] py-0.5 px-2 border border-slate-300 rounded bg-white text-slate-700 cursor-pointer leading-[1.5] whitespace-nowrap transition-colors duration-100 hover:bg-slate-100 hover:border-slate-400"
              onClick={onOpen}
            >
              {row.status === "unlinked" ? "Link / create" : "Manage"}
            </button>
            <button
              type="button"
              className={clsx(
                "text-[0.75rem] py-0.5 px-2 border rounded cursor-pointer leading-[1.5] whitespace-nowrap transition-colors duration-100",
                copiedKey === ck
                  ? "text-emerald-600 border-emerald-300 bg-emerald-50"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 hover:border-slate-400",
              )}
              onClick={() => handleCopy(row.kind, row.ref)}
              title={`Copy ${embedFor(row.kind, row.ref)}`}
            >
              {copiedKey === ck ? "Copied!" : "Copy embed code"}
            </button>
            {onDuplicateAsset && row.asset?.url && (
              <button
                type="button"
                className="text-[0.75rem] py-0.5 px-2 border border-slate-300 rounded bg-white text-slate-700 cursor-pointer leading-[1.5] whitespace-nowrap transition-colors duration-100 hover:bg-slate-100 hover:border-slate-400"
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
                className="text-[0.75rem] py-0.5 px-2 border rounded cursor-pointer leading-[1.5] whitespace-nowrap transition-colors duration-100 text-red-700 border-red-300 bg-white hover:bg-red-50 hover:border-red-400"
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
      <div className="p-1">
        {byKind.map(({ kind, rows }) => (
          <div key={kind} className="mb-2">
            <div className="flex items-center gap-[0.35rem] pt-[0.4rem] px-2 pb-1 text-[0.72rem] font-semibold text-slate-600 uppercase tracking-[0.05em] border-b border-slate-200">
              <span aria-hidden="true">📁</span>
              <span>{ASSET_KIND_LABELS[kind]}</span>
              <span className="inline-flex items-center justify-center text-[0.65rem] font-bold text-slate-600 bg-slate-200 rounded-full px-[5px] min-w-[16px] leading-[1.4]">
                {rows.length}
              </span>
            </div>
            <ul className="list-none m-0 p-0">{rows.map(renderRow)}</ul>
          </div>
        ))}
      </div>
    );
  };

  // ── "Add Asset" tab ────────────────────────────────────────────────────────
  const kindCardClasses =
    "flex flex-col items-center gap-[0.4rem] py-6 px-8 bg-white border-2 border-slate-200 rounded-lg cursor-pointer min-w-[130px] text-center transition-[border-color,box-shadow] duration-150 hover:border-[#0e639c] hover:shadow-[0_0_0_3px_rgba(14,99,156,0.12)]";

  const renderKindPicker = () => (
    <div className="flex flex-col items-center justify-center min-h-[220px] gap-6 py-6 px-4 [@media(max-height:600px)]:min-h-0 [@media(max-height:600px)]:py-4 [@media(max-height:600px)]:px-2">
      <p className="m-0 text-base font-medium text-slate-700">What kind of asset?</p>
      <div className="flex gap-4">
        <button
          type="button"
          className={kindCardClasses}
          onClick={() => { setAddKind("image"); setImageTab(onUpload ? "upload" : "url"); }}
        >
          <span className="text-[2rem] leading-none" aria-hidden="true">🖼️</span>
          <span className="text-base font-semibold text-slate-900">Image</span>
          <span className="text-[0.78rem] text-slate-500">PNG, JPEG, SVG, etc.</span>
        </button>
        {SHOW_DOENET && (
          <button
            type="button"
            className={kindCardClasses}
            onClick={() => setAddKind("doenet")}
          >
            <span className="text-[2rem] leading-none" aria-hidden="true"><img src={doenetLogo} alt="Doenet" /></span>
            <span className="text-base font-semibold text-slate-900">Doenet</span>
            <span className="text-[0.78rem] text-slate-500">Interactive activity</span>
          </button>
        )}
        {!SHOW_DOENET && (
          <div
            className="flex flex-col items-center gap-[0.4rem] py-6 px-8 border-2 border-dashed border-slate-200 rounded-lg cursor-default min-w-[130px] text-center opacity-70 bg-slate-50 hover:shadow-none"
            aria-disabled="true"
          >
            <span className="text-[2rem] leading-none" aria-hidden="true">✨</span>
            <span className="text-base font-semibold text-slate-900">More coming soon</span>
            <span className="text-[0.78rem] text-slate-500">Interactive activities and more</span>
          </div>
        )}
      </div>
    </div>
  );

  const renderImageAdd = (showBack: boolean) => (
    <div className="flex flex-col min-h-0">
      {showBack && (
        <button
          type="button"
          className="text-[0.8rem] text-slate-600 bg-transparent border-none cursor-pointer py-[0.35rem] px-2 rounded w-fit mt-1 mx-1 hover:bg-slate-100 hover:text-slate-900"
          onClick={() => setAddKind(null)}
        >
          ← Back
        </button>
      )}
      <DialogTabBar className="border-b-slate-200 pl-1">
        {onUpload && (
          <DialogTab
            active={imageTab === "upload"}
            onClick={() => setImageTab("upload")}
          >
            Upload
          </DialogTab>
        )}
        <DialogTab active={imageTab === "url"} onClick={() => setImageTab("url")}>
          External URL
        </DialogTab>
      </DialogTabBar>
      <div className="p-1">
        {imageTab === "upload" && onUpload && (
          <div className="flex flex-col gap-3">
            {!pendingUploadFile ? (
              <div
                className={clsx(
                  "min-h-[160px] flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-md cursor-pointer py-8 px-4 outline-none transition-[border-color,background-color] duration-150 [@media(max-height:600px)]:min-h-[110px] [@media(max-height:600px)]:py-5 [@media(max-height:600px)]:px-4",
                  isDragging
                    ? "border-[#0e639c] bg-sky-100"
                    : "border-slate-300 bg-slate-50 hover:border-[#0e639c] hover:bg-sky-50 focus-visible:border-[#0e639c] focus-visible:bg-sky-50",
                )}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) selectPendingUpload(f); }}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
                aria-label="Paste an image, drag and drop to upload, or click to browse files"
              >
                <DialogFileInput
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) selectPendingUpload(f); }}
                />
                <span className="text-[2.5rem] text-slate-400 leading-none" aria-hidden="true">↑</span>
                <p className="m-0 text-slate-600 text-[0.95rem] font-medium text-center">
                  Paste your image, drag &amp; drop a file, or click to browse
                </p>
                <DialogHelperCopy as="p">PNG, JPEG, GIF, SVG, WebP</DialogHelperCopy>
              </div>
            ) : (
              <div className="flex flex-col gap-2 pt-1 px-1 pb-2 max-w-[420px]">
                <img
                  src={pendingUploadPreviewUrl ?? undefined}
                  alt="Preview"
                  className="max-w-full max-h-[140px] object-contain border border-slate-200 rounded bg-slate-50 mt-1"
                />
                <DialogLabel htmlFor="am-upload-title">
                  Title <DialogHelperCopy>(optional)</DialogHelperCopy>
                </DialogLabel>
                <input
                  id="am-upload-title"
                  type="text"
                  className="text-[0.9rem] border border-slate-300 rounded py-1.5 px-2.5 bg-white outline-none text-slate-900 w-full focus:border-[#0e639c] focus:shadow-[0_0_0_2px_rgba(14,99,156,0.15)]"
                  placeholder={pendingUploadFile.name}
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  disabled={isUploading}
                  autoFocus
                />
                {uploadError && (
                  <p className="m-0 py-[0.4rem] px-[0.6rem] bg-[#fde8e8] text-red-700 rounded text-[0.83rem]">
                    {uploadError}
                  </p>
                )}
                <DialogButton
                  variant="secondary"
                  onClick={clearPendingUpload}
                  disabled={isUploading}
                >
                  Choose a different file
                </DialogButton>
              </div>
            )}
          </div>
        )}
        {imageTab === "url" && (
          <div className="flex flex-col gap-2 pt-1 px-1 pb-2 max-w-[420px]">
            <DialogLabel htmlFor="am-url-value">Image URL</DialogLabel>
            <input
              id="am-url-value"
              type="url"
              className="text-[0.9rem] border border-slate-300 rounded py-1.5 px-2.5 bg-white outline-none text-slate-900 w-full focus:border-[#0e639c] focus:shadow-[0_0_0_2px_rgba(14,99,156,0.15)]"
              placeholder="https://example.com/image.png"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              disabled={isAddingUrl}
              autoFocus
            />
            <DialogLabel htmlFor="am-url-title">
              Title <DialogHelperCopy>(optional)</DialogHelperCopy>
            </DialogLabel>
            <input
              id="am-url-title"
              type="text"
              className="text-[0.9rem] border border-slate-300 rounded py-1.5 px-2.5 bg-white outline-none text-slate-900 w-full focus:border-[#0e639c] focus:shadow-[0_0_0_2px_rgba(14,99,156,0.15)]"
              placeholder="My image"
              value={urlTitle}
              onChange={(e) => setUrlTitle(e.target.value)}
              disabled={isAddingUrl}
            />
            {urlError && (
              <p className="m-0 py-[0.4rem] px-[0.6rem] bg-[#fde8e8] text-red-700 rounded text-[0.83rem]">
                {urlError}
              </p>
            )}
            {urlValue.trim() && (
              <img
                src={urlValue.trim()}
                alt="Preview"
                className="max-w-full max-h-[140px] object-contain border border-slate-200 rounded bg-slate-50 mt-1"
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
    <DialogButton
      onClick={handleUrlInsert}
      disabled={!urlValue.trim() || isAddingUrl}
    >
      {isAddingUrl ? "Adding…" : onFetchUrl && onUpload ? "Add to Project" : "Add"}
    </DialogButton>
  );

  const renderUploadAddAction = () => (
    <DialogButton
      onClick={handleUploadConfirm}
      disabled={!pendingUploadFile || isUploading}
    >
      {isUploading ? "Uploading…" : "Add to Project"}
    </DialogButton>
  );

  const renderDoenetAdd = (showBack: boolean) => (
    <div className="flex flex-col min-h-0">
      {showBack && (
        <button
          type="button"
          className="text-[0.8rem] text-slate-600 bg-transparent border-none cursor-pointer py-[0.35rem] px-2 rounded w-fit mt-1 mx-1 hover:bg-slate-100 hover:text-slate-900"
          onClick={() => setAddKind(null)}
        >
          ← Back
        </button>
      )}
      <div className="p-1">
        <div className="flex flex-col gap-2 pt-1 px-1 pb-2 max-w-[420px]">
            <DialogLabel htmlFor="am-doenet-title">Title</DialogLabel>
            <input
              id="am-doenet-title"
              type="text"
              className="text-[0.9rem] border border-slate-300 rounded py-1.5 px-2.5 bg-white outline-none text-slate-900 w-full focus:border-[#0e639c] focus:shadow-[0_0_0_2px_rgba(14,99,156,0.15)]"
              placeholder="My Activity"
              value={doenetTitle}
              onChange={(e) => setDoenetTitle(e.target.value)}
              disabled={isCreatingDoenet}
              autoFocus
            />
            <DialogLabel htmlFor="am-doenet-ref">Id</DialogLabel>
            <input
              id="am-doenet-ref"
              type="text"
              className="text-[0.9rem] border border-slate-300 rounded py-1.5 px-2.5 bg-white outline-none text-slate-900 w-full focus:border-[#0e639c] focus:shadow-[0_0_0_2px_rgba(14,99,156,0.15)]"
              placeholder="my-activity"
              value={doenetRef}
              onChange={(e) => setDoenetRef(e.target.value)}
              disabled={isCreatingDoenet}
            />
            <DialogHelperCopy as="p">
              The id is used in the embed code: <code>{embedFor("doenet", doenetRef || "my-activity")}</code>
            </DialogHelperCopy>
            {doenetError && (
              <p className="m-0 py-[0.4rem] px-[0.6rem] bg-[#fde8e8] text-red-700 rounded text-[0.83rem]">
                {doenetError}
              </p>
            )}
            <DialogButton
              onClick={handleCreateDoenet}
              disabled={!doenetTitle.trim() || !doenetRef.trim() || isCreatingDoenet}
            >
              {isCreatingDoenet ? "Creating…" : onCreateDoenet ? "Create" : "Add"}
            </DialogButton>
        </div>
      </div>
    </div>
  );

  // ── Source-picker mode (resolve / replace): go straight to the picker ──────
  const renderSourcePickerMode = (kind: AssetKind, title: string, hint: ReactNode) => (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogClose onClick={onClose} aria-label="Close">
          ✕
        </DialogClose>
      </DialogHeader>
      <DialogContent single>
        <DialogHelperCopy as="p" className="pb-2 px-2">
          {hint}
        </DialogHelperCopy>
        {kind === "doenet" ? renderDoenetAdd(false) : renderImageAdd(false)}
      </DialogContent>
      <DialogActions>
        <DialogButton variant="secondary" onClick={onClose}>
          Cancel
        </DialogButton>
        {kind === "image" && imageTab === "url" && renderUrlAddAction()}
        {kind === "image" && imageTab === "upload" && onUpload && renderUploadAddAction()}
      </DialogActions>
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
    <DialogOverlay onClick={(e) => e.target === e.currentTarget && onClose()}>
      <Dialog
        className="w-[min(90%,700px)] h-[min(85%,600px)] [@media(max-height:600px)]:h-[98%]"
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
            <DialogHeader>
              <DialogTitle>Assets</DialogTitle>
              <DialogClose onClick={onClose} aria-label="Close">
                ✕
              </DialogClose>
            </DialogHeader>

            <DialogTabBar>
              <DialogTab
                active={tab === "in-document"}
                onClick={() => setTab("in-document")}
              >
                Assets
                {assetView.length > 0 && (
                  <span className="inline-flex items-center justify-center ml-[5px] text-[0.68rem] font-bold text-slate-600 bg-slate-200 rounded-full px-[5px] min-w-[16px] leading-[1.4]">
                    {assetView.length}
                  </span>
                )}
              </DialogTab>
              <DialogTab
                active={tab === "add"}
                onClick={() => { setTab("add"); setAddKind(null); }}
              >
                Add Asset
              </DialogTab>
            </DialogTabBar>

            <DialogContent single>
              {tab === "in-document"
                ? renderInDocument()
                : addKind === null
                  ? renderKindPicker()
                  : addKind === "image"
                    ? renderImageAdd(true)
                    : renderDoenetAdd(true)}
            </DialogContent>

            <DialogActions>
              <DialogButton variant="secondary" onClick={onClose}>
                Close
              </DialogButton>
              {tab === "add" && addKind === "image" && imageTab === "url" && renderUrlAddAction()}
              {tab === "add" && addKind === "image" && imageTab === "upload" && onUpload && renderUploadAddAction()}
            </DialogActions>
          </>
        )}
      </Dialog>
    </DialogOverlay>
  );
};

export default AssetManagerModal;
