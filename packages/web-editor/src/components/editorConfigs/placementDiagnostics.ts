/**
 * Checks the placeholders in the open buffer, and offers fixes.
 *
 * A placeholder's tag has to suit what its ref names: an incompatible one embeds
 * nothing, a division under another division type's tag embeds anyway, and an
 * exercise placed where its tag can't stand is corrected (`checkPlaceholderTag`
 * and `placedExerciseElement`, which assembly obeys too). The fix rewrites the
 * tag.
 *
 * Every placement of an image, snippet or exercise must also keep its
 * identifiers unique, and the check offers to name the ones that don't.
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
  checkPlaceholderTag,
  isExerciseRefTag,
  isInsideTaskHolder,
  parsePlaceholders,
  parsePlacements,
  placedExerciseElement,
  placeholderTagLabel,
  qualifiedIdentifier,
  retagPlaceholder,
  type PlaceholderTarget,
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
  /**
   * Every ref in the project and what it names, which a tag has to suit and a
   * qualified identifier must not collide with.
   */
  knownRefs: ReadonlyMap<string, PlaceholderTarget>;
  /**
   * Whether the buffer itself sits inside an element a `<task>` may be in: a
   * division never does, and a snippet goes wherever it is placed.
   */
  outerHolder: "outside" | "unknown";
}

export interface PlacementProblem {
  index: number;
  length: number;
  severity: "warning" | "error";
  message: string;
  /** The instance name the quick fix would write, when there is one to offer. */
  suggestedInstance?: string;
  /** The tags a quick fix would change the placeholder to, the best first. */
  suggestedTags?: string[];
}

/** Every placement in `records`, for {@link PlacementCheckInput.elsewhere}. */
export function placementUses(records: readonly PlacementSourceRecord[]): PlacementUse[] {
  return records.flatMap(({ name, source, sourceFormat }) =>
    parsePlacements(source, sourceFormat).map(({ tag, ref, instance }) => ({ tag, ref, instance, placedIn: name })),
  );
}

const INSTANCE_NAME = /^[A-Za-z0-9_-]+$/;
const KIND_NAME: Record<PlacementTag, string> = {
  image: "image",
  snippet: "snippet",
  exercise: "exercise",
  task: "exercise",
  project: "exercise",
};

/** Whether two tags place the same kind of record: every exercise tag does. */
const sameKind = (a: PlacementTag, b: PlacementTag) => KIND_NAME[a] === KIND_NAME[b];

/** How a message names what a ref is. */
function targetName(target: PlaceholderTarget): string {
  if (target.kind === "division") return `a ${target.divisionType}`;
  return target.kind === "asset" ? "an image" : target.kind === "exercise" ? "an exercise" : "a snippet";
}

/** What is wrong with the tags of the placeholders in `text`. */
function findTagProblems(text: string, input: PlacementCheckInput): PlacementProblem[] {
  const label = (tag: string) => placeholderTagLabel(tag, input.sourceFormat);
  const problems: PlacementProblem[] = [];
  for (const { tag, ref, index, length } of parsePlaceholders(text, input.sourceFormat)) {
    const target = input.knownRefs.get(ref);
    const { status, suggestedTags } = checkPlaceholderTag(tag, target);
    const suggestion = suggestedTags.map(label).join(" or ");
    if (status === "incompatible") {
      const problem = target
        ? `"${ref}" is ${targetName(target)}, which ${label(tag)} can't place, so nothing is embedded here.`
        : `${label(tag)} isn't a placeholder, so nothing is embedded here.`;
      problems.push({
        index,
        length,
        severity: "error",
        message: suggestion ? `${problem} Use ${suggestion} instead.` : problem,
        suggestedTags,
      });
    } else if (status === "mismatch" && target?.kind === "division") {
      problems.push({
        index,
        length,
        severity: "warning",
        message:
          `"${ref}" is ${targetName(target)}, so it is embedded as <${target.divisionType}> whatever this tag says. ` +
          `Use ${suggestion}, or change its type in its settings.`,
        suggestedTags,
      });
    } else if (isExerciseRefTag(tag)) {
      const inside = isInsideTaskHolder(text, input.sourceFormat, index);
      // With no holder in sight, a snippet may still be placed inside one.
      if (!inside && input.outerHolder === "unknown") continue;
      const element = placedExerciseElement(tag, inside);
      if (element === tag) continue;
      problems.push({
        index,
        length,
        severity: "warning",
        message: inside
          ? `Only a <task> can go inside an exercise or project, so this is placed as a <task>. Use ${label(element)}.`
          : `A <task> can only go inside an exercise or project, so this is placed as an <exercise>. Use ${label(element)}.`,
        suggestedTags: [element],
      });
    }
  }
  return problems;
}

/** An instance name for a placement of `tag`/`ref` that nothing else uses. */
function suggestInstance(
  tag: PlacementTag,
  ref: string,
  uses: readonly PlacementUse[],
  input: PlacementCheckInput,
): string {
  const taken = new Set(uses.filter((u) => sameKind(u.tag, tag) && u.ref === ref && u.instance).map((u) => u.instance));
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
  const problems = findTagProblems(text, input);
  const here = parsePlacements(text, input.sourceFormat);
  if (here.length === 0) return problems;
  const all: PlacementUse[] = [
    ...input.elsewhere,
    ...here.map(({ tag, ref, instance }) => ({ tag, ref, instance, placedIn: "" })),
  ];
  const same = (tag: PlacementTag, ref: string) => all.filter((u) => sameKind(u.tag, tag) && u.ref === ref);

  for (const { tag, ref, instance, index, length } of here) {
    // A placeholder that embeds nothing can't repeat anything's identifiers.
    if (checkPlaceholderTag(tag, input.knownRefs.get(ref)).status === "incompatible") continue;
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
  marker: { startLineNumber: number; startColumn: number; message?: string },
): { index: number; length: number; text: string; instance: string } | undefined {
  const text: string = model.getValue();
  const offset = model.getOffsetAt({ lineNumber: marker.startLineNumber, column: marker.startColumn });
  const problem = findPlacementProblems(text, input).find(
    (p) => p.index === offset && p.suggestedInstance && (!marker.message || p.message === marker.message),
  );
  if (!problem?.suggestedInstance) return undefined;
  const placeholder = text.slice(problem.index, problem.index + problem.length);
  return {
    index: problem.index,
    length: problem.length,
    text: addPlacementInstance(placeholder, input.sourceFormat, problem.suggestedInstance),
    instance: problem.suggestedInstance,
  };
}

/**
 * The quick fixes for a marker on a placeholder's tag: the placeholder rewritten
 * under each suggested tag, the best first. Recomputed like {@link placementFix}.
 */
export function placementTagFixes(
  model: any,
  input: PlacementCheckInput,
  marker: { startLineNumber: number; startColumn: number; message?: string },
): { index: number; length: number; text: string; title: string }[] {
  const text: string = model.getValue();
  const offset = model.getOffsetAt({ lineNumber: marker.startLineNumber, column: marker.startColumn });
  const problem = findPlacementProblems(text, input).find(
    (p) => p.index === offset && p.suggestedTags?.length && (!marker.message || p.message === marker.message),
  );
  if (!problem?.suggestedTags) return [];
  const { index, length, suggestedTags } = problem;
  const placeholder = text.slice(index, index + length);
  return suggestedTags.map((tag) => ({
    index,
    length,
    text: retagPlaceholder(placeholder, input.sourceFormat, tag),
    title: `Change to ${placeholderTagLabel(tag, input.sourceFormat)}`,
  }));
}
