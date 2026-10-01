import { useEffect, type ReactNode } from "react";
import clsx from "clsx";
import ArticleToc from "./toc/ArticleToc";
import SnippetList from "./toc/SnippetList";
import AssetList from "./toc/AssetList";
import FindReplacePanel from "./toc/FindReplacePanel";
import {
  AssetsIcon,
  FindIcon,
  SnippetsIcon,
  TocIcon,
} from "./icons";
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
  { view: "toc", label: "Table of Contents", icon: TocIcon },
  { view: "snippets", label: "Snippets", icon: SnippetsIcon },
  { view: "assets", label: "Assets", icon: AssetsIcon },
  { view: "find", label: "Find in Project", icon: FindIcon },
];

export interface ProjectExplorerProps {
  /** Offer "New asset" in the Assets view (the host keeps a project-asset pool). */
  canCreateAssets?: boolean;
  /** If true, hides the Assets view entirely. */
  hideAssets?: boolean;
  /** Offer "New snippet" in the Snippets view (the host keeps a snippet pool). */
  canCreateSnippets?: boolean;
  /** If true, hides the Snippets view entirely. */
  hideSnippets?: boolean;
  /** If true, hides every structural action (add/remove/edit/place a division). */
  readOnly?: boolean;
  onJumpToMatch: (match: ProjectMatch) => void;
  onReplaceMatches: (matches: ProjectMatch[], replacement: string) => void;
}

/**
 * The left sidebar: an always-visible icon rail and, beside it, the panel for
 * the selected view (Table of Contents, Snippets, Assets, Find). Clicking
 * the open view's icon collapses the panel, leaving just the rail. Views read
 * their data from the editor store.
 */
const ProjectExplorer = ({
  canCreateAssets,
  hideAssets,
  canCreateSnippets,
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
  const startCreate = useEditorStore((s) => s.startCreate);

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

  // The view's "new item" [+] button, right of its label — a project that
  // keeps no pool for a kind has nothing to create one in.
  const canCreateSnippet = !readOnly && !!canCreateSnippets;
  const canCreateAsset = !readOnly && !!canCreateAssets;
  const newItemKind =
    activeView === "snippets" && canCreateSnippet
      ? ("snippet" as const)
      : activeView === "assets" && canCreateAsset
        ? ("asset" as const)
        : null;

  return (
    <div className="flex flex-row h-full shrink-0">
      <div
        className="flex flex-col items-center gap-2 w-12 min-w-12 h-full pt-2 bg-[#f5f6f8] border-r border-[#dde0e6] select-none"
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
                "flex items-center justify-center w-10 h-10 p-0 border-none rounded-[3px] cursor-pointer",
                isOpen
                  ? "text-slate-800 bg-slate-300"
                  : "text-slate-600 hover:text-slate-700 hover:bg-slate-200 hover:text-slate-500",
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
            {newItemKind && (
              <button
                type="button"
                data-testid={`toc-new-${newItemKind}-btn`}
                className="ml-auto flex items-center justify-center w-6 h-6 p-0 border-none rounded-[3px] bg-transparent text-slate-600 cursor-pointer hover:bg-slate-200 hover:text-slate-800"
                onClick={() => startCreate({ kind: newItemKind })}
                aria-label={`New ${newItemKind}`}
                title={`New ${newItemKind}`}
              >
                <svg
                  width="16"
                  height="16"
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
          {activeView === "toc" && <ArticleToc readOnly={readOnly} />}
          {activeView === "snippets" && (
            <SnippetList canCreate={canCreateSnippet} />
          )}
          {activeView === "assets" && (
            <AssetList canCreate={canCreateAsset} />
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
