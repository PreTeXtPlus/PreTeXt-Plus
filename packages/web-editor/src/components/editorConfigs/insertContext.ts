/**
 * The Insert menu's placement gate: what a snippet has to look like, and where
 * it has to go, given what the cursor is standing in.
 *
 * PreTeXt decides an element's legality by its parent. A list or a displayed
 * equation is only valid *inside* a `<p>`; a theorem, a figure or a paragraph
 * is only valid *outside* one. A menu that always wrote the same text would
 * therefore be right only half the time — inserting a bulleted list into the
 * middle of a sentence would nest `<p>` inside `<p>`, and inserting a theorem
 * there would put a block element in mixed content. Both are rejected by the
 * schema, and the author sees a lint error for a menu item they were offered.
 *
 * So the bodies in `snippets.ts` are written bare, and the decision is made
 * here against the buffer:
 *
 * - **in-paragraph** construct, cursor inside a `<p>` → insert it as written.
 * - **in-paragraph** construct, cursor outside → wrap it in its own `<p>`.
 * - **block** construct, cursor inside a `<p>` → insert it *after* that
 *   paragraph, on a line of its own.
 * - **block** construct, cursor outside → insert it as written.
 *
 * Only PreTeXt buffers are gated. LaTeX and Markdown have no `<p>` for the
 * cursor to be inside of, and their bodies carry no wrapper to add or remove.
 */
import type { SourceFormat } from "../../types/editor";
import { type EditorSnippet, wrapInParagraph } from "./snippets";
import { findTagEnd, isNameStart, readName } from "./xmlTags";

/** The `<p>` the cursor is standing in. */
export interface EnclosingParagraph {
  /** Offset just past the `<p>` open tag. */
  contentStart: number;
  /** Offset just past the matching `</p>`, or the source's end if it has none. */
  end: number;
}

/**
 * The innermost `<p>` containing `offset`, or `null` if the cursor isn't in one.
 *
 * This walks tags rather than parsing, because the source is mid-edit: a stray
 * `<`, an unterminated tag or an unbalanced end tag has to mean "assume less"
 * instead of throwing. An end tag closes the *nearest* matching open element,
 * so unbalanced markup costs at most the elements in between rather than
 * desynchronising the stack for the rest of the buffer — the same rule the
 * spell checker's scanner follows.
 *
 * Boundaries fall where an author would expect: a cursor just after `<p>` or
 * just before `</p>` is inside; just before `<p>` or just after `</p>` is not.
 */
export const enclosingParagraph = (
  source: string,
  offset: number,
): EnclosingParagraph | null => {
  // Open elements, innermost last.
  const stack: { name: string; contentStart: number }[] = [];
  // The paragraph enclosing the cursor, once the walk has reached it: its depth
  // in the stack, so the end tag that pops it can be recognised.
  let paragraph: { depth: number; contentStart: number } | null = null;
  let reachedCursor = false;

  /** The innermost open `<p>`, once the walk has arrived at the cursor. */
  const openParagraph = () => {
    for (let depth = stack.length - 1; depth >= 0; depth--) {
      if (stack[depth].name === "p") {
        return { depth, contentStart: stack[depth].contentStart };
      }
    }
    return null;
  };

  let index = 0;
  while (index < source.length) {
    const lt = source.indexOf("<", index);
    if (lt === -1) break;
    if (!reachedCursor && lt >= offset) {
      reachedCursor = true;
      paragraph = openParagraph();
      // Nothing encloses the cursor, so there is no end tag to go looking for.
      if (!paragraph) return null;
    }

    if (source.startsWith("<!--", lt)) {
      const close = source.indexOf("-->", lt + 4);
      index = close === -1 ? source.length : close + 3;
    } else if (source.startsWith("<![CDATA[", lt)) {
      const close = source.indexOf("]]>", lt + 9);
      index = close === -1 ? source.length : close + 3;
    } else if (source.startsWith("<?", lt)) {
      const close = source.indexOf("?>", lt + 2);
      index = close === -1 ? source.length : close + 2;
    } else if (source.startsWith("<!", lt)) {
      // Doctype and other declarations.
      const close = source.indexOf(">", lt + 2);
      index = close === -1 ? source.length : close + 1;
    } else if (source.startsWith("</", lt)) {
      const end = findTagEnd(source, lt);
      const name = readName(source, lt + 2);
      for (let depth = stack.length - 1; depth >= 0; depth--) {
        if (stack[depth].name !== name) continue;
        stack.length = depth;
        break;
      }
      // The paragraph closed here — either by its own end tag or by an ancestor
      // closing over it, which mid-edit markup does often enough to allow for.
      if (paragraph && stack.length <= paragraph.depth) {
        return { contentStart: paragraph.contentStart, end };
      }
      index = end;
    } else if (isNameStart(source[lt + 1])) {
      const end = findTagEnd(source, lt);
      // `<foo/>`: the `/` sits immediately before the closing `>`.
      if (source[end - 2] !== "/") {
        stack.push({ name: readName(source, lt + 1), contentStart: end });
      }
      index = end;
    } else {
      // A `<` that doesn't open a tag — "if a < b", or a tag half typed.
      index = lt + 1;
    }
  }

  if (!reachedCursor) paragraph = openParagraph();
  // An unterminated paragraph: it runs to the end of what has been written.
  return paragraph
    ? { contentStart: paragraph.contentStart, end: source.length }
    : null;
};

/** Where a snippet should be written, and what it should say when it gets there. */
export interface SnippetInsertion {
  /** Offset to insert at — the cursor, unless the snippet has to escape a `<p>`. */
  offset: number;
  /** Monaco snippet text, wrapped or moved onto its own line as needed. */
  body: string;
}

/**
 * Fit `snippet` to the cursor's surroundings — see this module's header for the
 * four cases. Offsets are into `source`; the caller converts them back to
 * editor positions.
 */
export const planSnippetInsertion = (
  source: string,
  offset: number,
  snippet: EditorSnippet,
  sourceFormat: SourceFormat,
): SnippetInsertion => {
  if (sourceFormat !== "pretext") return { offset, body: snippet.body };
  const paragraph = enclosingParagraph(source, offset);

  if (snippet.placement === "in-paragraph") {
    return {
      offset,
      body: paragraph ? snippet.body : wrapInParagraph(snippet.body),
    };
  }
  // A block construct can't nest in a paragraph and splitting one would be a
  // bigger surprise than moving past it, so it lands after the `</p>`.
  return paragraph
    ? { offset: paragraph.end, body: `\n${snippet.body}` }
    : { offset, body: snippet.body };
};
