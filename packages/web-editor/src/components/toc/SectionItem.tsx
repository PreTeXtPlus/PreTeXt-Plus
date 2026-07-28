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
      className={[
        "pretext-plus-editor__toc-item",
        `pretext-plus-editor__toc-item--${division.type}`,
        isActive ? "pretext-plus-editor__toc-item--active" : "",
        isEditing ? "pretext-plus-editor__toc-item--editing" : "",
      ].filter(Boolean).join(" ")}
    >
      <div
        className="pretext-plus-editor__toc-item-row"
        style={depth > 0 ? { paddingLeft: `${depth * 14}px` } : undefined}
      >
        <button
          type="button"
          className="pretext-plus-editor__toc-expand-btn"
          onClick={onToggleExpand}
          aria-label={isExpanded ? "Collapse" : "Expand"}
          tabIndex={hasChildren ? 0 : -1}
          style={{ visibility: hasChildren ? "visible" : "hidden" }}
        >
          {isExpanded ? "▾" : "▸"}
        </button>

        <button
          type="button"
          className="pretext-plus-editor__toc-select"
          onClick={onSelect}
          aria-current={isActive ? "true" : undefined}
          title={TYPE_FULL_LABELS[division.type] ?? division.type}
        >
          <span className="pretext-plus-editor__toc-title">
            {division.title || untitledFallback || <em>Untitled</em>}
          </span>
          {division.xmlId && (
            <span className="pretext-plus-editor__toc-xmlid">
              {division.xmlId}
            </span>
          )}
        </button>

        <div className="pretext-plus-editor__toc-actions">
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
