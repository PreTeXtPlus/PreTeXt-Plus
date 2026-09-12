import { useRef } from "react";
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

const FIELD_LABEL_CLASSES =
  "grid grid-cols-[52px_1fr] items-center gap-1 text-[0.76rem] text-[#555]";
const FIELD_LABEL_TEXT_CLASSES = "font-semibold whitespace-nowrap";
const FIELD_CONTROL_CLASSES =
  "font-[inherit] text-[0.8rem] border border-indigo-300 rounded-[3px] py-0.5 px-[5px] bg-white outline-none text-[#111] w-full box-border focus:border-blue-600 focus:shadow-[0_0_0_2px_rgba(37,99,235,0.15)]";
const ACTION_BTN_CLASSES =
  "font-[inherit] text-[0.76rem] py-[3px] px-2.5 rounded cursor-pointer border whitespace-nowrap";

export interface EditFormProps {
  draft: EditDraft;
  /**
   * True only while creating a brand-new, not-yet-saved record. Only then can
   * a division choose its source format, or an asset choose how it will be
   * sourced (upload/URL/authored) — every other field is editable on an
   * existing record too.
   */
  isNew?: boolean;
  /** Division only: the root division's Type dropdown offers article/book instead of the parent-restricted list, since it has no parent. */
  isRoot?: boolean;
  /** Division only: the type of the division this one is (or would be) nested under; `null` if unplaced. Determines which types are offered below. */
  parentType?: DivisionType | null;
  onDraftChange: (draft: EditDraft) => void;
  onCommit: () => void;
  onCancel: () => void;
  /** Asset/snippet, existing only: the copyable embed code for this ref. */
  embedCode?: string;
  onCopyEmbed?: () => void;
  copied?: boolean;
  /** Asset, existing only: begin replacing this asset's file. Hidden when omitted. */
  onReplace?: () => void;
  /** Asset/snippet, existing only: duplicate this record under a fresh ref. Hidden when omitted. */
  onDuplicate?: () => void;
  duplicating?: boolean;
}

const EditForm = ({
  draft,
  isNew = false,
  isRoot = false,
  parentType = null,
  onDraftChange,
  onCommit,
  onCancel,
  embedCode,
  onCopyEmbed,
  copied = false,
  onReplace,
  onDuplicate,
  duplicating = false,
}: EditFormProps) => {
  // A record being drafted starts with an id/ref derived from its placeholder
  // title, and keeps following the title as the author types it (division
  // only — an asset/snippet has no title-derived ref convention). Edit the
  // Id field once and it's theirs: we stop overwriting it.
  const idFollowsTitle = useRef(isNew && draft.kind === "division");

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onCommit();
    if (e.key === "Escape") onCancel();
  };

  const embedRow = (embedCode !== undefined || onDuplicate || onReplace) && (
    <div className="flex flex-col gap-1 mt-0.5">
      {embedCode !== undefined && (
        <div className="flex items-center gap-1.5">
          <code className="flex-1 min-w-0 font-mono text-[0.72rem] text-slate-900 bg-white border border-indigo-200 rounded py-0.5 px-1.5 overflow-x-auto whitespace-nowrap">
            {embedCode}
          </code>
          <button
            type="button"
            className={`${ACTION_BTN_CLASSES} ${
              copied
                ? "text-emerald-600 border-emerald-300 bg-emerald-50"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            }`}
            onClick={onCopyEmbed}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}
      {(onReplace || onDuplicate) && (
        <div className="flex gap-1.5">
          {onReplace && (
            <button
              type="button"
              className={`${ACTION_BTN_CLASSES} border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}
              onClick={onReplace}
            >
              Replace…
            </button>
          )}
          {onDuplicate && (
            <button
              type="button"
              className={`${ACTION_BTN_CLASSES} border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}
              onClick={onDuplicate}
              disabled={duplicating}
            >
              {duplicating ? "Duplicating…" : "Duplicate"}
            </button>
          )}
        </div>
      )}
    </div>
  );

  const fields = (() => {
    if (draft.kind === "division") {
      const selectableTypes = getSelectableDivisionTypes(parentType, draft.type);
      // The root's own type dropdown offers article/book, the two root
      // elements that can be freely swapped: they hold the same children, so
      // switching leaves the document valid.
      //
      // A root type outside that set (a slideshow) is offered as the *only*
      // option, not prepended to the switchable ones — a deck's <slide>s are
      // illegal in an article, so converting is a rewrite of the document,
      // not a change of one tag.
      const rootTypeOptions = SWITCHABLE_ROOT_TYPES.includes(draft.type)
        ? SWITCHABLE_ROOT_TYPES
        : [draft.type];
      const typeOptions = isRoot ? rootTypeOptions : selectableTypes;

      return (
        <>
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
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </label>
          {/* Source format can only be chosen while the division is new
              (unsaved) — an existing division's source can't be losslessly
              translated between formats, so it's shown read-only once saved. */}
          {isNew && (
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
          )}
          {/* Type applies to every format: a LaTeX `\section` can still be
              authored as any division type — the type is applied when its
              conversion is tagged, not stored in the LaTeX source. */}
          <label className={FIELD_LABEL_CLASSES}>
            <span className={FIELD_LABEL_TEXT_CLASSES}>Type</span>
            <select
              className={FIELD_CONTROL_CLASSES}
              value={draft.type}
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
              onKeyDown={handleKeyDown}
            />
          </label>
        </>
      );
    }

    if (draft.kind === "asset") {
      return (
        <>
          <label className={FIELD_LABEL_CLASSES}>
            <span className={FIELD_LABEL_TEXT_CLASSES}>Title</span>
            <input
              className={FIELD_CONTROL_CLASSES}
              type="text"
              value={draft.title}
              onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </label>
          <label className={FIELD_LABEL_CLASSES}>
            <span className={FIELD_LABEL_TEXT_CLASSES}>Id</span>
            <input
              className={FIELD_CONTROL_CLASSES}
              type="text"
              value={draft.ref}
              placeholder="unique identifier"
              onChange={(e) => onDraftChange({ ...draft, ref: e.target.value })}
              onKeyDown={handleKeyDown}
            />
          </label>
          <label className={FIELD_LABEL_CLASSES}>
            <span className={FIELD_LABEL_TEXT_CLASSES}>Alt text</span>
            <input
              className={FIELD_CONTROL_CLASSES}
              type="text"
              value={draft.shortDescription}
              placeholder="short description"
              onChange={(e) =>
                onDraftChange({ ...draft, shortDescription: e.target.value })
              }
              onKeyDown={handleKeyDown}
            />
          </label>
          {isNew && (
            <>
              <div className="flex gap-1.5 mt-0.5">
                {(["upload", "url", "authored"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={`${ACTION_BTN_CLASSES} ${
                      draft.sourceKind === kind
                        ? "bg-blue-600 text-white border-blue-700"
                        : "bg-white text-[#555] border-[#ccc] hover:bg-slate-100"
                    }`}
                    onClick={() => onDraftChange({ ...draft, sourceKind: kind })}
                  >
                    {kind === "upload" ? "Upload" : kind === "url" ? "URL" : "Authored"}
                  </button>
                ))}
              </div>
              {draft.sourceKind === "upload" && (
                <label className={FIELD_LABEL_CLASSES}>
                  <span className={FIELD_LABEL_TEXT_CLASSES}>File</span>
                  <input
                    className={FIELD_CONTROL_CLASSES}
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      onDraftChange({ ...draft, pendingFile: e.target.files?.[0] })
                    }
                  />
                </label>
              )}
              {draft.sourceKind === "url" && (
                <label className={FIELD_LABEL_CLASSES}>
                  <span className={FIELD_LABEL_TEXT_CLASSES}>URL</span>
                  <input
                    className={FIELD_CONTROL_CLASSES}
                    type="url"
                    placeholder="https://example.com/image.png"
                    value={draft.pendingUrl ?? ""}
                    onChange={(e) =>
                      onDraftChange({ ...draft, pendingUrl: e.target.value })
                    }
                    onKeyDown={handleKeyDown}
                  />
                </label>
              )}
            </>
          )}
        </>
      );
    }

    // draft.kind === "snippet"
    return (
      <>
        <label className={FIELD_LABEL_CLASSES}>
          <span className={FIELD_LABEL_TEXT_CLASSES}>Id</span>
          <input
            className={FIELD_CONTROL_CLASSES}
            type="text"
            value={draft.ref}
            placeholder="unique identifier"
            onChange={(e) => onDraftChange({ ...draft, ref: e.target.value })}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </label>
        <label className={FIELD_LABEL_CLASSES}>
          <span className={FIELD_LABEL_TEXT_CLASSES}>Format</span>
          <select
            className={FIELD_CONTROL_CLASSES}
            value={draft.sourceFormat}
            onChange={(e) =>
              onDraftChange({ ...draft, sourceFormat: e.target.value as SourceFormat })
            }
          >
            {(Object.keys(SOURCE_FORMAT_LABELS) as SourceFormat[]).map((f) => (
              <option key={f} value={f}>
                {SOURCE_FORMAT_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
      </>
    );
  })();

  // A new file asset has nothing to create yet until a file/URL is actually
  // staged — Save would otherwise silently close the draft without creating
  // anything (`Editors.tsx`'s `handleAssetCreate` no-ops when it has neither).
  const missingRequiredNewAssetSource =
    isNew &&
    draft.kind === "asset" &&
    ((draft.sourceKind === "upload" && !draft.pendingFile) ||
      (draft.sourceKind === "url" && !draft.pendingUrl?.trim()));

  return (
    <div className="flex flex-col gap-1.5 py-2 px-2 pl-2.5 bg-indigo-50 border-t border-indigo-200">
      {fields}
      {!isNew && embedRow}
      <div className="flex gap-1.5 mt-0.5">
        <button
          type="button"
          className={`${ACTION_BTN_CLASSES} bg-blue-600 text-white border-blue-700 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed`}
          onClick={onCommit}
          disabled={missingRequiredNewAssetSource}
        >
          Save
        </button>
        <button
          type="button"
          className={`${ACTION_BTN_CLASSES} bg-white text-[#555] border-[#ccc] hover:bg-slate-100 hover:border-[#999]`}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default EditForm;
