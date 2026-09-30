import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import clsx from "clsx";
import type { SourceFormat } from "../../types/editor";
import type { DivisionType } from "../../types/sections";
import {
  deriveXmlId,
  type EditDraft,
  getSelectableDivisionTypes,
  SOURCE_FORMAT_LABELS,
  SWITCHABLE_ROOT_TYPES,
  TYPE_FULL_LABELS,
} from "./types";
import {
  FIELD_CONTROL_CLASSES,
  SettingsField,
  SettingsNote,
  SettingsButton,
} from "../settings/settingsUi";

interface SectionEditFormProps {
  draft: EditDraft;
  /** True only while editing a division that hasn't been saved yet — only then is `sourceFormat` choosable. */
  isNew?: boolean;
  /** The root division: its Type dropdown offers article/book instead of the parent-restricted list, since it has no parent. */
  isRoot?: boolean;
  /** The type of the division this one is (or would be) nested under; `null` if unplaced. Determines which types are offered below. */
  parentType?: DivisionType | null;
  onDraftChange: (draft: EditDraft) => void;
  onCommit: () => void;
  onCancel: () => void;
}

const SectionEditForm = ({
  draft,
  isNew = false,
  isRoot = false,
  parentType = null,
  onDraftChange,
  onCommit,
  onCancel,
}: SectionEditFormProps) => {
  const selectableTypes = getSelectableDivisionTypes(parentType, draft.type);

  // The root's own type dropdown offers article/book, the two root elements that
  // can be freely swapped: they hold the same children, so switching leaves the
  // document valid.
  //
  // A root type outside that set (a slideshow) is offered as the *only* option,
  // not prepended to the switchable ones. Article and slideshow do not hold the
  // same children — a deck's <slide>s are illegal in an article, and a
  // slideshow's build targets stop existing — so converting is a rewrite of the
  // document, not a change of one tag. Keeping it in the list would present that
  // as a routine choice and produce a document that cannot build. The <select>
  // still always has an <option> matching what's stored, which is the guarantee
  // `getSelectableDivisionTypes` gives every other division.
  const rootTypeOptions = SWITCHABLE_ROOT_TYPES.includes(draft.type)
    ? SWITCHABLE_ROOT_TYPES
    : [draft.type];

  const typeOptions = isRoot ? rootTypeOptions : selectableTypes;

  // A division being drafted starts with an id derived from its placeholder
  // title, and keeps following the title as the author types it. Edit the Id
  // field once and it's theirs: we stop overwriting it. Only relevant for
  // `isNew` — an existing division's id is never auto-derived from its title,
  // since renaming it rewrites every reference to it.
  const idFollowsTitle = useRef(isNew);

  // Open with the title selected, so typing replaces it outright: a rename is
  // the usual reason to open the form, and a new division's title is only a
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
      {/* Source format can only be chosen while the division is new (unsaved) —
          an existing division's source can't be losslessly translated between
          formats. */}
      {isNew && (
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
      )}
      {/* Type applies to every format: a LaTeX `\section` can still be authored
          as any division type — the type is applied when its conversion is
          tagged, not stored in the LaTeX source. For the root, this switches
          the document's own wrapper element (e.g. <article> to <book>); it
          doesn't touch any existing children, so their types may need a
          follow-up edit to stay valid under the new root. */}
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
        {!isNew && !isRoot && (
          <SettingsNote>
            Used in the embed code. Changing it updates every reference to this
            division already in your document.
          </SettingsNote>
        )}
      </SettingsField>
      <div className="flex gap-1.5">
        <SettingsButton variant="primary" onClick={onCommit}>
          Save
        </SettingsButton>
        <SettingsButton onClick={onCancel}>Cancel</SettingsButton>
      </div>
    </div>
  );
};

export default SectionEditForm;
