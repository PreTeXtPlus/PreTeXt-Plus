import EditForm from "./EditForm";
import type { AssetEditDraft } from "./types";

interface NewAssetRowProps {
  draft: AssetEditDraft;
  onDraftChange: (draft: AssetEditDraft) => void;
  onCommit: () => void;
  onCancel: () => void;
}

/**
 * The placeholder row for an asset that does not exist yet — mirrors
 * `NewDivisionRow`. A new asset is a draft until its form is saved (see
 * `pendingNew` in the store): nothing is uploaded, fetched, or created until
 * then, so Cancel here leaves the project untouched exactly like cancelling a
 * new division does.
 */
const NewAssetRow = ({ draft, onDraftChange, onCommit, onCancel }: NewAssetRowProps) => (
  <li
    data-testid="toc-new-asset"
    className="group relative flex flex-col border-l-[3px] border-indigo-400 bg-[#f0f4ff]"
  >
    <div className="flex items-center gap-0.5 px-1 min-h-8 pl-4">
      <span className="flex-1 min-w-0 py-1 px-0.5 overflow-hidden">
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[0.83rem] italic text-indigo-700">
          New asset
        </span>
      </span>
    </div>

    <EditForm
      draft={draft}
      isNew
      onDraftChange={(d) => onDraftChange(d as AssetEditDraft)}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  </li>
);

export default NewAssetRow;
