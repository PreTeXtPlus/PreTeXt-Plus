import { useEffect, useId, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import type { Snippet, SnippetSourceFormat } from "../../types/editor";
import { sanitizeXmlId, slugifyTitle, uniqueRef } from "../../sectionUtils";
import { useTakenRefs } from "../../store/hooks";
import { ID_REQUIRED_MESSAGE, idTakenMessage } from "../../idRules";
import { SNIPPET_FORMAT_LABELS } from "../toc/types";
import {
  FIELD_CONTROL_CLASSES,
  SettingsButton,
  SettingsField,
  SettingsNote,
} from "../settings/settingsUi";

export interface NewSnippetFormProps {
  /** The unlinked placeholder ref this snippet will bind, if resolving one. */
  resolveRef?: string;
  /**
   * Persist the new, empty snippet; the host returns the created record and
   * has the final say on ref uniqueness. Without one, the snippet is created
   * locally (no-host demos and tests).
   */
  onCreate?: (ref: string, sourceFormat: SnippetSourceFormat, title: string) => Promise<Snippet>;
  /** The snippet now exists — see `NewItemPane`. */
  onCreated: (snippet: Snippet) => void;
  onCancel: () => void;  /** Told when a request to the host starts and settles. */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * A throwaway client-side id for a snippet created with no host to mint one.
 * At module scope so its impure `Date.now()` isn't flagged by the React
 * Compiler's purity check for component-body code.
 */
function localSnippetId(): string {
  return `snippet-${Date.now()}`;
}

/**
 * The creation form for a project snippet: its title (optional), reference id
 * and source format. Its source is written afterwards, in the code editor it opens in.
 */
const NewSnippetForm = ({
  resolveRef,
  onCreate,
  onCreated,
  onCancel,
  onBusyChange,
}: NewSnippetFormProps) => {
  const takenRefs = useTakenRefs();

  const [title, setTitle] = useState("");
  // Suggested from the title until the author edits it, and theirs from then
  // on, even blank: `null` means "still following the suggestion".
  const [editedRef, setEditedRef] = useState<string | null>(resolveRef ?? null);
  const ref =
    editedRef ?? (title.trim() ? uniqueRef(slugifyTitle(title) || "snippet", takenRefs) : "");
  const [sourceFormat, setSourceFormat] = useState<SnippetSourceFormat>("pretext");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const fieldId = useId();

  useEffect(() => {
    onBusyChange?.(isCreating);
  }, [isCreating, onBusyChange]);

  const handleCreate = async () => {
    if (isCreating) return;
    const sanitized = sanitizeXmlId(ref);
    if (!sanitized) {
      setError(ID_REQUIRED_MESSAGE);
      return;
    }
    if (takenRefs.has(sanitized)) {
      setError(idTakenMessage(sanitized));
      return;
    }
    setError(null);
    const trimmedTitle = title.trim();
    if (!onCreate) {
      onCreated({ id: localSnippetId(), ref: sanitized, title: trimmedTitle, source: "", sourceFormat });
      return;
    }
    setIsCreating(true);
    try {
      onCreated(await onCreate(sanitized, sourceFormat, trimmedTitle));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create snippet.");
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") void handleCreate();
  };

  return (
    <div className="flex flex-col gap-2.5" data-testid="new-snippet-form">
      <SettingsField label="Title" htmlFor={`${fieldId}-title`}>
        <input
          id={`${fieldId}-title`}
          className={FIELD_CONTROL_CLASSES}
          type="text"
          value={title}
          placeholder="My snippet"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
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
          placeholder="my-snippet"
          onChange={(e) => setEditedRef(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isCreating}
        />
        {resolveRef && (
          <SettingsNote>
            Every place the document uses <code>{resolveRef}</code> will use
            this snippet{ref.trim() && sanitizeXmlId(ref) !== resolveRef
              ? ` (renamed to ${sanitizeXmlId(ref)})`
              : ""}.
          </SettingsNote>
        )}
      </SettingsField>
      <SettingsField label="Source format" htmlFor={`${fieldId}-format`}>
        <select
          id={`${fieldId}-format`}
          className={clsx(FIELD_CONTROL_CLASSES, "max-w-[200px]")}
          value={sourceFormat}
          onChange={(e) => setSourceFormat(e.target.value as SnippetSourceFormat)}
          disabled={isCreating}
        >
          {(Object.keys(SNIPPET_FORMAT_LABELS) as SnippetSourceFormat[]).map((f) => (
            <option key={f} value={f}>
              {SNIPPET_FORMAT_LABELS[f]}
            </option>
          ))}
        </select>
      </SettingsField>
      {error && (
        <div role="alert">
          <SettingsNote tone="error">{error}</SettingsNote>
        </div>
      )}
      <div className="flex gap-1.5">
        <SettingsButton
          variant="primary"
          onClick={() => void handleCreate()}
          disabled={isCreating}
        >
          {isCreating ? "Creating…" : "Create"}
        </SettingsButton>
        <SettingsButton onClick={onCancel} disabled={isCreating}>
          Cancel
        </SettingsButton>
      </div>
    </div>
  );
};

export default NewSnippetForm;
