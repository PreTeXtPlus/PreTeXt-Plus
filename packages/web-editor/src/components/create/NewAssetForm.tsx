import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import type { Asset, GeneratorId } from "../../types/editor";
import { generatorIds, generators } from "../../generators";
import { sanitizeXmlId, slugifyTitle, uniqueRef } from "../../sectionUtils";
import { useTakenRefs } from "../../store/hooks";
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
  /** Prefills the title. */
  initialTitle?: string;
  /** The unlinked placeholder ref this asset will bind: prefills the Reference ID. */
  resolveRef?: string;
  /**
   * Upload an image file; the host returns the created asset. `title` is the
   * human-readable title the author entered — distinct from `file.name` — and
   * `ref` the Reference ID, omitted when replacing, whose asset keeps its own.
   */
  onUpload?: (file: File, title?: string, ref?: string) => Promise<Asset>;
  /**
   * Fetch an external URL on the author's behalf and return its bytes, which
   * are then committed through `onUpload` — one code path creates files.
   */
  onFetchUrl?: (url: string) => Promise<File>;
  /** Create an authored asset (no file) under `ref`. */
  onCreateAuthored?: (title: string, ref?: string) => Promise<Asset>;
  /**
   * Create a generated asset for `generator` — one tab per registry entry
   * (PreFigure, …), under `ref`. The host persists the generator's starter
   * source; the diagram is written in the editor next.
   */
  onCreateGenerated?: (generator: GeneratorId, title: string, ref?: string) => Promise<Asset>;
  /** The asset now exists — see `NewItemPane`. */
  onCreated: (asset: Asset) => void;
  onCancel: () => void;  /** Told when a request to the host starts and settles. */
  onBusyChange?: (busy: boolean) => void;
}

type SourceTab = "upload" | "url" | "authored" | GeneratorId;

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

/** A readable title from a filename: `stop-sign_v2.png` is "Stop sign v2". */
function titleFromFilename(name: string): string {
  const words = name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** {@link titleFromFilename} for a URL's last path segment; `""` if it has none. */
function titleFromUrl(url: string): string {
  try {
    const segment = new URL(url).pathname.split("/").pop() ?? "";
    return titleFromFilename(decodeURIComponent(segment));
  } catch {
    return "";
  }
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
  resolveRef,
  onUpload,
  onFetchUrl,
  onCreateAuthored,
  onCreateGenerated,
  onCreated,
  onCancel,
  onBusyChange,
}: NewAssetFormProps) => {
  const canAuthor = !!onCreateAuthored && !isReplace;
  const generatorTabs = onCreateGenerated && !isReplace ? generatorIds : [];
  const [tab, setTab] = useState<SourceTab>(
    onUpload ? "upload" : canAuthor ? "authored" : "url",
  );
  const generatorTab = generatorTabs.find((id) => id === tab);
  // The title and ref are suggested until the author edits them, and theirs
  // from then on, even blank: `null` means "still following the suggestion".
  const [editedTitle, setEditedTitle] = useState<string | null>(initialTitle || null);
  const [editedRef, setEditedRef] = useState<string | null>(resolveRef ?? null);
  const takenRefs = useTakenRefs();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const fieldId = useId();

  useEffect(() => {
    onBusyChange?.(isBusy);
  }, [isBusy, onBusyChange]);

  // A picked file is held for preview until the author confirms.
  const [file, setFile] = useState<File | null>(null);
  const [fileTitle, setFileTitle] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [url, setUrl] = useState("");

  const pickFile = (picked: File, pickedTitle = titleFromFilename(picked.name)) => {
    setError(null);
    setFile(picked);
    setFileTitle(pickedTitle);
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

  const trimmedUrl = url.trim();
  const suggestedTitle =
    tab === "upload" ? fileTitle : tab === "url" ? titleFromUrl(trimmedUrl) : "";
  const title = editedTitle ?? suggestedTitle;
  const trimmedTitle = title.trim();
  const suggestedRef = trimmedTitle
    ? uniqueRef(slugifyTitle(trimmedTitle) || "asset", takenRefs)
    : "";
  const ref = editedRef ?? suggestedRef;

  const canSubmit =
    !isBusy &&
    (tab === "upload"
      ? !!file
      : tab === "url"
        ? !!trimmedUrl
        : !!trimmedTitle);
  const isSourceTab = tab === "authored" || !!generatorTab;

  const handleSubmit = () => {
    if (!canSubmit) return;
    // A replacement takes over the old asset's ref, so it names none of its own.
    let newRef: string | undefined;
    if (!isReplace) {
      newRef = sanitizeXmlId(ref);
      if (!newRef) {
        setError("Reference ID can't be empty.");
        return;
      }
      if (takenRefs.has(newRef)) {
        setError(`Reference ID "${newRef}" is already in use. Choose a unique Reference ID.`);
        return;
      }
    }
    if (tab === "upload" && file && onUpload) {
      void run(() => onUpload(file, trimmedTitle || file.name, newRef), "Upload failed.");
    } else if (tab === "url") {
      if (onFetchUrl && onUpload) {
        void run(
          async () => onUpload(await onFetchUrl(trimmedUrl), trimmedTitle || undefined, newRef),
          "Failed to add URL.",
        );
      } else {
        onCreated({
          id: localAssetId("url"),
          title: trimmedTitle || trimmedUrl,
          ref: newRef ?? (trimmedUrl.split("/").pop() || "image"),
          url: trimmedUrl,
        });
      }
    } else if (tab === "authored" && onCreateAuthored) {
      void run(() => onCreateAuthored(trimmedTitle, newRef), "Failed to create asset.");
    } else if (generatorTab && onCreateGenerated) {
      void run(() => onCreateGenerated(generatorTab, trimmedTitle, newRef), "Failed to create asset.");
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
        {generatorTabs.map((id) => (
          <DialogTab key={id} active={tab === id} onClick={() => setTab(id)}>
            {generators[id].label}
          </DialogTab>
        ))}
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
            isSourceTab ? "My Diagram" : file?.name ?? "My image"
          }
          value={title}
          onChange={(e) => setEditedTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
          disabled={isBusy}
          autoFocus={isSourceTab}
        />
        <SettingsNote>
          {generatorTab ? (
            <>
              You'll write the{" "}
              {generators[generatorTab].label} diagram in the editor next, and
              its picture is rendered and stored as you work.
            </>
          ) : tab === "authored" ? (
            <>
              You'll write the
              asset's PreTeXt content (e.g. <code>{"<latex-image>"}</code>) in
              the editor next.
            </>
          ) : (
            "Optional."
          )}
        </SettingsNote>
      </SettingsField>

      {!isReplace && (
        <SettingsField label="Reference ID" htmlFor={`${fieldId}-ref`}>
          <input
            id={`${fieldId}-ref`}
            type="text"
            className={clsx(FIELD_CONTROL_CLASSES, "font-mono")}
            placeholder="my-image"
            value={ref}
            onChange={(e) => setEditedRef(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            disabled={isBusy}
          />
        </SettingsField>
      )}

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
            onClick={() => { setFile(null); setFileTitle(""); setPreviewUrl(null); }}
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
