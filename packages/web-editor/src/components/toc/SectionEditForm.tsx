import { useRef } from "react";
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

const FIELD_LABEL_CLASSES =
  "grid grid-cols-[52px_1fr] items-center gap-1 text-[0.76rem] text-[#555]";
const FIELD_LABEL_TEXT_CLASSES = "font-semibold whitespace-nowrap";
const FIELD_CONTROL_CLASSES =
  "font-[inherit] text-[0.8rem] border border-indigo-300 rounded-[3px] py-0.5 px-[5px] bg-white outline-none text-[#111] w-full box-border focus:border-blue-600 focus:shadow-[0_0_0_2px_rgba(37,99,235,0.15)]";

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

  // A brand-new division starts with an opaque generated id (e.g.
  // "sec-m5x2k9-a3f8z1"). Until the author edits the Id field directly, keep
  // it in sync with the title they're typing instead — far more useful than
  // a random string. Edit the Id field once and it's theirs: we stop
  // overwriting it. Only relevant for `isNew`; an existing division's id is
  // never auto-derived from its title.
  const idFollowsTitle = useRef(isNew);

  return (
  <div className="flex flex-col gap-1.5 py-2 px-2 pl-2.5 bg-indigo-50 border-t border-indigo-200">
    <label className={FIELD_LABEL_CLASSES}>
      <span className={FIELD_LABEL_TEXT_CLASSES}>Title</span>
      <input
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
      <label className={FIELD_LABEL_CLASSES}>
        <span className={FIELD_LABEL_TEXT_CLASSES}>Format</span>
        <select
          className={FIELD_CONTROL_CLASSES}
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
    <label className={FIELD_LABEL_CLASSES}>
      <span className={FIELD_LABEL_TEXT_CLASSES}>Type</span>
      <select
        className={FIELD_CONTROL_CLASSES}
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
    </label>
    {/* xml:id applies to every format — for LaTeX it's written as the
        `\section`'s `\label`. */}
    <label className={FIELD_LABEL_CLASSES}>
      <span className={FIELD_LABEL_TEXT_CLASSES}>Id</span>
      <input
        className={FIELD_CONTROL_CLASSES}
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
    <div className="flex gap-1.5 mt-0.5">
      <button
        type="button"
        className="font-[inherit] text-[0.76rem] py-[3px] px-2.5 rounded cursor-pointer bg-blue-600 text-white border border-blue-700 hover:bg-blue-700"
        onClick={onCommit}
      >
        Save
      </button>
      <button
        type="button"
        className="font-[inherit] text-[0.76rem] py-[3px] px-2.5 rounded cursor-pointer bg-white text-[#555] border border-[#ccc] hover:bg-slate-100 hover:border-[#999]"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  </div>
  );
};

export default SectionEditForm;
