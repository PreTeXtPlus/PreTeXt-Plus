/**
 * Checks on `<interactive>` elements that the schema cannot make: markup that
 * is valid and still does not do what its author meant.
 *
 * - **`@calcplot3d` with no `@variant`.** PreTeXt builds the frame's address
 *   from the variant; without one the address is only the query string, and
 *   the frame shows nothing. The quick fix writes `variant="application"`.
 * - **No picture for the outputs that are not a web page.** A PDF or an EPUB
 *   cannot run an interactive: it shows the `@preview` image or the `<static>`
 *   element, and has nothing to show without one. Only reported for a project
 *   that builds such an output (`InteractiveCheckInput.hasStaticOutput`), as a
 *   note rather than a warning — the web page is fine as it stands.
 *
 * Reads the open buffer's live text, like the placement check: the scan is
 * cheap, and the fix edits the text it read. Comments and CDATA are skipped.
 */

export const INTERACTIVE_MARKER_OWNER = "pretext-interactives";
/** Set on each marker, which is how the quick fix recognises its own. */
export const INTERACTIVE_MARKER_SOURCE = "interactives";

export interface InteractiveCheckInput {
  /** The project builds an output that cannot run an interactive (PDF, EPUB, …). */
  hasStaticOutput: boolean;
}

export type InteractiveProblemKind = "calcplot3d-variant" | "no-static";

export interface InteractiveProblem {
  kind: InteractiveProblemKind;
  /** The interactive's start tag, in the text. */
  index: number;
  length: number;
  message: string;
  severity: "warning" | "info";
}

/** A start tag, tolerant of `>` inside a quoted attribute value. */
const INTERACTIVE_TAG = /<interactive\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const NOT_MARKUP = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g;

const hasAttribute = (attributes: string, name: string): boolean =>
  new RegExp(`(?:^|\\s)${name}\\s*=`).test(attributes);

/** The problems with the interactives in `text`, in document order. */
export function findInteractiveProblems(
  text: string,
  input: InteractiveCheckInput,
): InteractiveProblem[] {
  // Blanked rather than removed, so every index is still the buffer's.
  const markup = text.replace(NOT_MARKUP, (skipped) => " ".repeat(skipped.length));
  const problems: InteractiveProblem[] = [];
  INTERACTIVE_TAG.lastIndex = 0;
  for (let tag = INTERACTIVE_TAG.exec(markup); tag; tag = INTERACTIVE_TAG.exec(markup)) {
    const attributes = tag[1];
    const at = { index: tag.index, length: tag[0].length };
    if (hasAttribute(attributes, "calcplot3d") && !hasAttribute(attributes, "variant")) {
      problems.push({
        ...at,
        kind: "calcplot3d-variant",
        severity: "warning",
        message:
          "A CalcPlot3D interactive needs a variant (application, controls or minimal); without one it shows nothing.",
      });
    }
    if (!input.hasStaticOutput || hasAttribute(attributes, "preview")) continue;
    const selfClosed = /\/\s*$/.test(attributes);
    let hasStatic = false;
    if (!selfClosed) {
      const close = markup.indexOf("</interactive", tag.index + tag[0].length);
      const inside = markup.slice(tag.index + tag[0].length, close < 0 ? undefined : close);
      hasStatic = /<static[\s>/]/.test(inside);
    }
    if (hasStatic) continue;
    problems.push({
      ...at,
      kind: "no-static",
      severity: "info",
      message:
        "This interactive has no picture for PDF and other outputs that are not a web page. " +
        "Add a preview image (the preview attribute) or a <static> element.",
    });
  }
  return problems;
}

/** The Monaco markers for `problems` in `model`. */
export function interactiveMarkers(
  monaco: any,
  model: any,
  problems: readonly InteractiveProblem[],
): any[] {
  return problems.map((problem) => {
    const start = model.getPositionAt(problem.index);
    const end = model.getPositionAt(problem.index + problem.length);
    return {
      severity:
        problem.severity === "warning" ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
      message: problem.message,
      source: INTERACTIVE_MARKER_SOURCE,
      code: problem.kind,
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    };
  });
}

/** The variant the quick fix writes: the whole application, the safest to read. */
export const DEFAULT_CALCPLOT3D_VARIANT = "application";

/**
 * The quick fix for a missing variant on the interactive a marker sits on: the
 * start tag with the variant written after the `calcplot3d` attribute.
 * Recomputed from the model's text, since an edit may have moved things since
 * the marker was published.
 */
export function calcplot3dVariantFix(
  model: any,
  marker: { startLineNumber: number; startColumn: number },
): { index: number; length: number; text: string } | undefined {
  const text: string = model.getValue();
  const offset = model.getOffsetAt({ lineNumber: marker.startLineNumber, column: marker.startColumn });
  const problem = findInteractiveProblems(text, { hasStaticOutput: false }).find(
    (p) => p.index === offset && p.kind === "calcplot3d-variant",
  );
  if (!problem) return undefined;
  const tag = text.slice(problem.index, problem.index + problem.length);
  const fixed = tag.replace(
    /(\scalcplot3d\s*=\s*(?:"[^"]*"|'[^']*'))/,
    `$1 variant="${DEFAULT_CALCPLOT3D_VARIANT}"`,
  );
  return fixed === tag ? undefined : { index: problem.index, length: problem.length, text: fixed };
}
