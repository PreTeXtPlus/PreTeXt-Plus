import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import clsx from "clsx";
import type { SourceFormat } from "../../types/editor";
import type { DivisionType } from "../../types/sections";
import {
  deriveXmlId,
  divisionTypeOptions,
  type EditDraft,
  SOURCE_FORMAT_LABELS,
  TYPE_FULL_LABELS,
} from "./types";
import {
  FIELD_CONTROL_CLASSES,
  SettingsField,
  SettingsButton,
} from "../settings/settingsUi";

interface SectionEditFormProps {
  draft: EditDraft;
  /** The type of the division this one is (or would be) nested under; `null` if unplaced. Determines which types are offered below. */
  parentType?: DivisionType | null;
  onDraftChange: (draft: EditDraft) => void;
  onCommit: () => void;
  onCancel: () => void;
}

/**
 * The properties form for a new, not-yet-created division. Unlike an existing
 * division's fields, which save one at a time, a draft is saved (and the
 * division created) all at once with Create — there is nothing to save a field
 * *to* until then.
 */
const SectionEditForm = ({
  draft,
  parentType = null,
  onDraftChange,
  onCommit,
  onCancel,
}: SectionEditFormProps) => {
  const typeOptions = divisionTypeOptions(draft.type, { parentType });

  // A draft starts with an id derived from its placeholder title, and keeps
  // following the title as the author types it. Edit the Id field once and
  // it's theirs: we stop overwriting it.
  const idFollowsTitle = useRef(true);

  // Open with the title selected, so typing replaces it outright: it's only a
  // placeholder.
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.select();
  }, []);

  // Ties each label to its control; unique per form instance.
  const fieldId = useId();
  // Enter saves and Escape cancels from any text field, as in the other
  // settings panels.
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") onCommit();
    if (e.key === "Escape") onCancel();
  };

  return (
    <div className="flex flex-col gap-2.5">
      <SettingsField label="Title" htmlFor={`${fieldId}-title`}>
        <input
          id={`${fieldId}-title`}
          ref={titleRef}
          className={FIELD_CONTROL_CLASSES}
          type="text"
          value={draft.title}
          onChange={(e) => {
            const title = e.target.value;
            onDraftChange(
              idFollowsTitle.current
                ? { ...draft, title, xmlId: deriveXmlId(draft.type, title) }
                : { ...draft, title },
            );
          }}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      </SettingsField>
      {/* Only a draft chooses its format — an existing division's source can't
          be losslessly translated between formats. */}
      <SettingsField label="Source format" htmlFor={`${fieldId}-format`}>
        <select
          id={`${fieldId}-format`}
          className={clsx(FIELD_CONTROL_CLASSES, "max-w-[200px]")}
          value={draft.sourceFormat}
          onChange={(e) =>
            onDraftChange({
              ...draft,
              sourceFormat: e.target.value as SourceFormat,
            })
          }
        >
          {(Object.keys(SOURCE_FORMAT_LABELS) as SourceFormat[]).map((f) => (
            <option key={f} value={f}>
              {SOURCE_FORMAT_LABELS[f]}
            </option>
          ))}
        </select>
      </SettingsField>
      {/* Type applies to every format: a LaTeX `\section` can still be authored
          as any division type — the type is applied when its conversion is
          tagged, not stored in the LaTeX source. */}
      <SettingsField label="Type" htmlFor={`${fieldId}-type`}>
        <select
          id={`${fieldId}-type`}
          className={clsx(FIELD_CONTROL_CLASSES, "max-w-[200px]")}
          value={draft.type}
          // Nothing to choose: a slideshow root has no legal switch target, so an
          // enabled control would only offer the type it already is.
          disabled={typeOptions.length < 2}
          onChange={(e) => {
            const type = e.target.value as DivisionType;
            onDraftChange(
              idFollowsTitle.current
                ? { ...draft, type, xmlId: deriveXmlId(type, draft.title) }
                : { ...draft, type },
            );
          }}
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
      <SettingsField label="Id" htmlFor={`${fieldId}-id`}>
        <input
          id={`${fieldId}-id`}
          className={clsx(FIELD_CONTROL_CLASSES, "font-mono")}
          type="text"
          value={draft.xmlId}
          placeholder="unique identifier"
          onChange={(e) => {
            idFollowsTitle.current = false;
            onDraftChange({ ...draft, xmlId: e.target.value });
          }}
          onKeyDown={handleKeyDown}
        />
      </SettingsField>
      <div className="flex gap-1.5">
        <SettingsButton variant="primary" onClick={onCommit}>
          Create
        </SettingsButton>
        <SettingsButton onClick={onCancel}>Cancel</SettingsButton>
      </div>
    </div>
  );
};

export default SectionEditForm;
