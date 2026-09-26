import { useState } from "react";
import type { Asset, SourceFormat } from "../../types/editor";
import { assetEmbedCode, sanitizeXmlId } from "../../sectionUtils";
import { buildProjectAssetView } from "../../assetView";
import { useEditorStore } from "../../store/hooks";
import {
  CommitField,
  EmbedCode,
  SettingsActions,
  SettingsField,
  SettingsNote,
  type SettingsAction,
} from "./settingsUi";

export interface AssetSettingsProps {
  asset: Asset;
  /** Default format for the embed-code picker — the root division's. */
  embedFormat: SourceFormat;
  /**
   * Persist a metadata edit (title, ref, short description). `prevRef` is the
   * ref before the edit, so the caller can rewrite placeholders when it
   * changed. Rejects with the host's error, which the field shows.
   */
  onSave: (asset: Asset, prevRef: string) => Promise<void>;
  /** Start replacing the asset's file (the asset manager's replace flow). Hidden when omitted. */
  onReplace?: (asset: Asset) => void;
  readOnly?: boolean;
}

/**
 * An asset's settings: its preview, title, id, alt text, the embed code, and
 * the project-level actions. Its PreTeXt source is the code editor itself.
 */
const AssetSettings = ({
  asset,
  embedFormat,
  onSave,
  onReplace,
  readOnly,
}: AssetSettingsProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const projectAssets = useEditorStore((s) => s.projectAssets) ?? [];
  const hasAssetDuplicate = useEditorStore((s) => s.hasAssetDuplicate);
  const duplicateAsset = useEditorStore((s) => s.duplicateAsset);
  const removeAsset = useEditorStore((s) => s.removeAsset);
  const removeAssetRefFromDocument = useEditorStore(
    (s) => s.removeAssetRefFromDocument,
  );
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ref = asset.ref ?? "";
  const row = buildProjectAssetView(divisions, projectAssets).find(
    (r) => r.ref === ref,
  );
  const inDocument = row?.inDocument ?? false;

  const commitTitle = async (next: string) => {
    await onSave({ ...asset, title: next.trim() || ref }, ref);
  };

  const commitRef = async (next: string): Promise<string | void> => {
    const nextRef = sanitizeXmlId(next);
    if (!nextRef) {
      return "The id can't be empty — it identifies the asset and is used by every embed of it.";
    }
    if (nextRef === ref) return;
    // A ref must stay unique project-wide: it's the key every
    // `<plus:image ref="..."/>` placeholder resolves against.
    if (projectAssets.some((a) => a.ref === nextRef)) {
      return `"${nextRef}" is already used by another asset. Choose a unique id.`;
    }
    await onSave({ ...asset, ref: nextRef }, ref);
  };

  const commitShortDescription = async (next: string) => {
    await onSave({ ...asset, shortDescription: next.trim() || undefined }, ref);
  };

  const handleDuplicate = async () => {
    setError(null);
    setIsDuplicating(true);
    try {
      // On success the copy is opened, which unmounts this panel.
      await duplicateAsset(asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate asset.");
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleRemove = () => {
    // Removing the asset alone would leave its placeholders behind (the row
    // would just reappear as "needs asset"), so also strip every
    // `<plus:image ref/>` for it — mirroring how deleting a division removes
    // its references too.
    if (
      !window.confirm(
        inDocument
          ? `Remove "${asset.title}" from the project? This also deletes its references from the document.`
          : `Remove "${asset.title}" from the project?`,
      )
    ) {
      return;
    }
    removeAsset(asset);
    removeAssetRefFromDocument(ref);
  };

  const actions: SettingsAction[] = readOnly
    ? []
    : [
      ...(onReplace && asset.url
        ? [
          {
            label: "Replace image…",
            onClick: () => onReplace(asset),
            title: "Choose or upload a different image to use here",
          },
        ]
        : []),
      // Duplicate re-fetches the file's bytes and re-uploads them, so it means
      // nothing for an authored asset with no file behind it.
      ...(hasAssetDuplicate && asset.url
        ? [
          {
            label: isDuplicating ? "Duplicating…" : "Duplicate",
            onClick: handleDuplicate,
            disabled: isDuplicating,
            title: "Create a copy of this asset under a new id",
          },
        ]
        : []),
      { label: "Remove from project", onClick: handleRemove, danger: true },
    ];

  const shortDescription = asset.shortDescription ?? "";

  return (
    <div className="flex flex-col gap-2.5">
      {asset.url && (
        <div className="flex items-start gap-3">
          <img
            src={asset.url}
            alt={shortDescription || asset.title}
            className="max-w-[180px] max-h-[120px] object-contain border border-slate-200 rounded bg-slate-50"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          {asset.contentType && (
            <span className="text-[0.72rem] text-slate-400 font-mono">
              {asset.contentType}
            </span>
          )}
        </div>
      )}
      <SettingsField label="Title" htmlFor="asset-settings-title">
        <CommitField
          id="asset-settings-title"
          value={asset.title}
          onCommit={commitTitle}
          disabled={readOnly}
        />
      </SettingsField>
      <SettingsField label="Id" htmlFor="asset-settings-ref">
        <CommitField
          id="asset-settings-ref"
          value={ref}
          onCommit={commitRef}
          disabled={readOnly}
          mono
        />
        <SettingsNote>
          Used in the embed code. Changing it updates every reference to this
          asset already in your document.
        </SettingsNote>
      </SettingsField>
      <SettingsField
        label="Short description"
        htmlFor="asset-settings-short-description"
      >
        <CommitField
          id="asset-settings-short-description"
          value={shortDescription}
          onCommit={commitShortDescription}
          disabled={readOnly}
          placeholder="Alt text"
        />
        {shortDescription.trim() ? (
          <SettingsNote>
            A brief plaintext description of the image for accessibility,
            inserted as a PreTeXt <code>&lt;shortdescription/&gt;</code>.
          </SettingsNote>
        ) : (
          <SettingsNote tone="warning">
            ⚠ A short description is required for accessibility.
          </SettingsNote>
        )}
      </SettingsField>
      <EmbedCode
        codeFor={(format) => assetEmbedCode(ref, format)}
        defaultFormat={embedFormat}
      />
      <SettingsNote>
        {asset.isFile ? (
          <>
            The editor holds additional PreTeXt source, inserted verbatim inside
            the generated <code>{"<image>"}</code> element — e.g.{" "}
            <code>{"<description>…</description>"}</code>.
          </>
        ) : (
          <>
            The editor holds the PreTeXt this asset resolves to, inserted
            verbatim inside the generated <code>{"<image>"}</code> element —
            e.g. <code>{"<latex-image>…</latex-image>"}</code>.
          </>
        )}
      </SettingsNote>
      {error && <SettingsNote tone="error">{error}</SettingsNote>}
      <SettingsActions actions={actions} />
    </div>
  );
};

export default AssetSettings;
