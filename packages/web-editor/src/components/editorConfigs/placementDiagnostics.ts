/**
 * Checks that every placement of an image or snippet keeps its identifiers
 * unique, and offers to name the ones that don't.
 *
 * A record placed more than once would put its `@label`s and `@xml:id`s in the
 * document more than once, which PreTeXt reports as an error (and for a
 * generated image, whose `@label` is its filename, means two placements
 * fighting over one file). So all but one placement of a record must name an
 * `instance`, which assembly appends to every identifier inside it (see
 * `qualifyIdentifiers`). This check is what tells the author so, on the
 * placeholder itself, with a quick fix that writes a name in. The name is
 * written once and kept: an identifier must never change because something
 * else was placed earlier, which is why nothing here numbers placements in
 * document order.
 *
 * The open buffer is read from its live text; the rest of the project arrives
 * as a list of placements (`PlacementCheckInput.elsewhere`).
 */

import {
  addPlacementInstance,
  parsePlacements,
  qualifiedIdentifier,
  type PlacementTag,
} from "../../sectionUtils";
import type { SourceFormat } from "../../types/editor";

export const PLACEMENT_MARKER_OWNER = "pretext-placements";
/** Set on each marker, which is how the quick fix recognises its own. */
export const PLACEMENT_MARKER_SOURCE = "placements";

/** One placement somewhere in the project. */
export interface PlacementUse {
  tag: PlacementTag;
  ref: string;
  instance?: string;
  /** How to name the division or snippet it is placed in, for messages. */
  placedIn: string;
}

/** A record whose source may hold placements. */
export interface PlacementSourceRecord {
  name: string;
  source: string;
  sourceFormat: SourceFormat;
}

export interface PlacementCheckInput {
  sourceFormat: SourceFormat;
  /** The open record's ref, which seeds the instance names the quick fix suggests. */
  recordRef: string;
  /** Every placement in the project's *other* divisions and snippets. */
  elsewhere: readonly PlacementUse[];
  /** Every ref in the project, which a qualified identifier must not collide with. */
  knownRefs: ReadonlySet<string>;
}

export interface PlacementProblem {
  index: number;
  length: number;
  severity: "warning" | "error";
  message: string;
  /** The instance name the quick fix would write, when there is one to offer. */
  suggestedInstance?: string;
}

/** Every placement in `records`, for {@link PlacementCheckInput.elsewhere}. */
export function placementUses(records: readonly PlacementSourceRecord[]): PlacementUse[] {
  return records.flatMap(({ name, source, sourceFormat }) =>
    parsePlacements(source, sourceFormat).map(({ tag, ref, instance }) => ({ tag, ref, instance, placedIn: name })),
  );
}

const INSTANCE_NAME = /^[A-Za-z0-9_-]+$/;
const KIND_NAME: Record<PlacementTag, string> = { image: "image", snippet: "snippet" };

/** An instance name for a placement of `tag`/`ref` that nothing else uses. */
function suggestInstance(
  tag: PlacementTag,
  ref: string,
  uses: readonly PlacementUse[],
  input: PlacementCheckInput,
): string {
  const taken = new Set(uses.filter((u) => u.tag === tag && u.ref === ref && u.instance).map((u) => u.instance));
  const base = input.recordRef.replace(/[^A-Za-z0-9_-]/g, "-") || "again";
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(candidate) && !input.knownRefs.has(qualifiedIdentifier(ref, candidate))) return candidate;
  }
}

/** "Section 2", "Section 2 and Intro", "Section 2, Intro and 1 more". */
function listPlaces(places: string[]): string {
  const unique = [...new Set(places)];
  if (unique.length <= 2) return unique.join(" and ");
  return `${unique.slice(0, 2).join(", ")} and ${unique.length - 2} more`;
}

/** What is wrong with the placements in `text`, the open buffer's live source. */
export function findPlacementProblems(text: string, input: PlacementCheckInput): PlacementProblem[] {
  const here = parsePlacements(text, input.sourceFormat);
  if (here.length === 0) return [];
  const all: PlacementUse[] = [
    ...input.elsewhere,
    ...here.map(({ tag, ref, instance }) => ({ tag, ref, instance, placedIn: "" })),
  ];
  const same = (tag: PlacementTag, ref: string) => all.filter((u) => u.tag === tag && u.ref === ref);

  const problems: PlacementProblem[] = [];
  for (const { tag, ref, instance, index, length } of here) {
    const kind = KIND_NAME[tag];
    if (!instance) {
      const unnamed = same(tag, ref).filter((u) => !u.instance);
      if (unnamed.length < 2) continue;
      const elsewhere = unnamed.map((u) => u.placedIn).filter(Boolean);
      const where = elsewhere.length ? `here and in ${listPlaces(elsewhere)}` : "more than once here";
      problems.push({
        index,
        length,
        severity: "warning",
        message:
          `The ${kind} "${ref}" is placed ${where} without an instance name, so its labels would ` +
          `repeat, and PreTeXt requires them to be unique. Name all but one placement ` +
          `(instance="…") to keep them apart.`,
        suggestedInstance: suggestInstance(tag, ref, all, input),
      });
    } else if (!INSTANCE_NAME.test(instance)) {
      problems.push({
        index,
        length,
        severity: "error",
        message: `An instance name may use only letters, digits, "-" and "_".`,
      });
    } else if (same(tag, ref).filter((u) => u.instance === instance).length > 1) {
      problems.push({
        index,
        length,
        severity: "warning",
        message: `The ${kind} "${ref}" is placed under the instance name "${instance}" more than once; each placement needs its own.`,
        suggestedInstance: suggestInstance(tag, ref, all, input),
      });
    } else if (input.knownRefs.has(qualifiedIdentifier(ref, instance))) {
      problems.push({
        index,
        length,
        severity: "warning",
        message:
          `This placement's labels would be "${qualifiedIdentifier(ref, instance)}", which is already the ` +
          `id of something else in the project. Choose another instance name.`,
      });
    }
  }
  return problems;
}

/** The Monaco markers for `problems` in `model`. */
export function placementMarkers(monaco: any, model: any, problems: readonly PlacementProblem[]): any[] {
  return problems.map((problem) => {
    const start = model.getPositionAt(problem.index);
    const end = model.getPositionAt(problem.index + problem.length);
    return {
      severity: problem.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      message: problem.message,
      source: PLACEMENT_MARKER_SOURCE,
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    };
  });
}

/**
 * The quick fix for the placement a marker sits on: the placeholder rewritten
 * with the suggested instance name. Recomputed from the model's text rather
 * than carried on the marker, since an edit may have moved things since it was
 * published.
 */
export function placementFix(
  model: any,
  input: PlacementCheckInput,
  marker: { startLineNumber: number; startColumn: number },
): { index: number; length: number; text: string; instance: string } | undefined {
  const text: string = model.getValue();
  const offset = model.getOffsetAt({ lineNumber: marker.startLineNumber, column: marker.startColumn });
  const problem = findPlacementProblems(text, input).find((p) => p.index === offset && p.suggestedInstance);
  if (!problem?.suggestedInstance) return undefined;
  const placeholder = text.slice(problem.index, problem.index + problem.length);
  return {
    index: problem.index,
    length: problem.length,
    text: addPlacementInstance(placeholder, input.sourceFormat, problem.suggestedInstance),
    instance: problem.suggestedInstance,
  };
}
