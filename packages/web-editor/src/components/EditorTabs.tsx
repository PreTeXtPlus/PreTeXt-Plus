import clsx from "clsx";
import type { OpenItem } from "../store/editorStore";
import { sameOpenItem } from "../store/editorStore";
import type { EditorTarget } from "./editorTarget";
import { KindIcon } from "./EditorTargetBar";
import { CloseIcon } from "./icons";
import { divisionDisplayTitle, TYPE_FULL_LABELS } from "./toc/types";

/** A tab: the item it names, resolved against the pools so it can be labelled. */
export interface EditorTab {
  item: OpenItem;
  target: EditorTarget;
}

export interface EditorTabsProps {
  tabs: EditorTab[];
  active: OpenItem;
  onSelect: (item: OpenItem) => void;
  onClose: (item: OpenItem) => void;
}

/** What a tab is called: the same name the title bar gives the open item. */
const editorTabLabel = (target: EditorTarget): string => {
  if (target.kind === "division") {
    const { division } = target;
    return (
      divisionDisplayTitle(division) ||
      `Untitled ${(TYPE_FULL_LABELS[division.type] ?? "division").toLowerCase()}`
    );
  }
  if (target.kind === "snippet") return target.snippet.title || target.snippet.ref;
  return target.asset.title || target.asset.ref || "Untitled asset";
};

/**
 * The strip of tabs above the editor's title bar, one per item the author has
 * stepped aside to — see the store's `openTabs`. It is shown only once there
 * are two: a single tab would only repeat the title bar below it. The tabs
 * share the one code editor and preview, which show the active tab, so
 * they hold nothing of their own. Middle-click closes a tab, as in a browser.
 */
const EditorTabs = ({ tabs, active, onSelect, onClose }: EditorTabsProps) => {
  if (tabs.length < 2) return null;
  return (
    <div
      role="tablist"
      aria-label="Open items"
      data-testid="editor-tabs"
      className="flex items-stretch shrink-0 h-8 overflow-x-auto bg-[#e9ebef] border-b border-[#dde0e6] select-none"
    >
      {tabs.map(({ item, target }) => {
        const isActive = sameOpenItem(item, active);
        const label = editorTabLabel(target);
        return (
          <div
            key={`${item.kind}:${item.ref}`}
            role="tab"
            aria-selected={isActive}
            data-testid={`editor-tab-${item.kind}-${item.ref}`}
            className={clsx(
              "group flex items-center gap-1 min-w-0 max-w-[14rem] pl-2 pr-1 border-r border-[#dde0e6] cursor-pointer",
              isActive
                ? "bg-[#f5f6f8] text-slate-800 -mb-px border-b border-b-[#f5f6f8]"
                : "text-slate-600 hover:bg-[#f0f1f4]",
            )}
            onMouseDown={(e) => {
              // Middle-click closes. `onAuxClick` would do, but mousedown is
              // what browsers themselves act on, and keeps auto-scroll off.
              if (e.button === 1) {
                e.preventDefault();
                onClose(item);
              }
            }}
            onClick={() => onSelect(item)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(item);
              } else if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                onClose(item);
              }
            }}
            tabIndex={isActive ? 0 : -1}
            title={label}
          >
            <span className="[&>span>svg]:w-4 [&>span>svg]:h-4">
              <KindIcon kind={item.kind} />
            </span>
            <span
              className={clsx(
                "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.78rem]",
                isActive && "font-semibold",
                target.kind === "snippet" && !target.snippet.title && "font-mono",
              )}
            >
              {label}
            </span>
            <button
              type="button"
              aria-label={`Close ${label}`}
              className={clsx(
                "flex items-center justify-center shrink-0 w-5 h-5 p-0 border-none rounded-[3px] bg-transparent cursor-pointer text-slate-500 hover:bg-slate-300 hover:text-slate-800",
                !isActive && "opacity-0 group-hover:opacity-100 focus:opacity-100",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onClose(item);
              }}
              tabIndex={-1}
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default EditorTabs;
