import clsx from "clsx";
import type { Division } from "../../types/sections";
import { divisionDisplayTitle, TYPE_FULL_LABELS } from "./types";

interface SectionItemProps {
  division: Division;
  depth: number;
  /** True while this division is the one open in the code editor. */
  isActive: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
}

/**
 * One row of the Contents tree. Selecting it opens the division in the code
 * editor, whose title bar carries its properties and actions — the row itself
 * only expands, collapses and selects.
 */
const SectionItem = ({
  division,
  depth,
  isActive,
  hasChildren,
  isExpanded,
  onToggleExpand,
  onSelect,
}: SectionItemProps) => {
  const title = divisionDisplayTitle(division);

  return (
    <li
      data-testid={`toc-item-${division.xmlId}`}
      className={clsx(
        "group relative flex flex-col border-l-[3px] border-transparent cursor-default",
        isActive && "border-l-blue-600",
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
            {title || <em>Untitled</em>}
          </span>
          {division.xmlId && (
            <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[0.68rem] font-normal font-mono text-slate-400">
              {division.xmlId}
            </span>
          )}
        </button>
      </div>
    </li>
  );
};

export default SectionItem;
