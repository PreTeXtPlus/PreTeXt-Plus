/**
 * Live conversion of LaTeX-style math delimiters into PreTeXt markup as the
 * author types: `$math$` → `<m>math</m>`, `$$math$$` → `<md>math</md>`.
 *
 * PreTeXt-only — LaTeX and Markdown source treat `$`/`$$` as their own valid
 * native syntax (see `latexSyntax.ts`, `markdownSyntax.ts`), so this is wired
 * up only from `pretextConfig.ts`.
 *
 * Matching is deliberately narrow: only within the same line and the same
 * XML text node (never spanning a tag boundary), never inside markup, a
 * comment/CDATA block, or an element whose content is verbatim or already
 * math, and never when the closing delimiter is preceded by whitespace (that
 * shape is far more likely to be an unrelated `$…` starting, e.g. "$5 or
 * $10", than the end of real math). A conversion is rejected the same way
 * any other edit is: Ctrl+Z/Cmd+Z, via Monaco's own undo stack.
 */
import { computeLockedRegion } from "../lockedRegion";
import { SCOPE_ELEMENTS } from "./spellcheck/scopes";
import { isXmlTextPosition } from "./xmlTags";

/**
 * Elements whose contents should never be auto-converted: verbatim/code
 * elements (a shell prompt's `$` is not math) and elements that are already
 * math. Reuses the spell checker's element lists (`SCOPE_ELEMENTS`) rather
 * than maintaining a second copy of the same PreTeXt vocabulary.
 */
const NEVER_CONVERT_ELEMENTS = new Set(Object.values(SCOPE_ELEMENTS).flat());

/**
 * Whether `offset` sits in ordinary text — not inside a tag, comment, CDATA
 * section or processing instruction, and not inside an element from
 * {@link NEVER_CONVERT_ELEMENTS}. A thin wrapper around
 * `xmlTags.ts`'s `isXmlTextPosition`, the shared walker.
 */
export const isMathConvertibleContext = (
  source: string,
  offset: number,
): boolean => isXmlTextPosition(source, offset, NEVER_CONVERT_ELEMENTS);

export interface LineMathMatch {
  /** 1-based, inclusive — start of the opening delimiter. */
  startColumn: number;
  /** 1-based, exclusive — equal to `column`, just past the typed `$`. */
  endColumn: number;
  replacement: string;
}

/**
 * Finds the `$...$` / `$$...$$` span that a `$` just typed at `column`
 * (1-based, Monaco-style — the position immediately after the new
 * character) closes, if any. Pure, single-line string logic: the search
 * never looks past the nearest earlier `>` on the line, which is what keeps
 * a match from spanning two XML text nodes (e.g. `<p>a</p> $x$` can only
 * match `$x$`).
 */
export const findLineMathMatch = (
  lineText: string,
  column: number,
): LineMathMatch | null => {
  const dollarIdx = column - 2;
  if (dollarIdx < 0 || lineText[dollarIdx] !== "$") return null;

  const boundary = lineText.lastIndexOf(">", dollarIdx - 1);
  const searchStart = boundary === -1 ? 0 : boundary + 1;

  const closesDisplay =
    dollarIdx - 1 >= searchStart && lineText[dollarIdx - 1] === "$";

  if (closesDisplay) {
    const closerStart = dollarIdx - 1;
    if (closerStart - 2 < searchStart) return null;
    const openIdx = lineText.lastIndexOf("$$", closerStart - 2);
    if (openIdx === -1 || openIdx < searchStart) return null;
    if (
      openIdx > searchStart &&
      (lineText[openIdx - 1] === "$" || lineText[openIdx - 1] === "\\")
    ) {
      return null;
    }
    const content = lineText.slice(openIdx + 2, closerStart);
    // A closer preceded by whitespace is far more likely to be the start of
    // an unrelated `$…` (e.g. "$5 or $$10") than the end of real math, which
    // essentially never ends its content right on a trailing space.
    if (content.length === 0 || /\s$/.test(content)) return null;
    return {
      startColumn: openIdx + 1,
      endColumn: column,
      replacement: `<md>${content}</md>`,
    };
  }

  const closerIdx = dollarIdx;
  let openIdx = -1;
  for (let i = closerIdx - 1; i >= searchStart; i--) {
    if (lineText[i] === "$") {
      openIdx = i;
      break;
    }
  }
  if (openIdx === -1) return null;
  // A '$' immediately preceded by another '$' is an unresolved `$$` run —
  // ambiguous, so bail rather than guess.
  if (openIdx > searchStart && lineText[openIdx - 1] === "$") return null;
  if (openIdx > searchStart && lineText[openIdx - 1] === "\\") return null;
  const content = lineText.slice(openIdx + 1, closerIdx);
  // See the display branch above: a closer preceded by whitespace is more
  // likely to be an unrelated `$…` starting (e.g. "$5 or $10") than the end
  // of real math.
  if (content.length === 0 || /\s$/.test(content)) return null;
  return {
    startColumn: openIdx + 1,
    endColumn: column,
    replacement: `<m>${content}</m>`,
  };
};

/**
 * Wires {@link isMathConvertibleContext} and {@link findLineMathMatch} into a
 * live Monaco editor. Registered from `pretextConfig.ts`'s
 * `registerMonacoExtensions`, alongside completions and spell check.
 *
 * No custom undo is wired up here: an explicit `model.pushStackElement()` on
 * each side of the conversion edit (see below) is enough to make Ctrl+Z/
 * Cmd+Z immediately after a conversion revert just the conversion, via
 * Monaco's ordinary undo stack — no bespoke mechanism needed.
 */
export const registerMathAutoConvert = (
  monaco: any,
  editor: any,
): { dispose: () => void } => {
  // Guards the listener against the content-change event our own conversion
  // edit synchronously triggers.
  let isApplying = false;

  const contentListener = editor.onDidChangeModelContent((event: any) => {
    if (isApplying) return;

    const changes = event?.changes;
    if (!Array.isArray(changes) || changes.length !== 1) return;
    const change = changes[0];
    if (change.text !== "$" || change.rangeLength !== 0) return;

    const model = editor.getModel();
    if (!model) return;

    const line = change.range.startLineNumber;
    const column = change.range.startColumn + 1;

    const region = computeLockedRegion(model, "pretext");
    if (region?.lockedLines.includes(line)) return;

    const offset = model.getOffsetAt({ lineNumber: line, column });
    if (!isMathConvertibleContext(model.getValue(), offset)) return;

    const lineText = model.getLineContent(line);
    const match = findLineMathMatch(lineText, column);
    if (!match) return;

    const range = new monaco.Range(
      line,
      match.startColumn,
      line,
      match.endColumn,
    );
    // Left alone, this edit lands inside the same undo group as the user's
    // just-typed "$" (and whatever typing preceded it), since it runs
    // synchronously inside that keystroke's content-change handler — so one
    // Ctrl+Z would delete the converted text outright instead of reverting
    // it to "$math$"/"$$math$$". Closing the undo group off on both sides
    // (the same `pushStackElement` idiom `latexClean.ts` uses) makes the
    // conversion its own atomic undo step.
    model.pushStackElement();
    isApplying = true;
    try {
      editor.executeEdits("math-auto-convert", [
        { range, text: match.replacement, forceMoveMarkers: true },
      ]);
    } finally {
      isApplying = false;
    }
    model.pushStackElement();
  });

  return {
    dispose: () => {
      contentListener?.dispose?.();
    },
  };
};
