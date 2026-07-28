import ArticleToc from "./toc/ArticleToc";
import "./TableOfContents.css";

export interface TableOfContentsProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  /** When provided, shows "Open asset picker" affordance in the TOC. */
  onOpenAssetPicker?: (initialTab?: "add") => void;
  /** If true, hides all assets in the TOC and asset manager. */
  hideAssets?: boolean;
}

/** TOC sidebar. ArticleToc reads divisions data from the editor store. */
const TableOfContents = ({
  isCollapsed,
  onToggleCollapse,
  onOpenAssetPicker,
  hideAssets,
}: TableOfContentsProps) => {
  if (isCollapsed) {
    return (
      <div className="pretext-plus-editor__toc pretext-plus-editor__toc--collapsed">
        <button
          type="button"
          className="pretext-plus-editor__toc-toggle"
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
    <div className="pretext-plus-editor__toc">
      <div className="pretext-plus-editor__toc-header">
        <span className="pretext-plus-editor__toc-heading">Contents</span>
        <div className="pretext-plus-editor__toc-header-actions">
          <button
            type="button"
            className="pretext-plus-editor__toc-toggle"
            onClick={onToggleCollapse}
            aria-label="Collapse table of contents"
            title="Collapse table of contents"
          >
            ✕
          </button>
        </div>
      </div>
       <ArticleToc onOpenAssetPicker={onOpenAssetPicker} hideAssets={hideAssets} />
    </div>
  );
};

export default TableOfContents;
