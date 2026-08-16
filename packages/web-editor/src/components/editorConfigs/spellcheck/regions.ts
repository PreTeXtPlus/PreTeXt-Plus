import type { SpellCheckScope } from "./scopes";

/** A half-open `[start, end)` slice of the source that should be spell checked. */
export interface TextRegion {
  start: number;
  end: number;
}

/**
 * Finds the slices of a source worth spell checking, honouring the scopes.
 *
 * Every source format the editor knows supplies one — `xmlRegions.ts` for
 * PreTeXt, `latexRegions.ts` and `markdownRegions.ts` for the two flavors —
 * which is the *only* thing that differs between them.  Word extraction, the
 * dictionary, the markers and the quick fixes are shared, so a flavor is taught
 * to spell check by writing a finder and nothing else.
 */
export type RegionFinder = (
  source: string,
  scopes: SpellCheckScope,
) => TextRegion[];

/**
 * Inverts a set of suppressed spans into the regions worth checking.
 *
 * The XML scanner works the other way round — it emits text runs directly —
 * because XML markup announces itself with `<` and the text between tags is
 * what's left over.  In LaTeX and Markdown prose is the default and markup is
 * sparse, and both flavor packages already ship a scanner that reports where
 * the markup *is*, so their finders collect what to hide and complement it here.
 *
 * Spans may overlap, nest and arrive in any order; a `<latex-image>` inside an
 * ignored `program` is hidden twice and that has to be harmless.
 */
export const checkableRegions = (
  length: number,
  suppressed: readonly TextRegion[],
): TextRegion[] => {
  const spans = suppressed
    .filter((span) => span.end > span.start && span.start < length)
    .sort((a, b) => a.start - b.start);

  const regions: TextRegion[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      regions.push({ start: cursor, end: Math.min(span.start, length) });
    }
    cursor = Math.max(cursor, span.end);
    if (cursor >= length) return regions;
  }
  if (cursor < length) regions.push({ start: cursor, end: length });

  return regions;
};

/** Adds every match of `pattern` to `suppressed`. `pattern` must be global. */
export const suppressMatches = (
  suppressed: TextRegion[],
  source: string,
  pattern: RegExp,
): void => {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    suppressed.push({ start: match.index, end: match.index + match[0].length });
    // A zero-width match would spin the loop forever; nudge past it.
    if (match[0].length === 0) pattern.lastIndex++;
  }
};

/**
 * Which math scope a delimited region answers to, read off its opening
 * delimiter.  Shared by both flavors, which delimit math identically: `$…$` and
 * `\(…\)` become `<m>`, `$$…$$` and `\[…\]` become `<me>`/`<md>`.
 */
export const mathScopeAt = (
  source: string,
  start: number,
): "inlineMath" | "displayMath" =>
  source.startsWith("$$", start) || source.startsWith("\\[", start)
    ? "displayMath"
    : "inlineMath";

/**
 * The delimiters of a math region, which are markup even when the math itself
 * is being checked.  Without hiding them a `$` would sit against the first and
 * last word of the formula, and a word touching one reads as machine-readable
 * (`words.ts`) — so switching a math scope to `"Check"` would appear to do
 * nothing to a one-word formula.
 */
export const mathDelimiterRegions = (
  source: string,
  region: TextRegion,
): TextRegion[] => {
  const width = source.startsWith("$", region.start)
    ? (source.startsWith("$$", region.start) ? 2 : 1)
    : 2; // `\(…\)` and `\[…\]`
  const open = { start: region.start, end: region.start + width };
  const close = { start: region.end - width, end: region.end };
  // An unterminated region runs to the end of the source and has no closer.
  return close.start >= open.end ? [open, close] : [open];
};
