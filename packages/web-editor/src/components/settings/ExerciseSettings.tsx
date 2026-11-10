import type { Exercise, SourceFormat } from "../../types/editor";
import { exerciseEmbedCode, sanitizeXmlId } from "../../sectionUtils";
import { buildProjectExerciseView } from "../../exerciseView";
import { useEditorStore, useTakenRefs } from "../../store/hooks";
import { ID_REQUIRED_MESSAGE, idTakenMessage } from "../../idRules";
import {
  CommitField,
  EmbedCode,
  SettingsActions,
  SettingsField,
  SettingsNote,
  type SettingsAction,
} from "./settingsUi";

export interface ExerciseSettingsProps {
  exercise: Exercise;
  /** Default format for the embed-code picker — the root division's. */
  embedFormat: SourceFormat;
  /**
   * Persist a metadata edit (title or ref). `prevRef` is the ref before the
   * edit, so the caller can rewrite placeholders when it changed. Rejects with
   * the host's error, which the field shows.
   */
  onSave: (exercise: Exercise, prevRef: string) => Promise<void>;
  readOnly?: boolean;
}

/**
 * An exercise's settings: its title (the `<title>` its element is built with),
 * its id (the ref every embed names, and its `xml:id` and `@label`), the embed
 * code, and removal. Its body is the exercise designer itself.
 */
const ExerciseSettings = ({ exercise, embedFormat, onSave, readOnly }: ExerciseSettingsProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const projectExercises = useEditorStore((s) => s.projectExercises) ?? [];
  const takenRefs = useTakenRefs();
  const removeExercise = useEditorStore((s) => s.removeExercise);
  const removeExerciseRefFromDocument = useEditorStore((s) => s.removeExerciseRefFromDocument);

  const row = buildProjectExerciseView(divisions, projectExercises).find(
    (r) => r.ref === exercise.ref,
  );
  const inDocument = row?.inDocument ?? false;

  const commitTitle = async (next: string): Promise<void> => {
    const title = next.trim();
    if (title === (exercise.title ?? "")) return;
    await onSave({ ...exercise, title }, exercise.ref);
  };

  const commitRef = async (next: string): Promise<string | void> => {
    const ref = sanitizeXmlId(next);
    if (!ref) {
      return ID_REQUIRED_MESSAGE;
    }
    if (ref === exercise.ref) return;
    if (takenRefs.has(ref)) {
      return idTakenMessage(ref);
    }
    await onSave({ ...exercise, ref }, exercise.ref);
  };

  const handleRemove = () => {
    if (
      !window.confirm(
        inDocument
          ? `Remove exercise "${exercise.ref}" from the project? It will also be taken out of every place the document uses it.`
          : `Remove exercise "${exercise.ref}" from the project?`,
      )
    ) {
      return;
    }
    removeExercise(exercise);
    removeExerciseRefFromDocument(exercise.ref);
  };

  const actions: SettingsAction[] = readOnly
    ? []
    : [{ label: "Remove from project", onClick: handleRemove, danger: true }];

  return (
    <div className="flex flex-col gap-2.5">
      <SettingsField label="Title" htmlFor="exercise-settings-title">
        <CommitField
          id="exercise-settings-title"
          value={exercise.title ?? ""}
          onCommit={commitTitle}
          disabled={readOnly}
          placeholder="My exercise"
        />
      </SettingsField>
      <SettingsField label="ID" htmlFor="exercise-settings-ref">
        <CommitField
          id="exercise-settings-ref"
          placeholder="my-exercise"
          value={exercise.ref}
          onCommit={commitRef}
          disabled={readOnly}
          mono
        />
      </SettingsField>
      <EmbedCode
        codeFor={(format) => exerciseEmbedCode(exercise.ref, format)}
        defaultFormat={embedFormat}
      />
      {!inDocument && (
        <SettingsNote tone="warning">
          This exercise isn't used in the document yet. Paste its embed code
          where it should appear.
        </SettingsNote>
      )}
      <SettingsActions actions={actions} />
    </div>
  );
};

export default ExerciseSettings;
