import { useState } from "react";
import clsx from "clsx";
import DivisionMenu, { type DivisionMenuItem } from "./DivisionMenu";
import { assetEmbedCode } from "../../sectionUtils";
import { buildProjectAssetView, type AssetRow } from "../../assetView";
import { useEditorStore } from "../../store/hooks";
import { useDivisionActions } from "./useDivisionActions";

export interface AssetListProps {
  onOpenAssetPicker?: (initialTab?: "add") => void;
}

/** The explorer's Assets view: every asset placeholder and project asset, with status. */
const AssetList = ({ onOpenAssetPicker }: AssetListProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const projectAssets = useEditorStore((s) => s.projectAssets) ?? [];
  const openAssetEditor = useEditorStore((s) => s.openAssetEditor);
  const openAssetResolver = useEditorStore((s) => s.openAssetResolver);
  const removeAsset = useEditorStore((s) => s.removeAsset);
  const removeAssetRefFromDocument = useEditorStore((s) => s.removeAssetRefFromDocument);
  const duplicateAsset = useEditorStore((s) => s.duplicateAsset);
  const hasAssetDuplicate = useEditorStore((s) => s.hasAssetDuplicate);
  const { activeFormat } = useDivisionActions();

  // ── Joined asset view — placeholders + project assets, with status ───────
  const assetView = buildProjectAssetView(divisions, projectAssets);

  // The ref of the asset currently being duplicated, so its row can show a
  // spinner. Duplicate re-fetches and re-uploads the bytes (a network
  // round-trip), and unlike the edit modal this sidebar action has no surface
  // of its own to report progress on.
  const [duplicatingRef, setDuplicatingRef] = useState<string | null>(null);

  const handleDuplicateAsset = async (row: AssetRow) => {
    if (!row.asset || duplicatingRef) return;
    setDuplicatingRef(row.ref);
    try {
      await duplicateAsset(row.asset);
    } finally {
      setDuplicatingRef(null);
    }
  };

  // ── Asset row helpers ───────────────────────────────────────────────────────
  const openAssetRow = (row: AssetRow) =>
    row.status === "unlinked"
      ? openAssetResolver(row.ref)
      : openAssetEditor(row.ref);

  const copyAssetEmbed = (ref: string) => {
    navigator.clipboard
      ?.writeText(assetEmbedCode(ref, activeFormat))
      .catch(() => {});
  };

  const assetMenuItems = (row: AssetRow): DivisionMenuItem[] => {
    const items: DivisionMenuItem[] = [
      {
        label: row.status === "unlinked" ? "Link / create asset" : "Manage asset",
        onClick: () => openAssetRow(row),
      },
      {
        label: "Copy embed code",
        onClick: () => copyAssetEmbed(row.ref),
      },
    ];
    if (hasAssetDuplicate && row.asset) {
      items.push({
        label: "Duplicate asset",
        onClick: () => handleDuplicateAsset(row),
      });
    }
    if (row.status === "unlinked") {
      items.push({
        label: "Remove from document",
        onClick: () => removeAssetRefFromDocument(row.ref),
        danger: true,
      });
    } else if (row.asset) {
      items.push({
        label: "Remove from project",
        onClick: () => {
          // Removing the asset alone would leave its placeholders behind (the
          // row would just reappear as "needs asset"), so also strip every
          // `<plus:image ref/>` for it from the document — mirroring how
          // deleting a division also removes its references. Confirm first when
          // it's actually placed, since that edits the source.
          if (
            row.inDocument &&
            !window.confirm(
              `Remove "${row.asset!.title}" from the project? This also deletes its ${
                row.inDocument ? "reference(s)" : "reference"
              } from the document.`,
            )
          ) {
            return;
          }
          removeAsset(row.asset!);
          removeAssetRefFromDocument(row.ref);
        },
        danger: true,
      });
    }
    return items;
  };

  return (
    <>
      <div className="overflow-y-auto flex-1 min-h-0">
        {assetView.length === 0 ? (
          <p className="m-0 py-2 px-3 text-slate-400 text-[0.78rem]">
            No assets in this project yet.{" "}
            {onOpenAssetPicker && (
              <button
                type="button"
                className="bg-transparent border-none text-blue-600 cursor-pointer font-[inherit] text-[0.78rem] p-0 hover:underline"
                onClick={() => onOpenAssetPicker("add")}
              >
                Add one
              </button>
            )}
          </p>
        ) : (
          <div className="flex flex-col">
            <ul className="list-none m-0 pt-0 px-0 pb-1">
              {assetView.map((row) => {
                const isUnlinked = row.status === "unlinked";
                const isMissingShortDescription =
                  row.asset && !row.asset.shortDescription?.trim();
                const isBusy = duplicatingRef === row.ref;
                return (
                  <li
                    key={row.ref}
                    className={clsx(
                      "group flex items-center gap-1.5 py-[3px] pr-1.5 pl-4 min-h-7 hover:bg-[#e8eaf0]",
                      isBusy && "opacity-60 pointer-events-none",
                    )}
                  >
                    {(row.asset?.thumbnailUrl || row.asset?.url) ? (
                      <img
                        src={row.asset?.thumbnailUrl || row.asset.url}
                        className="h-[30px] cursor-pointer"
                        onClick={() => openAssetRow(row)}
                      />
                    ) : (
                      <span
                        className={clsx(
                          "inline-flex items-center justify-center w-[30px] h-[30px] cursor-pointer text-[0.85rem] rounded bg-[#eef2f7] text-slate-400",
                          isUnlinked && "bg-amber-100 text-amber-700",
                        )}
                        onClick={() => openAssetRow(row)}
                        title={row.status === "unlinked" ? "No asset — click to link" : undefined}
                        aria-hidden="true"
                      >
                        {row.status === "unlinked" ? "⚠" : "🖼"}
                      </span>
                    )}
                    <button
                      type="button"
                      className="flex-1 min-w-0 flex flex-col items-start gap-px overflow-hidden border-none bg-transparent p-0 font-[inherit] text-left cursor-pointer"
                      onClick={() => openAssetRow(row)}
                      title={
                        row.status === "unlinked"
                          ? "No asset for this reference — click to link or create one"
                          : "Manage asset"
                      }
                    >
                      <span className="text-[0.78rem] text-slate-700 overflow-hidden text-ellipsis whitespace-nowrap">
                        {row.asset?.title ?? row.ref}
                      </span>
                      <span
                        className={clsx(
                          "text-[0.68rem] font-mono overflow-hidden text-ellipsis whitespace-nowrap",
                          isUnlinked || isMissingShortDescription
                            ? "text-amber-700"
                            : "text-slate-400",
                        )}
                      >
                        {row.status === "unlinked"
                          ? `${row.ref} — needs asset`
                          : row.status === "unused"
                            ? `${row.ref} — not placed`
                            : row.ref}
                        {row.asset?.contentType && ` · ${row.asset.contentType}`}
                      </span>
                    </button>
                    <div
                      className={clsx(
                        "flex items-center shrink-0 opacity-0 pointer-events-none transition-opacity duration-100 group-hover:opacity-100 group-hover:pointer-events-auto",
                        isBusy && "opacity-100 pointer-events-auto",
                      )}
                    >
                      {isBusy ? (
                        <span
                          className="inline-block w-[14px] h-[14px] border-2 border-slate-300 border-t-emerald-500 rounded-full animate-[spin_0.8s_linear_infinite]"
                          role="status"
                          aria-label="Duplicating asset"
                          title="Duplicating…"
                        />
                      ) : (
                        <DivisionMenu items={assetMenuItems(row)} />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {onOpenAssetPicker && (
        <div className="block w-full bg-transparent border-none border-t border-[#dde0e6] py-[7px] px-2.5 font-[inherit] text-[0.78rem] text-left shrink-0 flex justify-around">
          <button
            type="button"
            data-testid="toc-assets-btn"
            className="bg-transparent border-none text-blue-600 cursor-pointer hover:bg-blue-50 hover:underline"
            onClick={() => onOpenAssetPicker()}
          >
            Manage
          </button>
          <button
            type="button"
            data-testid="toc-assets-btn"
            className="bg-transparent border-none text-blue-600 cursor-pointer hover:bg-blue-50 hover:underline"
            onClick={() => onOpenAssetPicker("add")}
          >
            Add
          </button>
        </div>
      )}
    </>
  );
};

export default AssetList;
