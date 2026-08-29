/**
 * Live escaping of stray `<`/`>` into `&lt;`/`&gt;` as the author types
 * PreTeXt (XML) source: `if x < 5` becomes `if x &lt; 5` the moment the
 * space after the `<` is typed, and `x > 3` becomes `x &gt; 3` the moment
 * the `>` itself is typed.
 *
 * The two directions trigger differently because the disambiguating signal
 * sits on different sides of each character. `<` fires on the *whitespace
 * typed after it*: a real tag's `<` must be immediately followed by a name
 * character, `/`, `!`, or `?`, never whitespace, so waiting for that next
 * character is what makes `< ` unambiguous. `>` fires on *the `>` itself*,
 * checking whether the character already sitting before it is whitespace —
 * the natural mirror once the roles reverse (an author writing `x > 5`
 * types the space before the `>` lands). Either way, what actually keeps
 * real markup safe is {@link isXmlTextPosition}, checked against the
 * bracket's own offset — not the trigger direction: a real tag's `>` is
 * still consumed by `findTagEnd` when resolving the tag its `<` opened,
 * however unusually that tag happens to be formatted (e.g. a trailing
 * space before the bracket, `<p xml:id="x" >`), so it's still correctly
 * left alone.
 *
 * PreTeXt-only — LaTeX and Markdown source aren't XML and don't need this —
 * so this is wired up only from `pretextConfig.ts`.
 */
import { computeLockedRegion } from "../lockedRegion";
import { isXmlTextPosition } from "./xmlTags";

export interface LessThanEscapeMatch {
  /** 1-based column of the `<` character itself. */
  column: number;
  /**
   * 1-based column of a `>` sitting immediately after the just-typed
   * whitespace with nothing in between, or `null` if there isn't one. This
   * is the shape Monaco's `xml` language leaves behind: typing `<` alone
   * auto-closes it to `<>` with the cursor between the two characters, so a
   * space typed there to write a bare comparison (`x < 5`) lands between an
   * already-existing `<` and `>` — the `>` needs to be removed alongside
   * converting the `<`, or it's left dangling.
   */
  danglingGreaterThanColumn: number | null;
}

/**
 * Finds the `<` that a single whitespace character just inserted at
 * `insertColumn` (1-based, Monaco's `change.range.startColumn` for the
 * edit — the position *where* the character was inserted) immediately
 * follows, if any.
 *
 * Works uniformly whether the whitespace is a space/tab typed mid-line or a
 * newline from pressing Enter: `lineText` is read from the model *after*
 * the edit, and in both cases it holds the line's content only up to the
 * insertion point (a newline isn't part of `getLineContent`'s return value
 * at all, and whatever followed the insertion point moved to the next
 * line) — so the character right before the insertion point is always at
 * the same 0-based index. The same reasoning is what makes
 * `danglingGreaterThanColumn` naturally come back `null` after Enter rather
 * than needing special-casing: there's nothing at or past the end of the
 * (now shortened) line to find.
 */
export const findLessThanEscape = (
  lineText: string,
  insertColumn: number,
): LessThanEscapeMatch | null => {
  const ltIdx = insertColumn - 2;
  if (ltIdx < 0 || lineText[ltIdx] !== "<") return null;
  const afterIdx = insertColumn; // 0-based index right after the typed whitespace
  return {
    column: ltIdx + 1,
    danglingGreaterThanColumn: lineText[afterIdx] === ">" ? afterIdx + 1 : null,
  };
};

/**
 * Finds whether a `>` just inserted at `insertColumn` (1-based, Monaco's
 * `change.range.startColumn` for the edit — also the `>`'s own 1-based
 * column, since inserting a character at column C leaves it occupying
 * column C) is immediately preceded by whitespace, in which case it's very
 * likely a stray literal rather than a tag's closing bracket.
 *
 * Returns the 1-based column of the `>` character itself (== `insertColumn`),
 * or `null`.
 */
export const findGreaterThanEscape = (
  lineText: string,
  insertColumn: number,
): number | null => {
  const precedingIdx = insertColumn - 2;
  if (precedingIdx < 0 || !/\s/.test(lineText[precedingIdx] ?? "")) return null;
  return insertColumn;
};

/**
 * Wires {@link findLessThanEscape} and {@link findGreaterThanEscape} into a
 * live Monaco editor, both guarded by {@link isXmlTextPosition} so a
 * bracket that's already legitimately raw — inside a comment, a CDATA
 * section, or an attribute value, or genuinely part of a real tag — is left
 * alone. One listener handles both directions, since they can never both
 * match the same keystroke (a single inserted character is either `>` or
 * whitespace, never both). Registered from `pretextConfig.ts`'s
 * `registerMonacoExtensions`, alongside completions, spell check, and math
 * auto-convert.
 *
 * No custom undo is wired up here: an explicit `model.pushStackElement()`
 * on each side of the edit (see below) is enough to make Ctrl+Z/Cmd+Z
 * immediately after a conversion revert just the conversion, via Monaco's
 * ordinary undo stack — the same fix `mathAutoConvert.ts` needed, applied
 * here from the start.
 */
export const registerAngleBracketAutoConvert = (
  monaco: any,
  editor: any,
): { dispose: () => void } => {
  // Guards the listener against the content-change event our own edit
  // synchronously triggers.
  let isApplying = false;

  const contentListener = editor.onDidChangeModelContent((event: any) => {
    if (isApplying) return;

    const changes = event?.changes;
    if (!Array.isArray(changes) || changes.length !== 1) return;
    const change = changes[0];
    if (change.rangeLength !== 0 || change.text?.length !== 1) return;

    const model = editor.getModel();
    if (!model) return;

    const line = change.range.startLineNumber;
    const lineText = model.getLineContent(line);

    // The range/replacement to apply, in terms of columns on `line`.
    let startColumn: number;
    let endColumn: number; // exclusive
    let replacement: string;
    if (change.text === ">") {
      const column = findGreaterThanEscape(lineText, change.range.startColumn);
      if (column === null) return;
      startColumn = column;
      endColumn = column + 1;
      replacement = "&gt;";
    } else if (/\s/.test(change.text)) {
      const match = findLessThanEscape(lineText, change.range.startColumn);
      if (!match) return;
      startColumn = match.column;
      if (match.danglingGreaterThanColumn === null) {
        endColumn = match.column + 1;
        replacement = "&lt;";
      } else {
        // Sweep the auto-closed ">" Monaco left behind into the same edit
        // (see LessThanEscapeMatch), keeping the whitespace the author
        // actually typed.
        endColumn = match.danglingGreaterThanColumn + 1;
        replacement = "&lt;" + change.text;
      }
    } else {
      return;
    }

    const region = computeLockedRegion(model, "pretext");
    if (region?.lockedLines.includes(line)) return;

    const offset = model.getOffsetAt({ lineNumber: line, column: startColumn });
    if (!isXmlTextPosition(model.getValue(), offset)) return;

    const range = new monaco.Range(line, startColumn, line, endColumn);
    model.pushStackElement();
    isApplying = true;
    try {
      editor.executeEdits("angle-bracket-auto-convert", [
        { range, text: replacement, forceMoveMarkers: true },
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
