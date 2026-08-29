/**
 * Primitives for walking XML markup that is *mid-edit*.
 *
 * Two features read the structure of a PreTeXt buffer without parsing it: the
 * spell checker's region finder (`spellcheck/xmlRegions.ts`) and the Insert
 * menu's placement gate (`insertContext.ts`). Neither can use a real parser —
 * the source is half-typed most of the time — so both walk tags with these
 * helpers instead, and both therefore read a stray `<`, an unterminated tag or
 * a `>` inside an attribute value the same way.
 *
 * The rule they share: malformed input degrades into doing *less*, never into
 * throwing.
 */

/**
 * Index just past a tag's closing `>`, or the end of the source if it is never
 * closed.  Quoted attribute values are skipped, so a `>` inside `title="a > b"`
 * doesn't end the tag early.
 */
export const findTagEnd = (source: string, start: number): number => {
  let quote = "";
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i + 1;
    }
  }
  return source.length;
};

/** Whether `ch` can begin an element name — i.e. whether this `<` opens a tag. */
export const isNameStart = (ch: string | undefined): boolean =>
  ch !== undefined && /[A-Za-z_]/.test(ch);

/** The element name starting at `start`, or `""` if there isn't one. */
export const readName = (source: string, start: number): string => {
  const match = /^[A-Za-z_][\w.:-]*/.exec(source.slice(start, start + 128));
  return match ? match[0] : "";
};

const EMPTY_ELEMENT_SET: ReadonlySet<string> = new Set();

/**
 * Whether `offset` sits in ordinary XML text — not inside a tag (including
 * an attribute value), a comment, a CDATA section, a processing
 * instruction/doctype, or (when given) an element from `suppressedElements`.
 * Walks `source` from the start using the primitives above, degrading
 * tolerantly on malformed/half-typed input the same way `findCheckableRegions`
 * does.
 *
 * Shared by `mathAutoConvert.ts` (which suppresses verbatim/code and
 * already-math elements — semantically, a `$` there usually isn't math) and
 * `angleBracketAutoConvert.ts` (which suppresses nothing, since XML
 * well-formedness/style applies uniformly inside every element's text
 * content).
 */
export const isXmlTextPosition = (
  source: string,
  offset: number,
  suppressedElements: ReadonlySet<string> = EMPTY_ELEMENT_SET,
): boolean => {
  const stack: string[] = [];
  let index = 0;

  const isSuppressed = () => {
    const top = stack[stack.length - 1];
    return top !== undefined && suppressedElements.has(top);
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
