import { useEffect, useRef } from "react";
import type { SourceFormat } from "../../types/editor";
import type { DivisionType } from "../../types/sections";
import { slugifyTitle } from "../../sectionUtils";
import {
  DIVISION_ID_PREFIXES,
  type EditDraft,
  getSelectableDivisionTypes,
  SOURCE_FORMAT_LABELS,
  SWITCHABLE_ROOT_TYPES,
  TYPE_FULL_LABELS,
} from "./types";

/** `<type-abbrev>-<title-slug>`, e.g. "ws-my-title" for a new worksheet. */
function deriveXmlId(type: DivisionType, title: string): string {
  const prefix = DIVISION_ID_PREFIXES[type] ?? "sec";
  const slug = slugifyTitle(title);
  return slug ? `${prefix}-${slug}` : prefix;
}

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
  const selectableTypes = getSelectableDivisionTypes(parentType);

  // The root's own type dropdown offers article/book (the only two switch
  // targets so far) plus its current type when that's something else (e.g. a
  // pre-existing slideshow) — so the <select> always has a matching <option>
  // and never silently mismatches what's actually stored (see the
  // stale-`draft.type` note on the effect below).
  const rootTypeOptions = SWITCHABLE_ROOT_TYPES.includes(draft.type)
    ? SWITCHABLE_ROOT_TYPES
    : [draft.type, ...SWITCHABLE_ROOT_TYPES];

  // A brand-new division starts with an opaque generated id (e.g.
  // "sec-m5x2k9-a3f8z1"). Until the author edits the Id field directly, keep
  // it in sync with the title they're typing instead — far more useful than
  // a random string. Edit the Id field once and it's theirs: we stop
  // overwriting it. Only relevant for `isNew`; an existing division's id is
  // never auto-derived from its title.
  const idFollowsTitle = useRef(isNew);

  // If the parent's type changed (or this is an existing division whose type
  // no longer fits its parent) the current draft type may not be one of the
  // options below — the <select> can't reflect that (there's no matching
  // <option>), so the browser silently displays the first option while
  // `draft.type` is left stale. Snap the draft to a valid type so what's
  // displayed always matches what Save will persist. The root has no parent
  // to fall out of sync with — its own `rootTypeOptions` above already grows
  // to include whatever it currently is, so it never needs this snap.
  useEffect(() => {
    if (isRoot) return;
    if (selectableTypes.length > 0 && !selectableTypes.includes(draft.type)) {
      onDraftChange({ ...draft, type: selectableTypes[0] });
    }
  }, [draft, isRoot, onDraftChange, selectableTypes]);

  return (
  <div className="pretext-plus-editor__toc-edit-form">
    <label className="pretext-plus-editor__toc-edit-field">
      <span>Title</span>
      <input
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
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          if (e.key === "Escape") onCancel();
        }}
        autoFocus
      />
    </label>
    {/* Source format can only be chosen while the division is new (unsaved) —
        an existing division's source can't be losslessly translated between
        formats, so it's shown read-only once saved. */}
    {isNew ? (
      <label className="pretext-plus-editor__toc-edit-field">
        <span>Format</span>
        <select
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
      </label>
    ): undefined}
    {/* Type applies to every format: a LaTeX `\section` can still be authored
        as any division type — the type is applied when its conversion is
        tagged, not stored in the LaTeX source. For the root, this switches
        the document's own wrapper element (e.g. <article> to <book>); it
        doesn't touch any existing children, so their types may need a
        follow-up edit to stay valid under the new root. */}
    <label className="pretext-plus-editor__toc-edit-field">
      <span>Type</span>
      <select
        value={draft.type}
        onChange={(e) => {
          const type = e.target.value as DivisionType;
          onDraftChange(
            idFollowsTitle.current
              ? { ...draft, type, xmlId: deriveXmlId(type, draft.title) }
              : { ...draft, type },
          );
        }}
      >
        {(isRoot ? rootTypeOptions : selectableTypes).map((t) => (
          <option key={t} value={t}>
            {TYPE_FULL_LABELS[t]}
          </option>
        ))}
      </select>
    </label>
    {/* xml:id applies to every format — for LaTeX it's written as the
        `\section`'s `\label`. */}
    <label className="pretext-plus-editor__toc-edit-field">
      <span>Id</span>
      <input
        type="text"
        value={draft.xmlId}
        placeholder="unique identifier"
        onChange={(e) => {
          idFollowsTitle.current = false;
          onDraftChange({ ...draft, xmlId: e.target.value });
        }}
      />
    </label>
    {/* LaTeX has no representation for PreTeXt's separate `label` attribute. */}
    <div className="pretext-plus-editor__toc-edit-actions">
      <button
        type="button"
        className="pretext-plus-editor__toc-edit-save"
        onClick={onCommit}
      >
        Save
      </button>
      <button
        type="button"
        className="pretext-plus-editor__toc-edit-cancel"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  </div>
  );
};

export default SectionEditForm;
