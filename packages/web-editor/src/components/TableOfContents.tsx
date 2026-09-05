import ArticleToc from "./toc/ArticleToc";

export interface TableOfContentsProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  /** When provided, shows "Open asset picker" affordance in the TOC. */
  onOpenAssetPicker?: (initialTab?: "add") => void;
  /** If true, hides all assets in the TOC and asset manager. */
  hideAssets?: boolean;
  /** When provided, shows "Open snippet picker" affordance in the TOC. */
  onOpenSnippetPicker?: (initialTab?: "add") => void;
  /** If true, hides all snippets in the TOC and snippet manager. */
  hideSnippets?: boolean;
  /** If true, hides every structural action (add/remove/edit/place a division). */
  readOnly?: boolean;
}

/** TOC sidebar. ArticleToc reads divisions data from the editor store. */
const TableOfContents = ({
  isCollapsed,
  onToggleCollapse,
  onOpenAssetPicker,
  hideAssets,
  onOpenSnippetPicker,
  hideSnippets,
  readOnly,
}: TableOfContentsProps) => {
  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center w-9 min-w-9 h-full pt-2 bg-[#f5f6f8] border-r border-[#dde0e6] overflow-hidden shrink-0 transition-[width,min-width] duration-200 ease-in-out select-none">
        <button
          type="button"
          className="shrink-0 py-0.5 px-1 bg-transparent border-none rounded-[3px] cursor-pointer text-base leading-none text-[#666] hover:bg-[#e3e6ec] hover:text-[#333]"
          onClick={onToggleCollapse}
          aria-label="Expand table of contents"
          title="Expand table of contents"
        >
          ☰
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-[260px] min-w-[260px] h-full bg-[#f5f6f8] border-r border-[#dde0e6] overflow-hidden shrink-0 transition-[width,min-width] duration-200 ease-in-out select-none">
      <div className="flex items-center justify-between py-2 px-2.5 pb-1.5 border-b border-[#dde0e6] shrink-0">
        <span className="text-xs font-bold uppercase tracking-[0.06em] text-[#555]">
          Contents
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="shrink-0 py-0.5 px-1 bg-transparent border-none rounded-[3px] cursor-pointer text-base leading-none text-[#666] hover:bg-[#e3e6ec] hover:text-[#333]"
            onClick={onToggleCollapse}
            aria-label="Collapse table of contents"
            title="Collapse table of contents"
          >
            ✕
          </button>
        </div>
      </div>
      <ArticleToc
        onOpenAssetPicker={onOpenAssetPicker}
        hideAssets={hideAssets}
        onOpenSnippetPicker={onOpenSnippetPicker}
        hideSnippets={hideSnippets}
        readOnly={readOnly}
      />
    </div>
  );
};

export default TableOfContents;
