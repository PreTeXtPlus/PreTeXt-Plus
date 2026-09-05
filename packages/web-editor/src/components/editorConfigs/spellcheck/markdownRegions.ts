import {
  scanDocument,
  type DirectiveOccurrence,
} from "@pretextbook/markdown-style-pretext";
import {
  checkableRegions,
  mathDelimiterRegions,
  mathScopeAt,
  suppressMatches,
  type TextRegion,
} from "./regions";
import type { SpellCheckScope } from "./scopes";

/**
 * Scans Markdown-style PreTeXt source and returns the slices whose words are
 * worth checking, honouring the same {@link SpellCheckScope} the other two
 * scanners do.
 *
 * As in `latexRegions.ts`, each scope is matched to the construct the converter
 * turns into the PreTeXt element the scope names: a fenced code block becomes
 * `<program>`, so it answers to `blockCode`; `![alt](src)` becomes an `<image>`
 * whose alt text lands on an *attribute*, so it answers to `tags` just as
 * `alt="…"` does in XML source.
 *
 * Block structure comes from `scanDocument` in the language package (the
 * scanner behind completions and lint), which knows the two directive syntaxes,
 * where fenced code ends and how math carries across lines.  What's left is
 * inline punctuation — code spans, links, emphasis — matched here line by line,
 * since a delimiter that never closes must cost one line rather than a page.
 *
 * `latexImage` has no Markdown construct to hide: a diagram is *included*
 * (`::latex-image{ref}`) rather than written inline, and the file it points at
 * is edited in its own flavor.  The scope is inert here, not ignored.
 */
export const findCheckableMarkdownRegions = (
  source: string,
  scopes: SpellCheckScope,
): TextRegion[] => {
  const scan = scanDocument(source);
  const suppressed: TextRegion[] = [];

  // YAML frontmatter is document metadata: keys the author didn't choose and
  // values (ids, filenames) no dictionary can judge.
  if (scan.frontmatterRegion) suppressed.push(scan.frontmatterRegion);

  if (scopes.comments === "Ignore") suppressed.push(...scan.commentRegions);
  if (scopes.blockCode === "Ignore") suppressed.push(...scan.codeRegions);

  for (const region of scan.mathRegions) {
    suppressed.push(
      ...(scopes[mathScopeAt(source, region.start)] === "Ignore"
        ? [region]
        : mathDelimiterRegions(source, region)),
    );
  }

  for (const directive of scan.directives) {
    suppressed.push(markerRegion(directive));
  }

  suppressMatches(suppressed, source, MODIFIER_GROUP);
  suppressMatches(suppressed, source, URL);
  suppressMatches(suppressed, source, EMPHASIS_DELIMITER);
  if (scopes.inlineCode === "Ignore") {
    suppressMatches(suppressed, source, INLINE_CODE);
  }
  suppressed.push(...linkRegions(source, scopes));

  return checkableRegions(source.length, suppressed);
};

/**
 * The markup part of a directive marker — the colons and the name, never the
 * `[Title]` that may follow it.  A title becomes a `<title>` element, and
 * element content is checked.
 *
 * A python-style marker (`Theorem[Pythagoras]:`) is reported spanning its whole
 * line, title included, so only its name is taken here.  Colon fences report
 * the marker alone, and their title trails outside it.
 */
const markerRegion = (directive: DirectiveOccurrence): TextRegion =>
  directive.style === "python"
    ? { start: directive.start, end: directive.start + directive.name.length }
    : { start: directive.start, end: directive.end };

/**
 * `{#id}` and `{width=50}` modifiers, wherever they appear — on a directive
 * marker, after a heading, on an include.  Ids and attribute values are markup,
 * so they are hidden whatever the scopes say, as `xml:id="…"` is in XML.
 */
const MODIFIER_GROUP = /\{[^{}\n]*\}/g;

/** Backtick code spans, line-bounded so an unpaired tick costs one line. */
const INLINE_CODE = /`+[^`\n]*`+/g;

/** Bare URLs and `<https://…>` autolinks. */
const URL = /<?(?:https?:\/\/|www\.)[^\s<>()[\]"']+>?/g;

/**
 * The `*`/`_` runs that open or close emphasis — `**bold**`, and `_term_`,
 * which is how this dialect writes a `<term>`.
 *
 * They have to be hidden rather than merely skipped, because a word is judged
 * partly by the characters touching it (`words.ts`) and an underscore against a
 * word normally means an identifier.  Requiring a non-word character on the
 * outer side is what tells `_term_` apart from `snake_case`, whose underscores
 * are word-internal and stay visible — so `snake_case` is still recognised as
 * an identifier and left alone.
 */
const EMPHASIS_DELIMITER =
  /(?<![A-Za-z0-9])[*_]{1,2}(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])[*_]{1,2}(?![A-Za-z0-9])/g;

/** `[text](destination)` and `![alt](source)`, on one line as CommonMark reads them. */
const LINK = /(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g;

/**
 * A link's destination is a path or URL and never checked.  Its text is prose
 * the reader sees — `<url>` content — and stays checked; an image's `[…]` is
 * alt text, which becomes an attribute and so follows `tags`.
 */
const linkRegions = (
  source: string,
  scopes: SpellCheckScope,
): TextRegion[] => {
  const regions: TextRegion[] = [];
  LINK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK.exec(source)) !== null) {
    const [whole, bang, text] = match;
    const textStart = match.index + bang.length + 1;
    const textEnd = textStart + text.length;
    regions.push({ start: textEnd + 1, end: match.index + whole.length });
    if (bang === "!" && scopes.tags === "Ignore") {
      regions.push({ start: textStart, end: textEnd });
    }
  }
  return regions;
};
