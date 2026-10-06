import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import type { Asset } from "../../types/editor";
import { DialogFileInput, DialogTab, DialogTabBar } from "../Dialog";
import {
  FIELD_CONTROL_CLASSES,
  SettingsButton,
  SettingsField,
  SettingsNote,
} from "../settings/settingsUi";

export interface NewAssetFormProps {
  /**
   * Replacing an existing asset: only a new image can take its place, so the
   * Custom (authored) source is not offered.
   */
  isReplace?: boolean;
  /** Prefills the title, so the host-derived ref is likely to match it. */
  initialTitle?: string;
  /**
   * Upload an image file; the host returns the created asset. `title` is the
   * human-readable title the author entered — distinct from `file.name`.
   */
  onUpload?: (file: File, title?: string) => Promise<Asset>;
  /**
   * Fetch an external URL on the author's behalf and return its bytes, which
   * are then committed through `onUpload` — one code path creates files.
   */
  onFetchUrl?: (url: string) => Promise<File>;
  /** Create an authored asset (no file; the host derives its ref from `title`). */
  onCreateAuthored?: (title: string) => Promise<Asset>;
  /** The asset now exists — see `NewItemPane`. */
  onCreated: (asset: Asset) => void;
  onCancel: () => void;
}

type SourceTab = "upload" | "url" | "authored";

/**
 * A throwaway client-side id for an asset created with no host to mint one
 * (demos and tests). At module scope so its impure `Date.now()` isn't flagged
 * by the React Compiler's purity check for component-body code.
 */
function localAssetId(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

/**
 * Clipboard image files never carry a meaningful filename — browsers hand back
 * either an empty string or a generic "image.png" — so give each a fresh,
 * uniquely-timestamped one.
 */
function namePastedImageFile(file: File): File {
  return new File([file], `pasted-image-${Date.now()}`, { type: file.type });
}

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

/**
 * The creation form for a project asset: an uploaded image, an image fetched
 * from a URL, or a custom (authored) asset whose PreTeXt source is written
 * afterwards in the code editor it opens in.
 */
const NewAssetForm = ({
  isReplace,
  initialTitle = "",
  onUpload,
  onFetchUrl,
  onCreateAuthored,
  onCreated,
  onCancel,
}: NewAssetFormProps) => {
  const canAuthor = !!onCreateAuthored && !isReplace;
  const [tab, setTab] = useState<SourceTab>(
    onUpload ? "upload" : canAuthor ? "authored" : "url",
  );
  const [title, setTitle] = useState(initialTitle);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const fieldId = useId();

  // A picked file is held for preview until the author confirms.
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [url, setUrl] = useState("");

  const pickFile = (picked: File, pickedTitle = picked.name) => {
    setError(null);
    setFile(picked);
    setTitle((t) => t || pickedTitle);
    setPreviewUrl(URL.createObjectURL(picked));
  };

  // Revoke the preview object URL whenever it's replaced or the form unmounts.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Pasting an image anywhere while the form is open stages it for upload.
  useEffect(() => {
    if (!onUpload) return;
    const handlePaste = (e: ClipboardEvent) => {
      for (const item of e.clipboardData?.items ?? []) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const pasted = item.getAsFile();
          if (pasted) {
            e.preventDefault();
            setTab("upload");
            pickFile(namePastedImageFile(pasted), "Pasted Image");
          }
          return;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [onUpload]);

  const run = async (produce: () => Promise<Asset>, fallback: string) => {
    setError(null);
    setIsBusy(true);
    try {
      onCreated(await produce());
    } catch (err) {
      setError(errorMessage(err, fallback));
      setIsBusy(false);
    }
  };

  const trimmedTitle = title.trim();
  const trimmedUrl = url.trim();

  const canSubmit =
    !isBusy &&
    (tab === "upload"
      ? !!file
      : tab === "url"
        ? !!trimmedUrl
        : !!trimmedTitle);

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (tab === "upload" && file && onUpload) {
      void run(() => onUpload(file, trimmedTitle || file.name), "Upload failed.");
    } else if (tab === "url") {
      if (onFetchUrl && onUpload) {
        void run(
          async () => onUpload(await onFetchUrl(trimmedUrl), trimmedTitle || undefined),
          "Failed to add URL.",
        );
      } else {
        onCreated({
          id: localAssetId("url"),
          title: trimmedTitle || trimmedUrl,
          ref: trimmedUrl.split("/").pop() || "image",
          url: trimmedUrl,
        });
      }
    } else if (tab === "authored" && onCreateAuthored) {
      // Only offered when the host can create one (`canAuthor`), since only
      // the host derives an authored asset's ref.
      void run(() => onCreateAuthored(trimmedTitle), "Failed to create asset.");
    }
  };

  const submitLabel = isBusy
    ? tab === "upload"
      ? "Uploading…"
      : "Creating…"
    : isReplace
      ? "Replace"
      : "Create";

  return (
    <div className="flex flex-col gap-3" data-testid="new-asset-form">
      <DialogTabBar className="border-b-slate-200">
        {onUpload && (
          <DialogTab active={tab === "upload"} onClick={() => setTab("upload")}>
            Upload
          </DialogTab>
        )}
        <DialogTab active={tab === "url"} onClick={() => setTab("url")}>
          External URL
        </DialogTab>
        {canAuthor && (
          <DialogTab active={tab === "authored"} onClick={() => setTab("authored")}>
            Custom
          </DialogTab>
        )}
      </DialogTabBar>

      {tab === "upload" && onUpload && (
        file ? (
          <img
            src={previewUrl ?? undefined}
            alt="Preview"
            className="max-w-full max-h-[160px] self-start object-contain border border-slate-200 rounded bg-slate-50"
          />
        ) : (
          <div
            className={clsx(
              "min-h-[140px] flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-md cursor-pointer py-6 px-4 outline-none transition-[border-color,background-color] duration-150",
              isDragging
                ? "border-blue-600 bg-sky-100"
                : "border-slate-300 bg-slate-50 hover:border-blue-600 hover:bg-sky-50 focus-visible:border-blue-600 focus-visible:bg-sky-50",
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const dropped = e.dataTransfer.files[0];
              if (dropped) pickFile(dropped);
            }}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            aria-label="Paste an image, drag and drop to upload, or click to browse files"
          >
            <DialogFileInput
              ref={fileInputRef}
              accept="image/*"
              data-testid="new-asset-file"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) pickFile(picked);
              }}
            />
            <span className="text-[2rem] text-slate-400 leading-none" aria-hidden="true">↑</span>
            <p className="m-0 text-slate-600 text-[0.85rem] font-medium text-center">
              Paste your image, drag &amp; drop a file, or click to browse
            </p>
            <SettingsNote>PNG, JPEG, GIF, SVG, WebP</SettingsNote>
          </div>
        )
      )}

      {tab === "url" && (
        <SettingsField label="Image URL" htmlFor={`${fieldId}-url`}>
          <input
            id={`${fieldId}-url`}
            type="url"
            className={FIELD_CONTROL_CLASSES}
            placeholder="https://example.com/image.png"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isBusy}
            autoFocus
          />
          {trimmedUrl && (
            <img
              src={trimmedUrl}
              alt="Preview"
              className="max-w-full max-h-[140px] self-start object-contain border border-slate-200 rounded bg-slate-50 mt-1"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          )}
        </SettingsField>
      )}

      <SettingsField label="Title" htmlFor={`${fieldId}-title`}>
        <input
          id={`${fieldId}-title`}
          type="text"
          className={FIELD_CONTROL_CLASSES}
          placeholder={
            tab === "authored" ? "My Diagram" : file?.name ?? "My image"
          }
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
          disabled={isBusy}
          autoFocus={tab === "authored"}
        />
        <SettingsNote>
          {tab === "authored" ? (
            <>
              A reference id is generated from the title. You'll write the
              asset's PreTeXt content (e.g. <code>{"<latex-image>"}</code>) in
              the editor next.
            </>
          ) : (
            "Optional. A reference id is generated from the title."
          )}
        </SettingsNote>
      </SettingsField>

      {error && (
        <div role="alert">
          <SettingsNote tone="error">{error}</SettingsNote>
        </div>
      )}

      <div className="flex gap-1.5">
        <SettingsButton variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
          {submitLabel}
        </SettingsButton>
        {tab === "upload" && file && (
          <SettingsButton
            onClick={() => { setFile(null); setPreviewUrl(null); }}
            disabled={isBusy}
          >
            Choose a different file
          </SettingsButton>
        )}
        <SettingsButton onClick={onCancel} disabled={isBusy}>
          Cancel
        </SettingsButton>
      </div>
    </div>
  );
};

export default NewAssetForm;
