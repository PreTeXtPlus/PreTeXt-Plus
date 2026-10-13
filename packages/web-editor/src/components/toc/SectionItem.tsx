import clsx from "clsx";
import type { Division } from "../../types/sections";
import { ChevronIcon } from "../icons";
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
  /** Start a new sub-division of this one; the row shows no [+] when omitted. */
  onAddChild?: () => void;
}

/**
 * One row of the Contents tree. Selecting it opens the division in the code
 * editor, whose title bar carries its properties and actions — the row itself
 * only expands, collapses, selects and, through its [+], adds a sub-division.
 */
const SectionItem = ({
  division,
  depth,
  isActive,
  hasChildren,
  isExpanded,
  onToggleExpand,
  onSelect,
  onAddChild,
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
          className="shrink-0 flex items-center justify-center w-5 h-5 p-0 bg-transparent border-none rounded-[3px] cursor-pointer text-slate-500 hover:text-slate-800 hover:bg-[#dde0e6]"
          onClick={onToggleExpand}
          aria-label={isExpanded ? "Collapse" : "Expand"}
          aria-expanded={hasChildren ? isExpanded : undefined}
          tabIndex={hasChildren ? 0 : -1}
          style={{ visibility: hasChildren ? "visible" : "hidden" }}
        >
          <ChevronIcon open={isExpanded} />
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

        {onAddChild && (
          <button
            type="button"
            data-testid="toc-add-child"
            className={clsx(
              "shrink-0 ml-auto flex items-center justify-center w-5 h-5 p-0 bg-transparent border-none rounded-[3px] cursor-pointer text-slate-500 hover:text-slate-800 hover:bg-[#dde0e6] focus-visible:opacity-100",
              // Out of the way until the row is pointed at, focused or open,
              // so a long book's tree doesn't bristle with them.
              isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            onClick={onAddChild}
            aria-label={`Add sub-division to ${title || division.xmlId}`}
            title="Add sub-division"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>
    </li>
  );
};

export default SectionItem;
