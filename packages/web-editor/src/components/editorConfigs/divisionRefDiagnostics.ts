/**
 * Flags a division placeholder (`<plus:section ref="x"/>`, `::section{ref="x"}`,
 * `\plus{section}{x}`) whose ref names no division, and offers to create one.
 *
 * Typing a placeholder used to create the division it named on the spot. Since
 * the buffer is delivered as the author types, editing a ref to point at a
 * different division created one stray division per keystroke. A ref that
 * resolves to nothing is now only a warning on the placeholder itself; the
 * author creates the division from its quick fix, once the ref says what
 * they mean.
 *
 * Commented-out placeholders are not placements and are not checked (see
 * `parseDivisionRefSpans`).
 */

import { isValidRef, parseDivisionRefSpans } from "../../sectionUtils";
import type { SourceFormat } from "../../types/editor";
import type { DivisionType } from "../../types/sections";

export const DIVISION_REF_MARKER_OWNER = "pretext-division-refs";
/** Set on each marker, which is how the quick fix recognises its own. */
export const DIVISION_REF_MARKER_SOURCE = "division-refs";

export interface DivisionRefCheckInput {
  sourceFormat: SourceFormat;
  /** Every division's `xml:id`. */
  divisionIds: ReadonlySet<string>;
  /**
   * The project's other refs, by what they name, with its article ("a
   * snippet", "an asset", …). Refs are one namespace, so a division can't be
   * created under one of these.
   */
  otherRefs: ReadonlyMap<string, string>;
}

export interface DivisionRefProblem {
  index: number;
  length: number;
  message: string;
  xmlId: string;
  type: DivisionType;
  /** Whether the quick fix may create a division with this ref. */
  canCreate: boolean;
}

/** The placeholders in `text`, the open buffer's live source, that name no division. */
export function findDivisionRefProblems(
  text: string,
  input: DivisionRefCheckInput,
): DivisionRefProblem[] {
  const problems: DivisionRefProblem[] = [];
  for (const { xmlId, type, index, length } of parseDivisionRefSpans(text, input.sourceFormat)) {
    if (input.divisionIds.has(xmlId)) continue;
    const other = input.otherRefs.get(xmlId);
    const valid = isValidRef(xmlId);
    const message = other
      ? `"${xmlId}" is ${other}, not a division.`
      : valid
        ? `No division "${xmlId}" exists.`
        : `No division "${xmlId}" exists, and "${xmlId}" can't be an ID: use letters, digits, "-" and "_", starting with a letter or "_".`;
    problems.push({ index, length, message, xmlId, type, canCreate: !other && valid });
  }
  return problems;
}

/** The Monaco markers for `problems` in `model`. */
export function divisionRefMarkers(
  monaco: any,
  model: any,
  problems: readonly DivisionRefProblem[],
): any[] {
  return problems.map((problem) => {
    const start = model.getPositionAt(problem.index);
    const end = model.getPositionAt(problem.index + problem.length);
    return {
      severity: monaco.MarkerSeverity.Warning,
      message: problem.message,
      source: DIVISION_REF_MARKER_SOURCE,
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    };
  });
}

/**
 * The division a marker's quick fix would create, recomputed from the model's
 * text rather than carried on the marker, since typing may have changed the
 * ref since it was published.
 */
export function divisionRefFix(
  model: any,
  input: DivisionRefCheckInput,
  marker: { startLineNumber: number; startColumn: number },
): { xmlId: string; type: DivisionType } | undefined {
  const offset = model.getOffsetAt({ lineNumber: marker.startLineNumber, column: marker.startColumn });
  const problem = findDivisionRefProblems(model.getValue(), input).find(
    (p) => p.index === offset && p.canCreate,
  );
  return problem && { xmlId: problem.xmlId, type: problem.type };
}
