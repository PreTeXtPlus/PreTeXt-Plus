import clsx from "clsx";
import type { Division, DivisionType } from "../../types/sections";
import type { SourceFormat } from "../../types/editor";
import { divisionRefTag } from "../../sectionUtils";
import { useEditorStore } from "../../store/hooks";
import {
  divisionSourceXmlId,
  divisionTypeOptions,
  TYPE_FULL_LABELS,
} from "../toc/types";
import { useDivisionActions } from "../toc/useDivisionActions";
import {
  divisionActionEntries,
  findDivisionPlacement,
} from "../toc/divisionActions";
import {
  CommitField,
  EmbedCode,
  FIELD_CONTROL_CLASSES,
  SettingsActions,
  SettingsField,
  SettingsNote,
} from "./settingsUi";

export interface DivisionSettingsProps {
  division: Division;
  /** Default format for the embed-code picker — the root division's. */
  embedFormat: SourceFormat;
}

/**
 * A division's settings: its title, type and id — each saved on its own, on
 * Enter or blur (a select on change), like a snippet's or asset's fields — its
 * embed code, and the structural actions its place in the document allows.
 * (A new sub-division is started from the division's Contents row [+].)
 */
const DivisionSettings = ({ division, embedFormat }: DivisionSettingsProps) => {
  const updateDivisionProperties = useEditorStore(
    (s) => s.updateDivisionProperties,
  );
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

  // Unplaced, "Place in document" puts it directly under the root, so the
  // root's rules are the ones that apply — an article project never offers
  // Part/Chapter.
  const typeOptions = divisionTypeOptions(division.type, {
    isRoot: placement.kind === "root",
    parentType:
      placement.kind === "root"
        ? null
        : getDivisionType(placement.parentXmlId ?? rootDivision?.xmlId ?? null),
  });

  const commitTitle = (next: string): string | void => {
    const title = next.trim();
    if (!title) return "Enter a title, or press Escape to keep the current one.";
    if (title !== division.title) {
      return updateDivisionProperties(division.xmlId, { title });
    }
  };

  const actions = divisionActionEntries(division, placement, {
    unplace: handleUnplace,
    remove: handleDelete,
    placeInDocument: handlePlaceOrphan,
  });

  return (
    <div className="flex flex-col gap-2.5">
      <SettingsField label="Title" htmlFor="division-settings-title">
        <CommitField
          id="division-settings-title"
          value={division.title}
          onCommit={commitTitle}
          autoSelect
        />
      </SettingsField>
      {/* Type applies to every format: a LaTeX `\section` can still be
          authored as any division type — the type is applied when its
          conversion is tagged, not stored in the LaTeX source. For the root,
          this switches the document's own wrapper element (e.g. <article> to
          <book>); it doesn't touch any existing children, so their types may
          need a follow-up edit to stay valid under the new root. */}
      <SettingsField label="Type" htmlFor="division-settings-type">
        <select
          id="division-settings-type"
          className={clsx(FIELD_CONTROL_CLASSES, "max-w-[200px]")}
          value={division.type}
          // Nothing to choose: a slideshow root has no legal switch target, so
          // an enabled control would only offer the type it already is.
          disabled={typeOptions.length < 2}
          onChange={(e) =>
            updateDivisionProperties(division.xmlId, {
              type: e.target.value as DivisionType,
            })
          }
        >
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {TYPE_FULL_LABELS[t]}
            </option>
          ))}
        </select>
      </SettingsField>
      {/* xml:id applies to every format — for LaTeX it's written as the
          `\section`'s `\label`. */}
      <SettingsField label="Id" htmlFor="division-settings-id">
        <CommitField
          id="division-settings-id"
          value={divisionSourceXmlId(division)}
          onCommit={(next) => updateDivisionProperties(division.xmlId, { xmlId: next })}
          placeholder="unique identifier"
          mono
        />
        {placement.kind !== "root" && (
          <SettingsNote>
            Used in the embed code. Changing it updates every reference to this
            division already in your document.
          </SettingsNote>
        )}
      </SettingsField>
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
