import { useState } from "react";
import clsx from "clsx";
import type { Exercise, SourceFormat } from "../../types/editor";
import {
  EXERCISE_REF_TAGS,
  exerciseEmbedCode,
  sanitizeXmlId,
  type ExerciseRefTag,
} from "../../sectionUtils";
import { buildProjectExerciseView } from "../../exerciseView";
import { useEditorStore } from "../../store/hooks";
import {
  CommitField,
  EmbedCode,
  FIELD_CONTROL_CLASSES,
  SettingsActions,
  SettingsField,
  SettingsNote,
  type SettingsAction,
} from "./settingsUi";

const EMBED_TAG_LABELS: Record<ExerciseRefTag, string> = {
  exercise: "Exercise",
  project: "Project",
  task: "Task (inside an exercise or project)",
};

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
  const projectSnippets = useEditorStore((s) => s.projectSnippets) ?? [];
  const projectAssets = useEditorStore((s) => s.projectAssets) ?? [];
  const removeExercise = useEditorStore((s) => s.removeExercise);
  const removeExerciseRefFromDocument = useEditorStore((s) => s.removeExerciseRefFromDocument);
  // Which element an exercise becomes belongs to each placement, so this only
  // decides the code to copy; nothing about it is saved on the record.
  const [embedTag, setEmbedTag] = useState<ExerciseRefTag>("exercise");

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
      return "Reference ID can't be empty.";
    }
    if (ref === exercise.ref) return;
    const taken = [
      ...(divisions ?? []).map((d) => d.xmlId),
      ...projectSnippets.map((s) => s.ref),
      ...projectAssets.map((a) => a.ref),
      ...projectExercises.map((e) => e.ref),
    ];
    if (taken.includes(ref)) {
      return `"${ref}" is already used in this project. Choose a unique Reference ID.`;
    }
    await onSave({ ...exercise, ref }, exercise.ref);
  };

  const handleRemove = () => {
    if (
      !window.confirm(
        inDocument
          ? `Remove exercise "${exercise.ref}" from the project? This also deletes its references from the document.`
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
          placeholder="My Exercise"
        />
      </SettingsField>
      <SettingsField label="Reference ID" htmlFor="exercise-settings-ref">
        <CommitField
          id="exercise-settings-ref"
          placeholder="my-exercise"
          value={exercise.ref}
          onCommit={commitRef}
          disabled={readOnly}
          mono
        />
      </SettingsField>
      <SettingsField label="Place as" htmlFor="exercise-settings-tag">
        <select
          id="exercise-settings-tag"
          className={clsx(FIELD_CONTROL_CLASSES, "max-w-[200px]")}
          value={embedTag}
          onChange={(e) => setEmbedTag(e.target.value as ExerciseRefTag)}
        >
          {EXERCISE_REF_TAGS.map((tag) => (
            <option key={tag} value={tag}>
              {EMBED_TAG_LABELS[tag]}
            </option>
          ))}
        </select>
      </SettingsField>
      <EmbedCode
        codeFor={(format) => exerciseEmbedCode(exercise.ref, format, embedTag)}
        defaultFormat={embedFormat}
      />
      {!inDocument && (
        <SettingsNote tone="warning">
          This exercise isn't placed in the document yet. Paste its embed code
          where it should appear.
        </SettingsNote>
      )}
      <SettingsActions actions={actions} />
    </div>
  );
};

export default ExerciseSettings;
