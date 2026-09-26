import type { Division } from "../../types/sections";
import type { SourceFormat } from "../../types/editor";
import { divisionRefTag } from "../../sectionUtils";
import { useEditorStore } from "../../store/hooks";
import SectionEditForm from "../toc/SectionEditForm";
import { divisionDisplayTitle } from "../toc/types";
import { useDivisionActions } from "../toc/useDivisionActions";
import {
  divisionActionEntries,
  findDivisionPlacement,
} from "../toc/divisionActions";
import { EmbedCode, SettingsActions, SettingsNote } from "./settingsUi";

export interface DivisionSettingsProps {
  division: Division;
  /** Default format for the embed-code picker — the root division's. */
  embedFormat: SourceFormat;
}

/**
 * A division's settings: its properties form (title, type, id — saved with the
 * form's Save), its embed code, and the structural actions its place in the
 * document allows. While a new child is being drafted the panel is that
 * draft's form instead, so the author names it where they asked for it.
 */
const DivisionSettings = ({ division, embedFormat }: DivisionSettingsProps) => {
  const editingId = useEditorStore((s) => s.editingId);
  const editDraft = useEditorStore((s) => s.editDraft);
  const pendingNewDivision = useEditorStore((s) => s.pendingNewDivision);
  const setEditDraft = useEditorStore((s) => s.setEditDraft);
  const commitSectionEdit = useEditorStore((s) => s.commitSectionEdit);
  const cancelSectionEdit = useEditorStore((s) => s.cancelSectionEdit);
  const addSection = useEditorStore((s) => s.addSection);
  const {
    divisions,
    rootDivision,
    handleUnplace,
    handleDelete,
    handlePlaceOrphan,
    getDivisionType,
  } = useDivisionActions();

  const placement = findDivisionPlacement(
    divisions ?? [],
    rootDivision?.xmlId ?? null,
    division.xmlId,
  );

  if (pendingNewDivision && editDraft) {
    const parentType = getDivisionType(pendingNewDivision.parentXmlId);
    return (
      <div className="flex flex-col gap-2" data-testid="settings-new-division">
        <SettingsNote>
          New division inside{" "}
          <strong>{divisionDisplayTitle(division) || division.xmlId}</strong>.
          Nothing is created until you save.
        </SettingsNote>
        <SectionEditForm
          draft={editDraft}
          isNew
          parentType={parentType}
          onDraftChange={setEditDraft}
          onCommit={commitSectionEdit}
          onCancel={cancelSectionEdit}
        />
      </div>
    );
  }

  const actions = divisionActionEntries(division, placement, {
    addChild: (parentXmlId) => addSection(parentXmlId),
    unplace: handleUnplace,
    remove: handleDelete,
    placeInDocument: handlePlaceOrphan,
  });

  return (
    <div className="flex flex-col gap-2.5">
      {editDraft && editingId === division.xmlId && (
        <SectionEditForm
          // Re-seed the form's own state (its id-follows-title tracking) when a
          // different division's draft arrives.
          key={division.xmlId}
          draft={editDraft}
          isRoot={placement.kind === "root"}
          // Unplaced, "Place in document" puts it directly under the root, so
          // the root's rules are the ones that apply — an article project never
          // offers Part/Chapter.
          parentType={
            placement.kind === "root"
              ? null
              : getDivisionType(placement.parentXmlId ?? rootDivision?.xmlId ?? null)
          }
          onDraftChange={setEditDraft}
          onCommit={commitSectionEdit}
          onCancel={cancelSectionEdit}
        />
      )}
      {placement.kind !== "root" && (
        <EmbedCode
          codeFor={(format) =>
            divisionRefTag(division.type, division.xmlId, format)
          }
          defaultFormat={embedFormat}
        />
      )}
      {placement.kind === "unplaced" && (
        <SettingsNote tone="warning">
          This division isn't part of the document yet.
          {placement.parentXmlId === null &&
            " Place it at the end of the document, or paste its embed code where it belongs."}
        </SettingsNote>
      )}
      <SettingsActions actions={actions} />
    </div>
  );
};

export default DivisionSettings;
