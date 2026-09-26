import type { Division } from "../../types/sections";
import SectionItem from "./SectionItem";
import NewDivisionRow from "./NewDivisionRow";
import type { DivisionMenuItem } from "./DivisionMenu";
import { useDivisionActions } from "./useDivisionActions";
import { buildDivisionTree, getOrphanRoots } from "../../sectionUtils";
import { useEditorStore } from "../../store/hooks";

export interface DivisionListProps {
  /** If true, hides every structural action (add/remove/edit/place a division). */
  readOnly?: boolean;
}

/** Where a division sits, which decides the actions its row offers. */
type RowKind = "root" | "placed" | "unplaced" | "unplaced-child";

interface Row {
  division: Division;
  kind: RowKind;
  parentXmlId: string | null;
}

/**
 * The explorer's Divisions view: every division in the project as a flat
 * list — the root, the placed divisions in document order, then the unplaced
 * ones (the only place those appear, since the Contents view shows just the
 * document's tree).
 */
const DivisionList = ({ readOnly }: DivisionListProps) => {
  const activeDivisionId = useEditorStore((s) => s.activeDivisionId);
  const selectSection = useEditorStore((s) => s.selectSection);
  const startSectionEdit = useEditorStore((s) => s.startSectionEdit);
  const setEditDraft = useEditorStore((s) => s.setEditDraft);
  const commitSectionEdit = useEditorStore((s) => s.commitSectionEdit);
  const cancelSectionEdit = useEditorStore((s) => s.cancelSectionEdit);
  const editingId = useEditorStore((s) => s.editingId);
  const editDraft = useEditorStore((s) => s.editDraft);
  const pendingNewDivision = useEditorStore((s) => s.pendingNewDivision);

  const {
    divisions,
    rootDivision,
    handleUnplace,
    handleDelete,
    handleInsertAtCursor,
    handlePlaceOrphan,
    getDivisionType,
  } = useDivisionActions();

  const rows: Row[] = [];
  if (rootDivision && divisions) {
    rows.push({ division: rootDivision, kind: "root", parentXmlId: null });
    for (const node of buildDivisionTree(divisions, rootDivision.xmlId)) {
      rows.push({
        division: node.division,
        kind: "placed",
        parentXmlId: node.parentXmlId,
      });
    }
    // Each orphan root heads a dangling subtree; its descendants are placed
    // inside it, just not anywhere the document reaches.
    for (const orphan of getOrphanRoots(divisions, rootDivision.xmlId)) {
      rows.push({ division: orphan, kind: "unplaced", parentXmlId: null });
      for (const node of buildDivisionTree(divisions, orphan.xmlId)) {
        rows.push({
          division: node.division,
          kind: "unplaced-child",
          parentXmlId: node.parentXmlId,
        });
      }
    }
  }

  const menuItems = ({ division, kind, parentXmlId }: Row): DivisionMenuItem[] => {
    if (readOnly) return [];
    const items: DivisionMenuItem[] = [
      { label: "Edit properties", onClick: () => startSectionEdit(division) },
    ];
    if (kind === "root") return items;
    if (kind === "placed") {
      items.push({
        label: "Remove from document",
        onClick: () => handleUnplace(division.xmlId, parentXmlId!),
      });
    } else {
      if (kind === "unplaced") {
        items.push({
          label: "Place in document",
          onClick: () => handlePlaceOrphan(division),
        });
      }
      items.push({
        label: "Insert at cursor",
        onClick: () => handleInsertAtCursor(division),
      });
    }
    items.push({
      label: "Delete from project",
      onClick: () => handleDelete(division, parentXmlId),
      danger: true,
    });
    return items;
  };

  // An unplaced orphan is placed directly under the root by "Place in
  // document", so the root's rules are the ones that apply — and e.g. an
  // article project never offers Part/Chapter.
  const rootType = rootDivision?.type ?? null;
  const parentTypeFor = ({ kind, parentXmlId }: Row) =>
    kind === "unplaced" ? rootType : getDivisionType(parentXmlId);

  return (
    <ul className="list-none m-0 overflow-y-auto flex-1" role="list">
      {rows.map((row) => (
        <SectionItem
          key={row.division.xmlId}
          division={row.division}
          depth={0}
          isActive={activeDivisionId === row.division.xmlId}
          hasChildren={false}
          isExpanded={false}
          onToggleExpand={() => {}}
          editDraft={editingId === row.division.xmlId ? editDraft : null}
          onSelect={() => selectSection(row.division.xmlId)}
          onDraftChange={setEditDraft}
          onEditCommit={commitSectionEdit}
          onEditCancel={cancelSectionEdit}
          menuItems={menuItems(row)}
          isRoot={row.kind === "root"}
          parentType={parentTypeFor(row)}
          note={
            row.kind === "unplaced" || row.kind === "unplaced-child"
              ? "not placed"
              : undefined
          }
        />
      ))}

      {/* A draft with no parent will be created unplaced, so it belongs here. */}
      {pendingNewDivision && pendingNewDivision.parentXmlId === null && editDraft && (
        <NewDivisionRow
          draft={editDraft}
          depth={0}
          parentType={null}
          onDraftChange={setEditDraft}
          onCommit={commitSectionEdit}
          onCancel={cancelSectionEdit}
        />
      )}
    </ul>
  );
};

export default DivisionList;
