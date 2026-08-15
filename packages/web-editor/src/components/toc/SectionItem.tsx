import clsx from "clsx";
import type { Division, DivisionType } from "../../types/sections";
import SectionEditForm from "./SectionEditForm";
import DivisionMenu, { type DivisionMenuItem } from "./DivisionMenu";
import { type EditDraft, TYPE_FULL_LABELS } from "./types";

interface SectionItemProps {
  division: Division;
  depth: number;
  isActive: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  editDraft: EditDraft | null;
  onSelect: () => void;
  onDraftChange: (draft: EditDraft) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  menuItems: DivisionMenuItem[];
  /** True while `editDraft` belongs to a division that hasn't been saved yet. */
  isNew?: boolean;
  isRoot?: boolean;
  /** Type of the division this one is (or would be) nested under; `null` if unplaced. */
  parentType?: DivisionType | null;
}

const SectionItem = ({
  division,
  depth,
  isActive,
  hasChildren,
  isExpanded,
  onToggleExpand,
  editDraft,
  onSelect,
  onDraftChange,
  onEditCommit,
  onEditCancel,
  menuItems,
  isNew = false,
  isRoot = false,
  parentType = null,
}: SectionItemProps) => {
  const isEditing = editDraft !== null;

  // Introduction/conclusion divisions never carry a `<title>` in source, so
  // show their type name (e.g. "Introduction") rather than "Untitled".
  const untitledFallback =
    division.type === "introduction" || division.type === "conclusion"
      ? TYPE_FULL_LABELS[division.type]
      : null;

  return (
    <li
      data-testid={`toc-item-${division.xmlId}`}
      className={clsx(
        "group relative flex flex-col border-l-[3px] border-transparent cursor-default",
        isActive && "border-l-blue-600",
        isEditing && "bg-[#f0f4ff]",
      )}
    >
      <div
        className={clsx(
          "flex items-center gap-0.5 px-1 min-h-8",
          isActive ? "bg-[#e0e8ff]" : "group-hover:bg-[#e8eaf0]",
        )}
        style={depth > 0 ? { paddingLeft: `${depth * 14}px` } : undefined}
      >
        <button
          type="button"
          className="shrink-0 py-0 px-0.5 bg-transparent border-none rounded-[3px] cursor-pointer text-[0.7rem] leading-none text-[#aaa] w-4 text-center hover:text-[#555] hover:bg-[#dde0e6]"
          onClick={onToggleExpand}
          aria-label={isExpanded ? "Collapse" : "Expand"}
          tabIndex={hasChildren ? 0 : -1}
          style={{ visibility: hasChildren ? "visible" : "hidden" }}
        >
          {isExpanded ? "▾" : "▸"}
        </button>

        <button
          type="button"
          className={clsx(
            "flex-1 min-w-0 bg-transparent border-none cursor-pointer text-left text-[#333] py-1 px-0.5 overflow-hidden",
            isActive && "font-semibold",
          )}
          onClick={onSelect}
          aria-current={isActive ? "true" : undefined}
          title={TYPE_FULL_LABELS[division.type] ?? division.type}
        >
          <span
            data-testid="toc-title"
            className="block overflow-hidden text-ellipsis whitespace-nowrap text-[0.83rem]"
          >
            {division.title || untitledFallback || <em>Untitled</em>}
          </span>
          {division.xmlId && (
            <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[0.68rem] font-normal font-mono text-slate-400">
              {division.xmlId}
            </span>
          )}
        </button>

        <div
          className={clsx(
            "flex items-center shrink-0 opacity-0 pointer-events-none transition-opacity duration-100 group-hover:opacity-100 group-hover:pointer-events-auto",
            isActive && "opacity-100 pointer-events-auto",
          )}
        >
          <DivisionMenu items={menuItems} />
        </div>
      </div>

      {isEditing && editDraft && (
        <SectionEditForm
          draft={editDraft}
          isNew={isNew}
          isRoot={isRoot}
          parentType={parentType}
          onDraftChange={onDraftChange}
          onCommit={onEditCommit}
          onCancel={onEditCancel}
        />
      )}
    </li>
  );
};

export default SectionItem;
