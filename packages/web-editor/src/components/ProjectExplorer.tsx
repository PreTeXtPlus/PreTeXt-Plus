import { useEffect, type ReactNode } from "react";
import clsx from "clsx";
import ArticleToc from "./toc/ArticleToc";
import DivisionList from "./toc/DivisionList";
import SnippetList from "./toc/SnippetList";
import AssetList from "./toc/AssetList";
import FindReplacePanel from "./toc/FindReplacePanel";
import {
  AssetsIcon,
  DivisionsIcon,
  FindIcon,
  SnippetsIcon,
  TocIcon,
} from "./toc/explorerIcons";
import { buildProjectAssetView } from "../assetView";
import { buildProjectSnippetView } from "../snippetView";
import type { ExplorerView } from "../store/editorStore";
import type { ProjectMatch } from "../types/projectScan";
import { useEditorStore } from "../store/hooks";

/** The explorer rail's buttons, top to bottom. */
const EXPLORER_VIEWS: {
  view: ExplorerView;
  label: string;
  icon: () => ReactNode;
}[] = [
  { view: "toc", label: "Contents", icon: TocIcon },
  { view: "divisions", label: "All Divisions", icon: DivisionsIcon },
  { view: "snippets", label: "Snippets", icon: SnippetsIcon },
  { view: "assets", label: "Assets", icon: AssetsIcon },
  { view: "find", label: "Find in Project", icon: FindIcon },
];

export interface ProjectExplorerProps {
  /** When provided, shows the Manage/Add affordances in the Assets view. */
  onOpenAssetPicker?: (initialTab?: "add") => void;
  /** If true, hides the Assets view entirely. */
  hideAssets?: boolean;
  /** When provided, shows the Manage/Add affordances in the Snippets view. */
  onOpenSnippetPicker?: (initialTab?: "add") => void;
  /** If true, hides the Snippets view entirely. */
  hideSnippets?: boolean;
  /** If true, hides every structural action (add/remove/edit/place a division). */
  readOnly?: boolean;
  onJumpToMatch: (match: ProjectMatch) => void;
  onReplaceMatches: (matches: ProjectMatch[], replacement: string) => void;
}

/**
 * The left sidebar: an always-visible icon rail and, beside it, the panel for
 * the selected view (Contents, Divisions, Snippets, Assets, Find). Clicking
 * the open view's icon collapses the panel, leaving just the rail. Views read
 * their data from the editor store.
 */
const ProjectExplorer = ({
  onOpenAssetPicker,
  hideAssets,
  onOpenSnippetPicker,
  hideSnippets,
  readOnly,
  onJumpToMatch,
  onReplaceMatches,
}: ProjectExplorerProps) => {
  const isCollapsed = useEditorStore((s) => s.isTocCollapsed);
  const storedView = useEditorStore((s) => s.explorerView);
  const selectExplorerView = useEditorStore((s) => s.selectExplorerView);
  const divisions = useEditorStore((s) => s.divisions);
  const projectAssets = useEditorStore((s) => s.projectAssets) ?? [];
  const projectSnippets = useEditorStore((s) => s.projectSnippets) ?? [];

  const isHidden = (view: ExplorerView) =>
    (view === "snippets" && hideSnippets) || (view === "assets" && hideAssets);
  const views = EXPLORER_VIEWS.filter(({ view }) => !isHidden(view));
  const activeView: ExplorerView = isHidden(storedView) ? "toc" : storedView;
  const active = views.find(({ view }) => view === activeView)!;

  // Escape closes the find view, as it did when find was a drawer of its own.
  const isFindOpen = !isCollapsed && activeView === "find";
  useEffect(() => {
    if (!isFindOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") selectExplorerView("find");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFindOpen, selectExplorerView]);

  const count =
    activeView === "snippets"
      ? buildProjectSnippetView(divisions, projectSnippets).length
      : activeView === "assets"
        ? buildProjectAssetView(divisions, projectAssets).length
        : 0;

  return (
    <div className="flex flex-row h-full shrink-0">
      <div
        className="flex flex-col items-center gap-1 w-9 min-w-9 h-full pt-2 bg-[#f5f6f8] border-r border-[#dde0e6] select-none"
        role="toolbar"
        aria-orientation="vertical"
        aria-label="Project explorer"
      >
        {views.map(({ view, label, icon: Icon }) => {
          const isOpen = !isCollapsed && view === activeView;
          return (
            <button
              key={view}
              type="button"
              data-testid={`explorer-tab-${view}`}
              className={clsx(
                "flex items-center justify-center w-7 h-7 p-0 bg-transparent border-none rounded-[3px] cursor-pointer",
                isOpen
                  ? "bg-[#e0e8ff] text-blue-700"
                  : "text-[#666] hover:bg-[#e3e6ec] hover:text-[#333]",
              )}
              onClick={() => selectExplorerView(view)}
              aria-pressed={isOpen}
              aria-label={isOpen ? `Hide ${label}` : label}
              title={isOpen ? `Hide ${label}` : label}
            >
              <Icon />
            </button>
          );
        })}
      </div>

      {!isCollapsed && (
        <div
          className={clsx(
            "flex flex-col w-[260px] min-w-[260px] h-full overflow-hidden bg-[#f5f6f8] border-r border-[#dde0e6]",
            activeView !== "find" && "select-none",
          )}
        >
          <div className="flex items-center gap-1.5 py-2 px-2.5 pb-1.5 border-b border-[#dde0e6] shrink-0">
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-[#555]">
              {active.label}
            </span>
            {count > 0 && (
              <span className="text-[0.68rem] font-semibold text-white bg-slate-400 rounded-full px-[5px] py-0 leading-[1.4] shrink-0">
                {count}
              </span>
            )}
          </div>
          {activeView === "toc" && <ArticleToc readOnly={readOnly} />}
          {activeView === "divisions" && <DivisionList readOnly={readOnly} />}
          {activeView === "snippets" && (
            <SnippetList onOpenSnippetPicker={onOpenSnippetPicker} />
          )}
          {activeView === "assets" && (
            <AssetList onOpenAssetPicker={onOpenAssetPicker} />
          )}
          {activeView === "find" && (
            <FindReplacePanel
              readOnly={readOnly}
              onJumpToMatch={onJumpToMatch}
              onReplaceMatches={onReplaceMatches}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectExplorer;
