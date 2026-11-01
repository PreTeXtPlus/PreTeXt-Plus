/**
 * Which `$` in Markdown-style PreTeXt is math.
 *
 * `@pretextbook/remark-pretext` decides it locally, so that prices and the `$`
 * in a URL stay text: a `$…$` pair is math only if it sits on one line, holds no
 * backtick, hugs its content on both sides, and has no letter or digit touching
 * it on the outside. That rule is mirrored here because the converter doesn't
 * export it and the editor has to agree with it. `__tests__/markdownDollars.test.ts`
 * compares the two, so a change to the converter fails there.
 */

/** A letter or digit, which rules out a `$` touching it from outside the pair. */
export const WORD_CHAR = /[\p{L}\p{N}]/u;

/** A `$…$` pair, from its opening `$`; the character before that is the caller's. */
export const INLINE_MATH = new RegExp(
  String.raw`\$(?![\s$])(?:[^$\\` + "`" + String.raw`\n]|\\.)*(?<!\s)\$(?!${WORD_CHAR.source})`,
  "u",
);

// Escapes and `$$` are matched first so that their `$`s are never read as lone.
const DOLLAR_TOKEN = new RegExp(
  String.raw`\\[\s\S]|\$\$|(?<!${WORD_CHAR.source})${INLINE_MATH.source}|\$`,
  "gu",
);

const blankProseDollars = (text: string): string =>
  text.replace(DOLLAR_TOKEN, (token) => (token === "$" ? " " : token));

/**
 * `text` with each `$` that isn't math blanked, for `scanDocument` in
 * `@pretextbook/markdown-style-pretext`. The scanner pairs every `$` it meets
 * and carries an open one across lines, so a lone `$5` would otherwise make the
 * rest of the document math: no directives, no ids, no spell checking. Blanking
 * keeps the length, so every offset the scanner reports still fits the source.
 *
 * Pass `cursor` when asking about that position: math still being typed has no
 * closing `$` yet, so the line under the cursor is left as it is.
 */
export const maskProseDollars = (text: string, cursor?: number): string => {
  if (cursor === undefined) return blankProseDollars(text);

  const lineStart = text.slice(0, cursor).lastIndexOf("\n") + 1;
  const newline = text.indexOf("\n", cursor);
  const lineEnd = newline === -1 ? text.length : newline;
  return (
    blankProseDollars(text.slice(0, lineStart)) +
    text.slice(lineStart, lineEnd) +
    blankProseDollars(text.slice(lineEnd))
  );
};
