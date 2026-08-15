/**
 * Applying source-cleanup fixes to a Monaco model.
 *
 * The language core also offers a ready-made "clean up the whole file" action,
 * but it is a single edit spanning the entire document — the fixpoint loop's
 * intermediate offsets do not map back onto the original text, so one
 * whole-document replacement is the only correct way to express the result as
 * an edit. That shape is wrong for this editor twice over:
 *
 * - a division's structural first line is locked (see `lockedRegion.ts`), and a
 *   document-spanning edit covers it, so the constrained-editor plugin would
 *   revert it and the collab edit guard would drop it; and
 * - under collaboration a whole-model replacement reaches the shared document
 *   as delete-everything-then-reinsert, which destroys every peer's cursor and
 *   makes a conflicting concurrent edit unresolvable.
 *
 * So this module runs the find/apply cycle itself, pushing each pass as a set
 * of small ranged edits at offsets that are valid against the model as it
 * stands. Those go through `pushEditOperations`, which is what the collab guard
 * recognizes as a local edit and what puts the run on the undo stack.
 */

import type { SourceFormat } from "../../types/editor";
import {
  computeLockedRegion,
  isRangeWithin,
  type LineRange,
} from "../lockedRegion";
import type { CleanFix, CleanSupport } from "./types";

/**
 * Cap on find/apply cycles, matching the core's own default. Rewrites cascade —
 * `{\bf x}` becomes `\textbf{x}`, which is then flagged as a presentational
 * font macro — so one pass is not enough; the cap guards against a rule whose
 * output re-matches its own pattern.
 */
export const MAX_CLEAN_PASSES = 5;

export interface CleanApplyOptions {
  /** Decides which lines are structural, and so off-limits to a fix. */
  sourceFormat: SourceFormat;
  /** Restrict to these rule ids. Omit to apply every auto-fixable finding. */
  ruleIds?: string[];
}

export interface CleanApplyResult {
  /** How many individual occurrences were rewritten or removed. */
  applied: number;
  /** How many find/apply cycles ran. */
  passes: number;
  /** True if the loop hit `MAX_CLEAN_PASSES` with edits still pending. */
  truncated: boolean;
}

/** The editable span of the model, or null when nothing is locked. */
export function editableRangeFor(
  model: any,
  sourceFormat: SourceFormat,
): LineRange | null {
  return computeLockedRegion(model, sourceFormat)?.editableRange ?? null;
}

/** A `monaco.Range` for a fix's character offsets, resolved against the model. */
export function rangeFromOffsets(
  monaco: any,
  model: any,
  start: number,
  end: number,
) {
  const from = model.getPositionAt(start);
  const to = model.getPositionAt(end);
  return new monaco.Range(
    from.lineNumber,
    from.column,
    to.lineNumber,
    to.column,
  );
}

/**
 * The edit operations one pass would apply: every auto-fixable finding that
 * lands inside the editable region.
 *
 * A finding on a locked line is skipped rather than allowed to fail, because
 * the collab guard rejects an out-of-range operation by dropping *the whole
 * batch* — one `\vspace` in a division header would otherwise silently cancel
 * the cleanup of the entire body.
 */
function editableEdits(
  monaco: any,
  model: any,
  clean: CleanSupport,
  text: string,
  allowed: Set<string> | null,
  sourceFormat: SourceFormat,
) {
  const editable = editableRangeFor(model, sourceFormat);
  const edits: { range: any; text: string; forceMoveMarkers: boolean }[] = [];

  for (const fix of clean.getFixes(text)) {
    // A `flag` finding carries no replacement on purpose — it needs a human.
    if (fix.replacement === undefined) continue;
    if (allowed && !allowed.has(fix.ruleId)) continue;
    const range = rangeFromOffsets(monaco, model, fix.start, fix.end);
    if (editable && !isRangeWithin(editable, range)) continue;
    edits.push({ range, text: fix.replacement, forceMoveMarkers: true });
  }

  return edits;
}

/**
 * Clean the model in place, running the find/apply cycle to a fixpoint.
 *
 * The whole run is a single undo step: `pushStackElement` closes whatever undo
 * element was open, everything pushed until the closing call is undone
 * together, and the author gets back the text they had with one Ctrl+Z rather
 * than one per pass.
 *
 * No host notification is needed — these are ordinary model edits, so Monaco's
 * `onChange` fires and `CodeEditor`'s existing debounce reports them like any
 * other typing.
 */
export function applyCleanFixes(
  monaco: any,
  editor: any,
  clean: CleanSupport,
  { sourceFormat, ruleIds }: CleanApplyOptions,
): CleanApplyResult {
  const model = editor?.getModel?.();
  if (!monaco || !model || model.isDisposed?.()) {
    return { applied: 0, passes: 0, truncated: false };
  }

  const allowed = ruleIds ? new Set(ruleIds) : null;
  const pending = () =>
    editableEdits(
      monaco,
      model,
      clean,
      model.getValue(),
      allowed,
      sourceFormat,
    );

  let applied = 0;
  let passes = 0;

  model.pushStackElement();
  for (; passes < MAX_CLEAN_PASSES; passes += 1) {
    const before = model.getValue();
    const edits = pending();
    if (edits.length === 0) break;

    model.pushEditOperations([], edits, () => null);

    // The collab guard drops a batch it will not allow, and a read-only model
    // ignores the push outright. Either way the same fixes would be found and
    // pushed again next pass, so stop when a pass changed nothing.
    if (model.getValue() === before) break;
    applied += edits.length;
  }
  const truncated = passes === MAX_CLEAN_PASSES && pending().length > 0;
  model.pushStackElement();

  return { applied, passes, truncated };
}

/** The current buffer's findings, or an empty list when the model is gone. */
export function fixesForModel(model: any, clean: CleanSupport): CleanFix[] {
  if (!model || model.isDisposed?.()) return [];
  try {
    return clean.getFixes(model.getValue());
  } catch {
    // A scanner failure must never take the editor down with it.
    return [];
  }
}
