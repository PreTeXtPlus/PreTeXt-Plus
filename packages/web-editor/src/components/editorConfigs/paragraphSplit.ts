/**
 * Shift+Enter's paragraph split: word-processor-style "new paragraph" for the
 * `<p>` the cursor is standing in.
 *
 * A cursor directly in the paragraph's own text splits cleanly: the element is
 * reconstructed as two well-formatted `<p>` elements, each on its own line at
 * the same indentation as the original, with the text content split at the
 * cursor between them. A cursor nested inside inline markup (`<em>`, `<term>`,
 * ...) can't be split the same way without closing and reopening every open
 * ancestor, and there's no safe way to do that blind — an ancestor like
 * `<xref ref="...">` carries an attribute a reopened copy would either drop or
 * duplicate. So that case degrades instead of guessing, the same rule
 * `enclosingParagraph` itself follows: leave the paragraph's text untouched
 * and append an empty, matching-indentation sibling `<p>` after it instead.
 *
 * Only the structural wrapper is reformatted. The original opening tag's text
 * — attributes included — is copied verbatim onto the first resulting `<p>`;
 * the second is always bare, since copying an `xml:id` onto both would
 * collide.
 */
import { enclosingParagraph } from "./insertContext";
import { findTagEnd, isNameStart } from "./xmlTags";

/** A span to replace, and what to replace it with. Offsets are into the source. */
export interface ParagraphSplit {
  /** The span being rewritten — the whole `<p>...</p>`, or a zero-width point
   *  at its end for the nested-markup fallback (a pure insertion). */
  range: { start: number; end: number };
  /** Literal replacement text. */
  text: string;
  /** Absolute offset, in the *resulting* document, where the cursor lands. */
  cursorOffset: number;
}

/**
 * Whether `offset` is a direct text child of the `<p>` starting at
 * `contentStart` — not nested inside inline markup, nor inside a tag,
 * comment, or CDATA section. Only this case can be split cleanly.
 */
const isDirectParagraphText = (
  source: string,
  contentStart: number,
  offset: number,
): boolean => {
  let depth = 0;
  let index = contentStart;
  while (index < offset) {
    const lt = source.indexOf("<", index);
    if (lt === -1 || lt >= offset) return depth === 0;

    if (source.startsWith("<!--", lt)) {
      const close = source.indexOf("-->", lt + 4);
      if (close === -1 || offset < close + 3) return false;
      index = close + 3;
    } else if (source.startsWith("<![CDATA[", lt)) {
      const close = source.indexOf("]]>", lt + 9);
      if (close === -1 || offset < close + 3) return false;
      index = close + 3;
    } else if (source.startsWith("</", lt)) {
      const end = findTagEnd(source, lt);
      if (offset < end) return false;
      if (depth > 0) depth--;
      index = end;
    } else if (isNameStart(source[lt + 1])) {
      const end = findTagEnd(source, lt);
      if (offset < end) return false;
      // `<foo/>`: self-closing, so it never nests the offset that follows it.
      if (source[end - 2] !== "/") depth++;
      index = end;
    } else {
      // A `<` that doesn't open a tag — ordinary text; keep scanning.
      index = lt + 1;
    }
  }
  return depth === 0;
};

/**
 * The whitespace `offset` sits after on its own line — the indentation to
 * reuse for a new sibling line — or `""` if anything but whitespace precedes
 * it there (the source is mid-edit; nothing to copy, so nothing is guessed).
 */
const lineIndent = (source: string, offset: number): string => {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const prefix = source.slice(lineStart, offset);
  return /^[ \t]*$/.test(prefix) ? prefix : "";
};

/**
 * How Shift+Enter should act on the `<p>` enclosing `offset`, or `null` if
 * the cursor isn't inside one at all (the caller falls back to a plain
 * newline).
 */
export const planParagraphSplit = (
  source: string,
  offset: number,
): ParagraphSplit | null => {
  const paragraph = enclosingParagraph(source, offset);
  if (!paragraph) return null;
  const { tagStart, contentStart, closeTagStart, end } = paragraph;
  const indent = lineIndent(source, tagStart);

  if (!isDirectParagraphText(source, contentStart, offset)) {
    const text = `\n${indent}<p></p>`;
    return {
      range: { start: end, end },
      text,
      cursorOffset: end + "\n".length + indent.length + "<p>".length,
    };
  }

  const openTag = source.slice(tagStart, contentStart);
  const before = source.slice(contentStart, offset);
  const after = source.slice(offset, closeTagStart ?? end);
  const originalClose =
    closeTagStart !== undefined ? source.slice(closeTagStart, end) : "";

  const text = `${openTag}${before}</p>\n${indent}<p>${after}${originalClose}`;
  const cursorOffset =
    tagStart +
    openTag.length +
    before.length +
    "</p>\n".length +
    indent.length +
    "<p>".length;

  return { range: { start: tagStart, end }, text, cursorOffset };
};
