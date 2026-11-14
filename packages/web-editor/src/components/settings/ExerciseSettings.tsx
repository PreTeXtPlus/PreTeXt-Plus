import { useState } from "react";
import clsx from "clsx";
import type { Exercise, SourceFormat } from "../../types/editor";
import {
  EXERCISE_PLACEMENT_TAGS,
  exerciseEmbedCode,
  sanitizeXmlId,
  type ExercisePlacementTag,
} from "../../sectionUtils";
import { effectiveDoenetmlVersion } from "../../doenet";
import { buildProjectExerciseView } from "../../exerciseView";
import { useEditorStore, useTakenRefs } from "../../store/hooks";
import { ID_REQUIRED_MESSAGE, idTakenMessage } from "../../idRules";
import {
  CommitField,
  EmbedCode,
  FIELD_CONTROL_CLASSES,
  SettingsActions,
  SettingsField,
  SettingsNote,
  type SettingsAction,
} from "./settingsUi";

/** How each placement tag is offered in the embed-code picker of a Doenet activity. */
const PLACEMENT_LABELS: Record<ExercisePlacementTag, string> = {
  exercise: "Exercise",
  project: "Project",
  activity: "Activity",
  exploration: "Exploration",
  investigation: "Investigation",
  interactive: "Interactive only (no wrapper)",
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
  const docinfo = useEditorStore((s) => (s.useCommonDocinfo ? s.commonDocinfo : s.docinfo));
  const isDoenet = exercise.sourceFormat === "doenetml";
  // A Doenet activity's embed code names the PreTeXt it is wrapped in.
  const [placementTag, setPlacementTag] = useState<ExercisePlacementTag>("exercise");
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

  /** A Doenet activity's `<interactive>` attribute (its width or aspect); blank removes it. */
  const commitAttr = (name: string) => async (next: string): Promise<void> => {
    const value = next.trim();
    const attrs = { ...(exercise.attrs ?? {}) };
    if ((attrs[name] ?? "") === value) return;
    if (value) attrs[name] = value;
    else delete attrs[name];
    await onSave({ ...exercise, attrs }, exercise.ref);
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
      {isDoenet && (
        <>
          <SettingsField label="Width" htmlFor="exercise-settings-width">
            <CommitField
              id="exercise-settings-width"
              placeholder="100%"
              value={exercise.attrs?.width ?? ""}
              onCommit={commitAttr("width")}
              disabled={readOnly}
              mono
            />
          </SettingsField>
          <SettingsField label="Aspect" htmlFor="exercise-settings-aspect">
            <CommitField
              id="exercise-settings-aspect"
              placeholder="4:3"
              value={exercise.attrs?.aspect ?? ""}
              onCommit={commitAttr("aspect")}
              disabled={readOnly}
              mono
            />
            <SettingsNote>
              The frame's width and shape in the page, as PreTeXt's <code>width</code> and{" "}
              <code>aspect</code>. DoenetML {effectiveDoenetmlVersion(docinfo ?? "")}
              {docinfo && /<doenetml\b/.test(docinfo) ? ", from the docinfo." : ", the default."}
            </SettingsNote>
          </SettingsField>
          <SettingsField label="Place as" htmlFor="exercise-settings-placement">
            <select
              id="exercise-settings-placement"
              className={clsx(FIELD_CONTROL_CLASSES, "max-w-[260px]")}
              value={placementTag}
              onChange={(e) => setPlacementTag(e.target.value as ExercisePlacementTag)}
            >
              {EXERCISE_PLACEMENT_TAGS.map((tag) => (
                <option key={tag} value={tag}>
                  {PLACEMENT_LABELS[tag]}
                </option>
              ))}
            </select>
            <SettingsNote>
              What surrounds the activity where it is placed. "Interactive only" fits a figure, or a
              task inside an exercise you write yourself.
            </SettingsNote>
          </SettingsField>
        </>
      )}
      <EmbedCode
        codeFor={(format) => exerciseEmbedCode(exercise.ref, format, isDoenet ? placementTag : "exercise")}
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
