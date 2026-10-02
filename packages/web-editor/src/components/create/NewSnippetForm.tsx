import { useId, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import type { Snippet, SourceFormat } from "../../types/editor";
import { sanitizeXmlId } from "../../sectionUtils";
import { useEditorStore } from "../../store/hooks";
import { SOURCE_FORMAT_LABELS } from "../toc/types";
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
  onCreate?: (ref: string, sourceFormat: SourceFormat) => Promise<Snippet>;
  /** The snippet now exists — see `NewItemPane`. */
  onCreated: (snippet: Snippet) => void;
  onCancel: () => void;
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
 * The creation form for a project snippet: its reference id and source
 * format. Its source is written afterwards, in the code editor it opens in.
 */
const NewSnippetForm = ({
  resolveRef,
  onCreate,
  onCreated,
  onCancel,
}: NewSnippetFormProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const projectSnippets = useEditorStore((s) => s.projectSnippets);
  const projectAssets = useEditorStore((s) => s.projectAssets);

  const [ref, setRef] = useState(resolveRef ?? "");
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>("pretext");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const fieldId = useId();

  const handleCreate = async () => {
    if (isCreating) return;
    const sanitized = sanitizeXmlId(ref);
    if (!sanitized) {
      setError("Reference can't be empty.");
      return;
    }
    // A snippet's ref must not collide with a division's xml:id, an asset's
    // ref, or another snippet's ref.
    const taken = new Set<string>([
      ...(divisions ?? []).map((d) => d.xmlId),
      ...(projectAssets ?? []).map((a) => a.ref).filter((r): r is string => !!r),
      ...(projectSnippets ?? []).map((s) => s.ref),
    ]);
    if (taken.has(sanitized)) {
      setError(`Reference "${sanitized}" is already in use. Choose a unique reference.`);
      return;
    }
    setError(null);
    if (!onCreate) {
      onCreated({ id: localSnippetId(), ref: sanitized, source: "", sourceFormat });
      return;
    }
    setIsCreating(true);
    try {
      onCreated(await onCreate(sanitized, sourceFormat));
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
      <SettingsField label="Reference id" htmlFor={`${fieldId}-ref`}>
        <input
          id={`${fieldId}-ref`}
          className={clsx(FIELD_CONTROL_CLASSES, "font-mono")}
          type="text"
          value={ref}
          placeholder="my-snippet"
          onChange={(e) => setRef(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isCreating}
          autoFocus
        />
        {resolveRef && (
          <SettingsNote>
            Placeholders for <code>{resolveRef}</code> will point at this
            snippet{ref.trim() && sanitizeXmlId(ref) !== resolveRef
              ? `, renamed to ${sanitizeXmlId(ref)}`
              : ""}.
          </SettingsNote>
        )}
      </SettingsField>
      <SettingsField label="Source format" htmlFor={`${fieldId}-format`}>
        <select
          id={`${fieldId}-format`}
          className={clsx(FIELD_CONTROL_CLASSES, "max-w-[200px]")}
          value={sourceFormat}
          onChange={(e) => setSourceFormat(e.target.value as SourceFormat)}
          disabled={isCreating}
        >
          {(Object.keys(SOURCE_FORMAT_LABELS) as SourceFormat[]).map((f) => (
            <option key={f} value={f}>
              {SOURCE_FORMAT_LABELS[f]}
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
