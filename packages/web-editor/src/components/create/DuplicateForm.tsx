import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import type { OpenItem } from "../../store/editorStore";
import { useEditorStore, useTakenRefs } from "../../store/hooks";
import { sanitizeXmlId, slugifyTitle, uniqueRef } from "../../sectionUtils";
import { ID_REQUIRED_MESSAGE, idTakenMessage } from "../../idRules";
import { copySource, copyTitle, projectXmlIds } from "../../duplicate";
import { generatorFor } from "../../generators";
import { FIELD_CONTROL_CLASSES, SettingsButton, SettingsField, SettingsNote } from "../settings/settingsUi";

/** What the author settled on for the copy, and the source it starts with. */
export interface DuplicateFields {
  ref: string;
  title: string;
  source: string;
}

export interface DuplicateFormProps {
  /** The item being copied. */
  of: OpenItem;
  /**
   * Make the copy. Rejects with the host's error, which the form shows; on
   * success the copy is opened, which closes the form.
   */
  onDuplicate: (fields: DuplicateFields) => Promise<void>;
  onCancel: () => void;
  /** Told when a request to the host starts and settles. */
  onBusyChange?: (busy: boolean) => void;
}

/** The record `of` names, reduced to what a copy is made from. */
interface Original {
  ref: string;
  title: string;
  source: string;
  sourceFormat: string | undefined;
  /** A title is required (a division's), or falls back to the ref. */
  titleRequired: boolean;
  /** What the copy keeps that the form doesn't show, for the note. */
  note: string;
}

const NOT_PLACED =
  "The copy isn't used in the document yet: paste its embed code, from its settings, where it belongs.";

/**
 * The form that duplicates a division, snippet, exercise or asset: a title and
 * an ID for the copy, suggested from the original's until the author edits
 * them. Everything else — its type or format, its attributes, its source — is
 * the original's. Nothing exists until it is submitted.
 */
const DuplicateForm = ({ of, onDuplicate, onCancel, onBusyChange }: DuplicateFormProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const snippets = useEditorStore((s) => s.projectSnippets);
  const exercises = useEditorStore((s) => s.projectExercises);
  const assets = useEditorStore((s) => s.projectAssets);
  const takenRefs = useTakenRefs();

  const original = useMemo((): Original | null => {
    switch (of.kind) {
      case "division": {
        const d = divisions?.find((x) => x.xmlId === of.ref);
        return d
          ? {
            ref: d.xmlId,
            title: d.title,
            source: d.source,
            sourceFormat: d.sourceFormat,
            titleRequired: true,
            note: "The copy is placed right after the original, wherever the original is placed.",
          }
          : null;
      }
      case "snippet": {
        const s = snippets?.find((x) => x.ref === of.ref);
        return s
          ? { ref: s.ref, title: s.title ?? "", source: s.source, sourceFormat: s.sourceFormat, titleRequired: false, note: NOT_PLACED }
          : null;
      }
      case "exercise": {
        const e = exercises?.find((x) => x.ref === of.ref);
        return e
          ? { ref: e.ref, title: e.title ?? "", source: e.source, sourceFormat: e.sourceFormat, titleRequired: false, note: NOT_PLACED }
          : null;
      }
      case "asset": {
        const a = assets?.find((x) => x.ref === of.ref);
        if (!a?.ref) return null;
        const generator = generatorFor(a.sourceFormat);
        return {
          ref: a.ref,
          title: a.title,
          source: a.source ?? "",
          sourceFormat: a.sourceFormat,
          titleRequired: false,
          note: generator
            ? `The copy starts with the same ${generator.label} source; its picture is drawn again from it. ${NOT_PLACED}`
            : a.isFile
              ? `The copy gets its own copy of the image file. ${NOT_PLACED}`
              : NOT_PLACED,
        };
      }
    }
  }, [of, divisions, snippets, exercises, assets]);

  const [title, setTitle] = useState(() => copyTitle(original?.title));
  const [titleEdited, setTitleEdited] = useState(false);
  // Suggested until the author edits it, and theirs from then on, even blank:
  // `null` means "still following the suggestion". Until the title is edited
  // the suggestion is the original's ref, numbered (`graph` → `graph-2`);
  // after, it follows the title, as a new item's does.
  const [editedRef, setEditedRef] = useState<string | null>(null);
  const suggestedRef = original
    ? titleEdited && slugifyTitle(title)
      ? uniqueRef(slugifyTitle(title), takenRefs)
      : uniqueRef(original.ref, takenRefs)
    : "";
  const ref = editedRef ?? suggestedRef;
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const fieldId = useId();

  useEffect(() => {
    onBusyChange?.(isCreating);
  }, [isCreating, onBusyChange]);

  // The ids inside the source that the copy has to rename, shown before it is
  // made and applied when it is: the same pass either way.
  const sanitizedRef = sanitizeXmlId(ref);
  const copied = useMemo(() => {
    if (!original) return null;
    const taken = projectXmlIds({
      divisions,
      projectAssets: assets,
      projectSnippets: snippets,
      projectExercises: exercises,
    });
    return copySource(original.source, original.sourceFormat, taken, sanitizedRef);
  }, [original, sanitizedRef, divisions, assets, snippets, exercises]);

  if (!original || !copied) {
    return (
      <div className="flex flex-col gap-2.5" data-testid="duplicate-form">
        <SettingsNote tone="error">
          <code>{of.ref}</code> no longer exists, so there is nothing to copy.
        </SettingsNote>
        <div className="flex gap-1.5">
          <SettingsButton onClick={onCancel}>Close</SettingsButton>
        </div>
      </div>
    );
  }

  const handleCreate = async () => {
    if (isCreating) return;
    if (!sanitizedRef) {
      setError(ID_REQUIRED_MESSAGE);
      return;
    }
    if (takenRefs.has(sanitizedRef)) {
      setError(idTakenMessage(sanitizedRef));
      return;
    }
    const trimmedTitle = title.trim();
    if (original.titleRequired && !trimmedTitle) {
      setError("Enter a title for the copy.");
      return;
    }
    setError(null);
    setIsCreating(true);
    try {
      await onDuplicate({
        ref: sanitizedRef,
        // An asset is always shown by a title, so a blank one is its ref.
        title: trimmedTitle || (of.kind === "asset" ? sanitizedRef : ""),
        source: copied.source,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to make the copy.");
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") void handleCreate();
  };

  return (
    <div className="flex flex-col gap-2.5" data-testid="duplicate-form">
      <SettingsField label="Title" htmlFor={`${fieldId}-title`}>
        <input
          id={`${fieldId}-title`}
          className={FIELD_CONTROL_CLASSES}
          type="text"
          value={title}
          placeholder={original.title || original.ref}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleEdited(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={(e) => e.currentTarget.select()}
          disabled={isCreating}
          autoFocus
        />
      </SettingsField>
      <SettingsField label="ID" htmlFor={`${fieldId}-ref`}>
        <input
          id={`${fieldId}-ref`}
          className={clsx(FIELD_CONTROL_CLASSES, "font-mono")}
          type="text"
          value={ref}
          placeholder={suggestedRef}
          onChange={(e) => setEditedRef(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isCreating}
        />
      </SettingsField>
      <SettingsNote>{original.note}</SettingsNote>
      {copied.renamed.length > 0 && (
        <SettingsNote>
          IDs inside the copy that the project already uses will be renamed:{" "}
          {copied.renamed.map((r, i) => (
            <span key={r.from}>
              {i > 0 && ", "}
              <code>{r.from}</code> → <code>{r.to}</code>
            </span>
          ))}
          .
        </SettingsNote>
      )}
      {error && (
        <div role="alert">
          <SettingsNote tone="error">{error}</SettingsNote>
        </div>
      )}
      <div className="flex gap-1.5">
        <SettingsButton variant="primary" onClick={() => void handleCreate()} disabled={isCreating}>
          {isCreating ? "Duplicating…" : "Duplicate"}
        </SettingsButton>
        <SettingsButton onClick={onCancel} disabled={isCreating}>
          Cancel
        </SettingsButton>
      </div>
    </div>
  );
};

export default DuplicateForm;
