import { type EditDraft, TYPE_FULL_LABELS } from "./types";

interface NewDivisionRowProps {
  draft: EditDraft;
  /** Indent level, matching the SectionItem it will become once saved. */
  depth: number;
}

/**
 * The placeholder row for a division that does not exist yet.
 *
 * A new division is a draft until its properties form — in the settings drawer
 * under the editor's title bar — is saved (see `pendingNewDivision` in the
 * store), so there is no `Division` for `SectionItem` to render, and nothing to
 * select or expand. This stands in its place at the position the division will
 * take, so the author can see where it is going while they name it.
 */
const NewDivisionRow = ({ draft, depth }: NewDivisionRowProps) => (
  <li
    data-testid="toc-new-division"
    className="group relative flex flex-col border-l-[3px] border-indigo-400 bg-[#f0f4ff]"
  >
    <div
      className="flex items-center gap-0.5 px-1 min-h-8"
      style={depth > 0 ? { paddingLeft: `${depth * 14}px` } : undefined}
    >
      <span className="shrink-0 w-4" aria-hidden="true" />
      <span className="flex-1 min-w-0 py-1 px-0.5 overflow-hidden">
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[0.83rem] italic text-indigo-700">
          {draft.title.trim() ||
            `New ${(TYPE_FULL_LABELS[draft.type] ?? "division").toLowerCase()}`}
        </span>
      </span>
    </div>
  </li>
);

export default NewDivisionRow;
