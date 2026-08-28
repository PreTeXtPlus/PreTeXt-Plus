/**
 * Live conversion of LaTeX-style math delimiters into PreTeXt markup as the
 * author types: `$math$` → `<m>math</m>`, `$$math$$` → `<md>math</md>`.
 *
 * PreTeXt-only — LaTeX and Markdown source treat `$`/`$$` as their own valid
 * native syntax (see `latexSyntax.ts`, `markdownSyntax.ts`), so this is wired
 * up only from `pretextConfig.ts`.
 *
 * Matching is deliberately narrow: only within the same line and the same
 * XML text node (never spanning a tag boundary), and never inside markup, a
 * comment/CDATA block, or an element whose content is verbatim or already
 * math. A conversion can be undone immediately by pressing Escape.
 */
import { computeLockedRegion } from "../lockedRegion";
import { SCOPE_ELEMENTS } from "./spellcheck/scopes";
import { findTagEnd, isNameStart, readName } from "./xmlTags";

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
 * {@link NEVER_CONVERT_ELEMENTS}. Walks `source` from the start using the
 * same tolerant, half-typed-markup-safe primitives as
 * `spellcheck/xmlRegions.ts`'s `findCheckableRegions`.
 */
export const isMathConvertibleContext = (
  source: string,
  offset: number,
): boolean => {
  const stack: string[] = [];
  let index = 0;

  const isSuppressed = () => {
    const top = stack[stack.length - 1];
    return top !== undefined && NEVER_CONVERT_ELEMENTS.has(top);
  };

  while (index < offset) {
    const lt = source.indexOf("<", index);
    if (lt === -1 || lt >= offset) return !isSuppressed();
    // From here on, lt < offset.

    if (source.startsWith("<!--", lt)) {
      const close = source.indexOf("-->", lt + 4);
      if (close === -1) return false;
      const end = close + 3;
      if (offset < end) return false;
      index = end;
    } else if (source.startsWith("<![CDATA[", lt)) {
      const close = source.indexOf("]]>", lt + 9);
      if (close === -1) return false;
      const end = close + 3;
      if (offset < end) return false;
      index = end;
    } else if (source.startsWith("<?", lt)) {
      const close = source.indexOf("?>", lt + 2);
      if (close === -1) return false;
      const end = close + 2;
      if (offset < end) return false;
      index = end;
    } else if (source.startsWith("<!", lt)) {
      const close = source.indexOf(">", lt + 2);
      if (close === -1) return false;
      const end = close + 1;
      if (offset < end) return false;
      index = end;
    } else if (source.startsWith("</", lt)) {
      const end = findTagEnd(source, lt);
      if (offset < end) return false;
      const name = readName(source, lt + 2);
      const opened = stack.lastIndexOf(name);
      if (opened !== -1) stack.length = opened;
      index = end;
    } else if (isNameStart(source[lt + 1])) {
      const end = findTagEnd(source, lt);
      if (offset < end) return false;
      const name = readName(source, lt + 1);
      const selfClosing = source[end - 2] === "/";
      if (!selfClosing) stack.push(name);
      index = end;
    } else {
      // A stray '<' that doesn't open a tag — ordinary text; keep scanning.
      index = lt + 1;
    }
  }

  return !isSuppressed();
};

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
    if (content.length === 0) return null;
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
  if (content.length === 0) return null;
  return {
    startColumn: openIdx + 1,
    endColumn: column,
    replacement: `<m>${content}</m>`,
  };
};

/** What Escape can undo: the range the conversion produced, and what it replaced. */
interface PendingRevert {
  range: unknown;
  original: string;
}

/**
 * Wires {@link isMathConvertibleContext} and {@link findLineMathMatch} into a
 * live Monaco editor. Registered from `pretextConfig.ts`'s
 * `registerMonacoExtensions`, alongside completions and spell check.
 */
export const registerMathAutoConvert = (
  monaco: any,
  editor: any,
): { dispose: () => void } => {
  // Guards the listener against the content-change events our own edits
  // (conversion and revert) synchronously trigger.
  let isApplying = false;
  let pending: PendingRevert | null = null;

  const contentListener = editor.onDidChangeModelContent((event: any) => {
    if (isApplying) return;
    // Any further edit forfeits the Escape-undo window for the previous
    // conversion — it doesn't try to track a pending range across an
    // unrelated edit.
    if (pending) pending = null;

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
    isApplying = true;
    try {
      editor.executeEdits("math-auto-convert", [
        { range, text: match.replacement, forceMoveMarkers: true },
      ]);
    } finally {
      isApplying = false;
    }

    pending = {
      range: new monaco.Range(
        line,
        match.startColumn,
        line,
        match.startColumn + match.replacement.length,
      ),
      original: lineText.slice(match.startColumn - 1, match.endColumn - 1),
    };
  });

  const keyListener = editor.onKeyDown((event: any) => {
    if (event.keyCode !== monaco.KeyCode.Escape || !pending) return;
    // Consume the keystroke only when there's something to undo, so Monaco's
    // default Escape handling (closing suggestion/find widgets, etc.) is
    // untouched the rest of the time.
    event.preventDefault();
    event.stopPropagation();

    const revert = pending;
    pending = null;
    isApplying = true;
    try {
      editor.executeEdits("math-auto-convert-undo", [
        { range: revert.range, text: revert.original, forceMoveMarkers: true },
      ]);
    } finally {
      isApplying = false;
    }
  });

  return {
    dispose: () => {
      contentListener?.dispose?.();
      keyListener?.dispose?.();
    },
  };
};
