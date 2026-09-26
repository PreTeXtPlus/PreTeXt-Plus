import clsx from "clsx";
import { buildProjectAssetView, type AssetRow } from "../../assetView";
import { useEditorStore } from "../../store/hooks";

export interface AssetListProps {
  onOpenAssetPicker?: (initialTab?: "add") => void;
}

/**
 * The explorer's Assets view: every asset placeholder and project asset, with
 * status. Selecting an asset opens its source in the code editor, whose title
 * bar carries its settings; a placeholder with no asset behind it opens the
 * asset manager to link or upload one instead, having no source to open.
 */
const AssetList = ({ onOpenAssetPicker }: AssetListProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const projectAssets = useEditorStore((s) => s.projectAssets) ?? [];
  const openItem = useEditorStore((s) => s.openItem);
  const openAsset = useEditorStore((s) => s.openAsset);
  const openAssetResolver = useEditorStore((s) => s.openAssetResolver);

  // ── Joined asset view — placeholders + project assets, with status ───────
  const assetView = buildProjectAssetView(divisions, projectAssets);

  const openAssetRow = (row: AssetRow) =>
    row.status === "unlinked" ? openAssetResolver(row.ref) : openAsset(row.ref);

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
          <ul className="list-none m-0 pt-0 px-0 pb-1">
            {assetView.map((row) => {
              const isUnlinked = row.status === "unlinked";
              const isMissingShortDescription =
                row.asset && !row.asset.shortDescription?.trim();
              const isOpen = openItem.kind === "asset" && openItem.ref === row.ref;
              return (
                <li
                  key={row.ref}
                  data-testid={`asset-row-${row.ref}`}
                  className={clsx(
                    "flex items-center gap-1.5 py-[3px] pr-1.5 pl-4 min-h-7 border-l-[3px]",
                    isOpen
                      ? "bg-[#e0e8ff] border-l-blue-600"
                      : "border-transparent hover:bg-[#e8eaf0]",
                  )}
                >
                  {row.asset?.thumbnailUrl || row.asset?.url ? (
                    <img
                      src={row.asset?.thumbnailUrl || row.asset.url}
                      className="h-[30px] cursor-pointer"
                      onClick={() => openAssetRow(row)}
                      alt=""
                    />
                  ) : (
                    <span
                      className={clsx(
                        "inline-flex items-center justify-center w-[30px] h-[30px] cursor-pointer text-[0.85rem] rounded bg-[#eef2f7] text-slate-400",
                        isUnlinked && "bg-amber-100 text-amber-700",
                      )}
                      onClick={() => openAssetRow(row)}
                      aria-hidden="true"
                    >
                      {isUnlinked ? "⚠" : "🖼"}
                    </span>
                  )}
                  <button
                    type="button"
                    className="flex-1 min-w-0 flex flex-col items-start gap-px overflow-hidden border-none bg-transparent p-0 font-[inherit] text-left cursor-pointer"
                    onClick={() => openAssetRow(row)}
                    aria-current={isOpen ? "true" : undefined}
                    title={
                      isUnlinked
                        ? "No asset for this reference — click to link or create one"
                        : "Open asset"
                    }
                  >
                    <span
                      className={clsx(
                        "text-[0.78rem] text-slate-700 overflow-hidden text-ellipsis whitespace-nowrap",
                        isOpen && "font-semibold",
                      )}
                    >
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
                      {isUnlinked
                        ? `${row.ref} — needs asset`
                        : row.status === "unused"
                          ? `${row.ref} — not placed`
                          : row.ref}
                      {row.asset?.contentType && ` · ${row.asset.contentType}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
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
