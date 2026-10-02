import type { Division } from "../../types/sections";
import type { SourceFormat } from "../../types/editor";
import {
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
  const openItem = useEditorStore((s) => s.openItem);
  const projectSnippets = useEditorStore((s) => s.projectSnippets);
  const removeSection = useEditorStore((s) => s.removeSection);
  const divisionContentChange = useEditorStore((s) => s.divisionContentChange);

  const rootDivision = divisions
    ? (divisions.find((d) => d.xmlId === rootDivisionId) ??
        divisions.find(
          (d) =>
            d.type === "book" || d.type === "article" || d.type === "slideshow",
        ) ??
        divisions[0] ??
        null)
    : null;

  // The source format of the buffer open in the code editor — a division's,
  // a snippet's own, or PreTeXt for an asset (whose source is PreTeXt). Includes
  // the user inserts/copies must match it: Markdown needs the `::type{ref}`
  // leaf-directive form and LaTeX the `\plus{type}{ref}` macro, since raw
  // `<plus:.../>` XML doesn't survive their conversion.
  const activeFormat: SourceFormat =
    openItem.kind === "division"
      ? (divisions?.find((d) => d.xmlId === openItem.ref)?.sourceFormat ??
        rootDivision?.sourceFormat ??
        "pretext")
      : openItem.kind === "snippet"
        ? (projectSnippets?.find((s) => s.ref === openItem.ref)?.sourceFormat ??
          "pretext")
        : "pretext";

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
    handlePlaceOrphan,
    getDivisionType,
  };
}
