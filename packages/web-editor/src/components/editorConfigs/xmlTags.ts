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
