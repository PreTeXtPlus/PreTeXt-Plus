import { useState } from "react";
import clsx from "clsx";
import type { Snippet, SourceFormat } from "../../types/editor";
import { sanitizeXmlId, snippetEmbedCode } from "../../sectionUtils";
import { buildProjectSnippetView } from "../../snippetView";
import { useEditorStore } from "../../store/hooks";
import { SOURCE_FORMAT_LABELS } from "../toc/types";
import {
  CommitField,
  EmbedCode,
  FIELD_CONTROL_CLASSES,
  SettingsActions,
  SettingsField,
  SettingsNote,
  type SettingsAction,
} from "./settingsUi";

export interface SnippetSettingsProps {
  snippet: Snippet;
  /** Default format for the embed-code picker — the root division's. */
  embedFormat: SourceFormat;
  /**
   * Persist a metadata edit (ref or source format). `prevRef` is the ref before
   * the edit, so the caller can rewrite placeholders when it changed. Rejects
   * with the host's error, which the field shows.
   */
  onSave: (snippet: Snippet, prevRef: string) => Promise<void>;
  readOnly?: boolean;
}

/**
 * A snippet's settings: its id (the ref every embed names), its source format,
 * the embed code, and the project-level actions. Its source is the code editor
 * itself, so there is no content field here.
 */
const SnippetSettings = ({
  snippet,
  embedFormat,
  onSave,
  readOnly,
}: SnippetSettingsProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const projectSnippets = useEditorStore((s) => s.projectSnippets) ?? [];
  const hasSnippetDuplicate = useEditorStore((s) => s.hasSnippetDuplicate);
  const duplicateSnippet = useEditorStore((s) => s.duplicateSnippet);
  const removeSnippet = useEditorStore((s) => s.removeSnippet);
  const removeSnippetRefFromDocument = useEditorStore(
    (s) => s.removeSnippetRefFromDocument,
  );
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const row = buildProjectSnippetView(divisions, projectSnippets).find(
    (r) => r.ref === snippet.ref,
  );
  const inDocument = row?.inDocument ?? false;

  const commitRef = async (next: string): Promise<string | void> => {
    const ref = sanitizeXmlId(next);
    if (!ref) {
      return "The id can't be empty — it identifies the snippet and is used by every embed of it.";
    }
    if (ref === snippet.ref) return;
    if (projectSnippets.some((s) => s.ref === ref)) {
      return `"${ref}" is already used by another snippet. Choose a unique id.`;
    }
    await onSave({ ...snippet, ref }, snippet.ref);
  };

  const changeFormat = async (sourceFormat: SourceFormat) => {
    setError(null);
    try {
      await onSave({ ...snippet, sourceFormat }, snippet.ref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this change.");
    }
  };

  const handleDuplicate = async () => {
    setError(null);
    setIsDuplicating(true);
    try {
      // On success the copy is opened, which unmounts this panel.
      await duplicateSnippet(snippet);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate snippet.");
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleRemove = () => {
    if (
      !window.confirm(
        inDocument
          ? `Remove snippet "${snippet.ref}" from the project? This also deletes its references from the document.`
          : `Remove snippet "${snippet.ref}" from the project?`,
      )
    ) {
      return;
    }
    removeSnippet(snippet);
    removeSnippetRefFromDocument(snippet.ref);
  };

  const actions: SettingsAction[] = readOnly
    ? []
    : [
      ...(hasSnippetDuplicate
        ? [
          {
            label: isDuplicating ? "Duplicating…" : "Duplicate",
            onClick: handleDuplicate,
            disabled: isDuplicating,
            title: "Create a copy of this snippet under a new id",
          },
        ]
        : []),
      { label: "Remove from project", onClick: handleRemove, danger: true },
    ];

  return (
    <div className="flex flex-col gap-2.5">
      <SettingsField label="Id" htmlFor="snippet-settings-ref">
        <CommitField
          id="snippet-settings-ref"
          value={snippet.ref}
          onCommit={commitRef}
          disabled={readOnly}
          mono
        />
        <SettingsNote>
          Used in the embed code. Changing it updates every reference to this
          snippet already in your document.
        </SettingsNote>
      </SettingsField>
      <SettingsField label="Source format" htmlFor="snippet-settings-format">
        <select
          id="snippet-settings-format"
          className={clsx(FIELD_CONTROL_CLASSES, "max-w-[200px]")}
          value={snippet.sourceFormat}
          disabled={readOnly}
          onChange={(e) => void changeFormat(e.target.value as SourceFormat)}
        >
          {(Object.keys(SOURCE_FORMAT_LABELS) as SourceFormat[]).map((f) => (
            <option key={f} value={f}>
              {SOURCE_FORMAT_LABELS[f]}
            </option>
          ))}
        </select>
      </SettingsField>
      <EmbedCode
        codeFor={(format) => snippetEmbedCode(snippet.ref, format)}
        defaultFormat={embedFormat}
      />
      {!inDocument && (
        <SettingsNote tone="warning">
          This snippet isn't placed in the document yet. Paste its embed code
          where it should appear.
        </SettingsNote>
      )}
      {error && <SettingsNote tone="error">{error}</SettingsNote>}
      <SettingsActions actions={actions} />
    </div>
  );
};

export default SnippetSettings;
