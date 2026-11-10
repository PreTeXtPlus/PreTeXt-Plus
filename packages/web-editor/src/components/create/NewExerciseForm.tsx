import { useEffect, useId, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import type { Exercise } from "../../types/editor";
import { sanitizeXmlId, slugifyTitle, uniqueRef } from "../../sectionUtils";
import { useTakenRefs } from "../../store/hooks";
import { ID_REQUIRED_MESSAGE, idTakenMessage } from "../../idRules";
import {
  EXERCISE_KINDS,
  EXERCISE_KIND_LABELS,
  HIDDEN_EXERCISE_KINDS,
  emptyDesign,
  type ExerciseKind,
} from "../../exerciseDesigner/model";
import { sourceFromDesign } from "../../exerciseDesigner/serialize";
import {
  FIELD_CONTROL_CLASSES,
  SettingsButton,
  SettingsField,
  SettingsNote,
} from "../settings/settingsUi";

export interface NewExerciseFormProps {
  /** The unlinked placeholder ref this exercise will bind, if resolving one. */
  resolveRef?: string;
  /**
   * Persist the new exercise; the host returns the created record and has the
   * final say on ref uniqueness. Without one, the exercise is created locally
   * (no-host demos and tests).
   */
  onCreate?: (exercise: Exercise) => Promise<Exercise>;
  /** The exercise now exists — see `NewItemPane`. */
  onCreated: (exercise: Exercise) => void;
  onCancel: () => void;
  /** Told when a request to the host starts and settles. */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * A throwaway client-side id for an exercise created with no host to mint
 * one. At module scope so its impure `Date.now()` isn't flagged by the React
 * Compiler's purity check for component-body code.
 */
function localExerciseId(): string {
  return `exercise-${Date.now()}`;
}

/**
 * The creation form for a project exercise: its title (optional), reference
 * id and type. The new exercise is a blank one of that type, filled in
 * afterwards in the exercise designer it opens in.
 */
const NewExerciseForm = ({
  resolveRef,
  onCreate,
  onCreated,
  onCancel,
  onBusyChange,
}: NewExerciseFormProps) => {
  const takenRefs = useTakenRefs();

  const [title, setTitle] = useState("");
  // Suggested from the title until the author edits it, and theirs from then
  // on, even blank: `null` means "still following the suggestion".
  const [editedRef, setEditedRef] = useState<string | null>(resolveRef ?? null);
  const ref =
    editedRef ?? (title.trim() ? uniqueRef(slugifyTitle(title) || "exercise", takenRefs) : "");
  const [kind, setKind] = useState<ExerciseKind>("multiplechoice");
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
    const exercise: Exercise = {
      ref: sanitized,
      title: title.trim(),
      ...sourceFromDesign(emptyDesign(kind), sanitized),
    };
    if (!onCreate) {
      onCreated({ id: localExerciseId(), ...exercise });
      return;
    }
    setIsCreating(true);
    try {
      onCreated(await onCreate(exercise));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create exercise.");
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") void handleCreate();
  };

  return (
    <div className="flex flex-col gap-2.5" data-testid="new-exercise-form">
      <SettingsField label="Title" htmlFor={`${fieldId}-title`}>
        <input
          id={`${fieldId}-title`}
          className={FIELD_CONTROL_CLASSES}
          type="text"
          value={title}
          placeholder="My exercise"
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
          placeholder="my-exercise"
          onChange={(e) => setEditedRef(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isCreating}
        />
        {resolveRef && (
          <SettingsNote>
            Every place the document uses <code>{resolveRef}</code> will use
            this exercise{ref.trim() && sanitizeXmlId(ref) !== resolveRef
              ? ` (renamed to ${sanitizeXmlId(ref)})`
              : ""}.
          </SettingsNote>
        )}
      </SettingsField>
      <SettingsField label="Type" htmlFor={`${fieldId}-kind`}>
        <select
          id={`${fieldId}-kind`}
          className={clsx(FIELD_CONTROL_CLASSES, "max-w-[200px]")}
          value={kind}
          onChange={(e) => setKind(e.target.value as ExerciseKind)}
          disabled={isCreating}
        >
          {EXERCISE_KINDS.filter((k) => !HIDDEN_EXERCISE_KINDS.includes(k)).map((k) => (
            <option key={k} value={k}>
              {EXERCISE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <SettingsNote>You can change the type later in the designer.</SettingsNote>
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

export default NewExerciseForm;
