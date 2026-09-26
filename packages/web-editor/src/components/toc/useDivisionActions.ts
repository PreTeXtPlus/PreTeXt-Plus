import type { Division } from "../../types/sections";
import {
  divisionRefTag,
  insertDivisionRef,
  removeDivisionRef,
} from "../../sectionUtils";
import { useEditorStore } from "../../store/hooks";

/**
 * The project's root division and the structural actions both the Contents
 * tree and the flat Divisions list offer on a division row.
 */
export function useDivisionActions() {
  const divisions = useEditorStore((s) => s.divisions);
  const rootDivisionId = useEditorStore((s) => s.rootDivisionId);
  const activeDivisionId = useEditorStore((s) => s.activeDivisionId);
  const removeSection = useEditorStore((s) => s.removeSection);
  const divisionContentChange = useEditorStore((s) => s.divisionContentChange);
  const insertAtCursor = useEditorStore((s) => s.insertAtCursor);

  const rootDivision = divisions
    ? (divisions.find((d) => d.xmlId === rootDivisionId) ??
        divisions.find(
          (d) =>
            d.type === "book" || d.type === "article" || d.type === "slideshow",
        ) ??
        divisions[0] ??
        null)
    : null;

  // The source format of the division currently being edited. Includes the user
  // inserts/copies must match it: a Markdown division needs the `::type{ref}`
  // leaf-directive form and a LaTeX division the `\plus{type}{ref}` macro, since
  // raw `<plus:.../>` XML doesn't survive their conversion. Defaults to PreTeXt
  // when nothing is active.
  const activeFormat =
    divisions?.find((d) => d.xmlId === activeDivisionId)?.sourceFormat ??
    "pretext";

  const handleUnplace = (xmlId: string, parentXmlId: string) => {
    if (!divisions) return;
    const parent = divisions.find((d) => d.xmlId === parentXmlId);
    if (!parent) return;
    divisionContentChange(
      parent.xmlId,
      removeDivisionRef(parent.source, xmlId, parent.sourceFormat),
    );
  };

  const handleDelete = (division: Division, parentXmlId: string | null) => {
    if (
      !window.confirm(
        `Delete "${division.title || "Untitled"}"? This permanently removes the division.`,
      )
    )
      return;
    if (parentXmlId && divisions) {
      const parent = divisions.find((d) => d.xmlId === parentXmlId);
      if (parent) {
        divisionContentChange(
          parent.xmlId,
          removeDivisionRef(parent.source, division.xmlId, parent.sourceFormat),
        );
      }
    }
    removeSection(division.xmlId);
  };

  const handleInsertAtCursor = (division: Division) => {
    insertAtCursor(divisionRefTag(division.type, division.xmlId, activeFormat));
  };

  const handlePlaceOrphan = (orphan: Division) => {
    if (!rootDivision) return;
    divisionContentChange(
      rootDivision.xmlId,
      insertDivisionRef(
        rootDivision.source,
        orphan.xmlId,
        orphan.type,
        null,
        rootDivision.sourceFormat,
      ),
    );
  };

  const getDivisionType = (xmlId: string | null) =>
    (xmlId && divisions?.find((d) => d.xmlId === xmlId)?.type) || null;

  return {
    divisions,
    rootDivision,
    activeFormat,
    handleUnplace,
    handleDelete,
    handleInsertAtCursor,
    handlePlaceOrphan,
    getDivisionType,
  };
}
