/**
 * The unified project-exercise view: a single join of the two things the
 * editor tracks for exercises, which can otherwise drift apart —
 *
 *   1. `<plus:exercise ref="..."/>` placeholders parsed out of division content
 *      (what the document *references*), and
 *   2. the DB-backed project-exercise pool (what actually *exists*).
 *
 * Mirrors `snippetView.ts` — see `assetView.ts` for the reasoning behind the
 * joined-row shape.
 */
import type { Exercise } from "./types/editor";
import type { Division } from "./types/sections";
import { parseExerciseRefs } from "./sectionUtils";

/**
 * The reconciliation state of one exercise reference:
 *   - `linked`   — referenced in the document *and* backed by a project exercise.
 *   - `unlinked` — referenced in the document but with no backing exercise.
 *   - `unused`   — a project exercise not referenced anywhere in the document yet.
 */
export type ExerciseStatus = "linked" | "unlinked" | "unused";

/** One row of the joined project-exercise view, keyed by `ref`. */
export interface ExerciseRow {
  ref: string;
  /** The backing project exercise, when one exists (`linked` / `unused`). */
  exercise?: Exercise;
  /** Whether a `<plus:exercise ref/>` placeholder for this row exists in source. */
  inDocument: boolean;
  status: ExerciseStatus;
}

/**
 * Build the joined exercise view for a project: the union of every placeholder
 * referenced across all divisions and every exercise in the project pool, keyed
 * by `ref`, in a stable order (document references first in document order,
 * then any remaining unused exercises).
 */
export function buildProjectExerciseView(
  divisions: Division[] | undefined,
  projectExercises: Exercise[] | undefined,
): ExerciseRow[] {
  const exercises = projectExercises ?? [];
  const findExercise = (ref: string) => exercises.find((s) => s.ref === ref);

  const rows: ExerciseRow[] = [];
  const seen = new Set<string>();

  for (const division of divisions ?? []) {
    for (const { ref } of parseExerciseRefs(division.source, division.sourceFormat)) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const exercise = findExercise(ref);
      rows.push({
        ref,
        exercise,
        inDocument: true,
        status: exercise ? "linked" : "unlinked",
      });
    }
  }

  for (const exercise of exercises) {
    if (!exercise.ref) continue;
    if (seen.has(exercise.ref)) continue;
    seen.add(exercise.ref);
    rows.push({
      ref: exercise.ref,
      exercise,
      inDocument: false,
      status: "unused",
    });
  }

  return rows;
}
