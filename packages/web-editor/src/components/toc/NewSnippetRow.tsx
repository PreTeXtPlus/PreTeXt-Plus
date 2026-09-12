import EditForm from "./EditForm";
import type { SnippetEditDraft } from "./types";

interface NewSnippetRowProps {
  draft: SnippetEditDraft;
  onDraftChange: (draft: SnippetEditDraft) => void;
  onCommit: () => void;
  onCancel: () => void;
}

/**
 * The placeholder row for a snippet that does not exist yet — mirrors
 * `NewDivisionRow`/`NewAssetRow`. A new snippet is a draft until its form is
 * saved (see `pendingNew` in the store): nothing is created until then, so
 * Cancel here leaves the project untouched.
 */
const NewSnippetRow = ({ draft, onDraftChange, onCommit, onCancel }: NewSnippetRowProps) => (
  <li
    data-testid="toc-new-snippet"
    className="group relative flex flex-col border-l-[3px] border-indigo-400 bg-[#f0f4ff]"
  >
    <div className="flex items-center gap-0.5 px-1 min-h-8 pl-4">
      <span className="flex-1 min-w-0 py-1 px-0.5 overflow-hidden">
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[0.83rem] italic text-indigo-700">
          New snippet
        </span>
      </span>
    </div>

    <EditForm
      draft={draft}
      isNew
      onDraftChange={(d) => onDraftChange(d as SnippetEditDraft)}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  </li>
);

export default NewSnippetRow;
