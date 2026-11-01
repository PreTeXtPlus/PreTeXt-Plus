import clsx from "clsx";
import { buildProjectExerciseView, type ExerciseRow } from "../../exerciseView";
import { useEditorStore } from "../../store/hooks";

export interface ExerciseListProps {
  /** Offer "Add one" when empty, which opens the new-exercise form in the editor pane. */
  canCreate?: boolean;
}

/**
 * The explorer's Exercises view: every exercise placeholder and project exercise,
 * with status. Selecting an exercise opens it in the exercise designer, whose
 * title bar carries its settings; a placeholder with no exercise behind it opens
 * the "Link exercise" form in the editor pane instead, having no source to open.
 */
const ExerciseList = ({ canCreate }: ExerciseListProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const projectExercises = useEditorStore((s) => s.projectExercises) ?? [];
  const openItem = useEditorStore((s) => s.openItem);
  const openExercise = useEditorStore((s) => s.openExercise);
  const startCreate = useEditorStore((s) => s.startCreate);
  const resolveExercise = (ref: string) =>
    startCreate({ kind: "exercise", resolveRef: ref });

  // ── Joined exercise view — placeholders + project exercises, with status ───────
  const exerciseView = buildProjectExerciseView(divisions, projectExercises);

  const openExerciseRow = (row: ExerciseRow) =>
    row.status === "unlinked"
      ? resolveExercise(row.ref)
      : openExercise(row.ref);

  return (
    <>
      <div className="overflow-y-auto flex-1 min-h-0">
        {exerciseView.length === 0 ? (
          <p className="m-0 py-2 px-3 text-slate-400 text-[0.78rem]">
            No exercises in this project yet.{" "}
            {canCreate && (
              <button
                type="button"
                className="bg-transparent border-none text-blue-600 cursor-pointer font-[inherit] text-[0.78rem] p-0 hover:underline"
                onClick={() => startCreate({ kind: "exercise" })}
              >
                Add one
              </button>
            )}
          </p>
        ) : (
          <ul className="list-none m-0 pt-0 px-0 pb-1">
            {exerciseView.map((row) => {
              const isUnlinked = row.status === "unlinked";
              const isOpen =
                openItem.kind === "exercise" && openItem.ref === row.ref;
              return (
                <li
                  key={row.ref}
                  data-testid={`exercise-row-${row.ref}`}
                  className={clsx(
                    "flex items-center gap-1.5 py-[3px] pr-1.5 pl-4 min-h-7 border-l-[3px]",
                    isOpen
                      ? "bg-[#e0e8ff] border-l-blue-600"
                      : "border-transparent hover:bg-[#e8eaf0]",
                  )}
                >
                  <span
                    className={clsx(
                      "inline-flex items-center justify-center w-[30px] h-[30px] cursor-pointer text-[0.85rem] rounded bg-[#eef2f7] text-slate-400",
                      isUnlinked && "bg-amber-100 text-amber-700",
                    )}
                    onClick={() => openExerciseRow(row)}
                    aria-hidden="true"
                  >
                    {isUnlinked ? "⚠" : "?"}
                  </span>
                  <button
                    type="button"
                    className="flex-1 min-w-0 flex flex-col items-start gap-px overflow-hidden border-none bg-transparent p-0 font-[inherit] text-left cursor-pointer"
                    onClick={() => openExerciseRow(row)}
                    aria-current={isOpen ? "true" : undefined}
                    title={
                      isUnlinked
                        ? "No exercise for this reference — click to link or create one"
                        : "Open exercise"
                    }
                  >
                    {/* A titled exercise reads like an asset row: its title,
                        with the ref beneath. Untitled, the ref is all there is. */}
                    {row.exercise?.title && (
                      <span
                        className={clsx(
                          "text-[0.78rem] text-slate-700 overflow-hidden text-ellipsis whitespace-nowrap",
                          isOpen && "font-semibold",
                        )}
                      >
                        {row.exercise.title}
                      </span>
                    )}
                    <span
                      className={clsx(
                        "font-mono overflow-hidden text-ellipsis whitespace-nowrap",
                        row.exercise?.title ? "text-[0.68rem]" : "text-[0.78rem]",
                        isUnlinked
                          ? "text-amber-700"
                          : row.exercise?.title
                            ? "text-slate-400"
                            : "text-slate-700",
                        isOpen && !row.exercise?.title && "font-semibold",
                      )}
                    >
                      {isUnlinked
                        ? `${row.ref} — needs exercise`
                        : row.status === "unused"
                          ? `${row.ref} — not placed`
                          : row.ref}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
};

export default ExerciseList;
