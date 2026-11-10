import { useState } from "react";
import type { Asset, SourceFormat } from "../../types/editor";
import { assetEmbedCode, sanitizeXmlId } from "../../sectionUtils";
import { buildProjectAssetView } from "../../assetView";
import { generatorFor } from "../../generators";
import { useEditorStore, useTakenRefs } from "../../store/hooks";
import { ID_REQUIRED_MESSAGE, idTakenMessage } from "../../idRules";
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
  /** Start replacing the asset's file (the "Replace asset" form). Hidden when omitted. */
  onReplace?: (asset: Asset) => void;
  readOnly?: boolean;
}

/**
 * An asset's settings: its title, id, alt text, the embed code, and the
 * project-level actions. Its PreTeXt source is the code editor itself, and its
 * image is shown in the preview panel (see `AssetPreview`).
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
  const takenRefs = useTakenRefs();
  const hasAssetDuplicate = useEditorStore((s) => s.hasAssetDuplicate);
  const duplicateAsset = useEditorStore((s) => s.duplicateAsset);
  const removeAsset = useEditorStore((s) => s.removeAsset);
  const removeAssetRefFromDocument = useEditorStore(
    (s) => s.removeAssetRefFromDocument,
  );
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ref = asset.ref ?? "";
  const generator = generatorFor(asset.sourceFormat);
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
      return ID_REQUIRED_MESSAGE;
    }
    if (nextRef === ref) return;
    // A ref must stay unique project-wide: it's the key every
    // `<plus:image ref="..."/>` placeholder resolves against.
    if (takenRefs.has(nextRef)) {
      return idTakenMessage(nextRef);
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
      setError(err instanceof Error ? err.message : "Failed to duplicate image.");
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
          ? `Remove "${asset.title}" from the project? It will also be taken out of every place the document uses it.`
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
      // A generated asset's picture is its source, so replacing or duplicating the
      // bytes means nothing for it: edit the diagram instead.
      ...(onReplace && asset.url && !generator
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
      ...(hasAssetDuplicate && asset.url && !generator
        ? [
          {
            label: isDuplicating ? "Duplicating…" : "Duplicate",
            onClick: handleDuplicate,
            disabled: isDuplicating,
            title: "Make a copy of this image with a new ID",
          },
        ]
        : []),
      { label: "Remove from project", onClick: handleRemove, danger: true },
    ];

  const shortDescription = asset.shortDescription ?? "";

  return (
    <div className="flex flex-col gap-2.5">
      <SettingsField label="Title" htmlFor="asset-settings-title">
        <CommitField
          id="asset-settings-title"
          placeholder="My image"
          value={asset.title}
          onCommit={commitTitle}
          disabled={readOnly}
        />
      </SettingsField>
      <SettingsField label="ID" htmlFor="asset-settings-ref">
        <CommitField
          id="asset-settings-ref"
          placeholder="my-image"
          value={ref}
          onCommit={commitRef}
          disabled={readOnly}
          mono
        />
      </SettingsField>
      <SettingsField
        label="Alt text"
        htmlFor="asset-settings-short-description"
      >
        <CommitField
          id="asset-settings-short-description"
          value={shortDescription}
          onCommit={commitShortDescription}
          disabled={readOnly}
          placeholder="A short description of the image"
        />
        {shortDescription.trim() ? (
          <SettingsNote>
            Describes the image for readers who can't see it.
          </SettingsNote>
        ) : (
          <SettingsNote tone="warning">
            ⚠ Alt text is required, for readers who can't see the image.
          </SettingsNote>
        )}
      </SettingsField>
      <EmbedCode
        codeFor={(format) => assetEmbedCode(ref, format)}
        defaultFormat={embedFormat}
      />
      {generator && (
        <SettingsField label="Made with">
          <div data-testid="asset-settings-generator" className="text-[0.85rem] text-slate-700">
            {generator.label}
          </div>
        </SettingsField>
      )}
      {!generator && (
        <SettingsNote>
          {asset.isFile ? (
            <>
              Optional: the editor below can hold extra PreTeXt for this image,
              like a <code>{"<description>"}</code>.
            </>
          ) : (
            <>
              Write this image's PreTeXt in the editor below, like a{" "}
              <code>{"<latex-image>"}</code>.
            </>
          )}
        </SettingsNote>
      )}
      {error && <SettingsNote tone="error">{error}</SettingsNote>}
      <SettingsActions actions={actions} />
    </div>
  );
};

export default AssetSettings;
