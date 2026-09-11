/**
 * Shift+Enter's paragraph split: word-processor-style "new paragraph" for the
 * `<p>` the cursor is standing in.
 *
 * A cursor directly in the paragraph's own text splits cleanly: `</p>\n<p>`
 * at the cursor turns one `<p>` into two. A cursor nested inside inline
 * markup (`<em>`, `<term>`, ...) can't be split the same way without closing
 * and reopening every open ancestor, and there's no safe way to do that
 * blind — an ancestor like `<xref ref="...">` carries an attribute a
 * reopened copy would either drop or duplicate. So that case degrades
 * instead of guessing, the same rule `enclosingParagraph` itself follows:
 * leave the paragraph's text untouched and append an empty sibling `<p>`
 * after it instead.
 */
import { enclosingParagraph } from "./insertContext";
import { findTagEnd, isNameStart } from "./xmlTags";

/** Where Shift+Enter should write, and what — offsets are into the source. */
export interface ParagraphSplit {
  /** Offset to insert at: the cursor for a real split, the paragraph's end for the fallback. */
  offset: number;
  /** Monaco snippet text; `$0` marks where the cursor should land. */
  body: string;
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

  return isDirectParagraphText(source, paragraph.contentStart, offset)
    ? { offset, body: "</p>\n<p>$0" }
    : { offset: paragraph.end, body: "\n<p>$0</p>" };
};
