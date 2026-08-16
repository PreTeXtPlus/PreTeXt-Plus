import { formatPretext } from "@pretextbook/format";
import { latexToPretext } from "@pretextbook/latex-pretext";
import { markdownToPretext } from "@pretextbook/remark-pretext";
import { cleanLatexText, describeFix } from "@pretextbook/latex-style-pretext";
import { summarizeCleanFixes, type CleanFinding } from "./cleanFindings";
import type { SourceFormat } from "./types/editor";

/** Returned by {@link derivePretextContent}. Exactly one of the two fields will be set. */
export interface DerivedPretextResult {
  /** The converted (or pass-through) PreTeXt XML string. */
  pretextSource?: string;
  /** Human-readable error when conversion fails. */
  pretextError?: string;
}

/**
 * Heuristic markers that strongly suggest a document is LaTeX rather than
 * PreTeXt/XML.  Checked in order by {@link detectSourceFormat}.  Includes the
 * root-division headers (`\article{`, `\book{`, `\slideshow{`) that
 * `@pretextbook/latex-pretext` emits for a document's top-level division,
 * alongside `\section`/`\chapter` for non-root divisions.
 */
const LATEX_FORMAT_MARKERS = [
  "\\documentclass",
  "\\begin{document}",
  "\\begin{",
  "\\article{",
  "\\book{",
  "\\slideshow{",
  "\\section",
  "\\chapter",
  "\\title",
  "\\author",
];

/**
 * Heuristic markers that strongly suggest a document is Markdown.
 * Checked against the first line of the document.
 */
const MARKDOWN_FORMAT_MARKERS = ["# ", "## ", "### ", "#### "];

/**
 * Matches a leading `---` ... `---` YAML frontmatter block, the other strong
 * Markdown signal: a division whose title now lives in frontmatter (a
 * `title:` key) rather than a leading `# heading` won't match
 * {@link MARKDOWN_FORMAT_MARKERS} at all.
 */
const MARKDOWN_FRONTMATTER_RE = /^[ \t]*---[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*---[ \t]*(?:\r?\n|$)/;

/**
 * Inspects `source` and returns the most likely {@link SourceFormat}.
 *
 * Rules (applied in order):
 * 1. Empty/whitespace-only → `"pretext"` (safe default).
 * 2. Starts with `<` → `"pretext"` (XML document).
 * 3. Contains any {@link LATEX_FORMAT_MARKERS} → `"latex"`.
 * 4. First non-blank line starts with a Markdown ATX heading, or the document
 *    opens with a YAML frontmatter block → `"markdown"`.
 * 5. Otherwise → `"pretext"`.
 */
export function detectSourceFormat(source: string): SourceFormat {
  const trimmedContent = source.trim();
  if (!trimmedContent) {
    return "pretext";
  }
  if (trimmedContent.startsWith("<")) {
    return "pretext";
  }
  if (LATEX_FORMAT_MARKERS.some((marker) => trimmedContent.includes(marker))) {
    return "latex";
  }
  if (
    MARKDOWN_FORMAT_MARKERS.some((marker) => trimmedContent.startsWith(marker)) ||
    MARKDOWN_FRONTMATTER_RE.test(trimmedContent)
  ) {
    return "markdown";
  }
  return "pretext";
}

/** Returned by {@link cleanLatexSource}. */
export interface CleanedLatex {
  /** The cleaned source. */
  latex: string;
  /** What the cleaner did, and what it left for the author, one row per rule. */
  findings: CleanFinding[];
}

/**
 * Runs the source cleaner over a piece of LaTeX: legacy markup that converts
 * badly or shouldn't survive into PreTeXt (`\vspace`, `{\bf …}`, plain-TeX
 * font switches) is removed or rewritten, to a fixpoint.
 *
 * This is the *import* path — text arriving from outside the project, where
 * stripping presentational LaTeX is the whole point. It is deliberately not
 * applied to a division the author is editing: `derivePretextContent` below
 * leaves their source alone and converts it as written, and cleanup there is
 * an explicit action (the "Clean up LaTeX…" toolbar button) that edits the
 * source they can see rather than silently changing what gets built.
 *
 * Note this is the language package's cleaner, not `@pretextbook/import`'s:
 * that one also strips every comment, which is right for a wholesale project
 * import and wrong here, where a comment may be something the author pasted on
 * purpose.
 */
export function cleanLatexSource(latexContent: string): CleanedLatex {
  const outcome = cleanLatexText(latexContent);
  return {
    latex: outcome.output,
    findings: summarizeCleanFixes(outcome.fixes, describeFix),
  };
}

/**
 * Converts a LaTeX document string to formatted PreTeXt XML.
 *
 * @param latexContent - The raw LaTeX source to convert.
 * @returns The formatted PreTeXt XML string, or `""` if `latexContent` is blank.
 * @throws If the underlying `latexToPretext` conversion throws.
 */
export function convertLatexToPretext(latexContent: string): string {
  const trimmedLatex = latexContent.trim();
  if (!trimmedLatex) {
    return "";
  }
  const converted = String(latexToPretext(trimmedLatex)).trim();
  return converted ? formatPretext(converted) : "";
}

/**
 * Converts a Markdown document string to formatted PreTeXt XML.
 *
 * @param markdownContent - The raw Markdown source to convert.
 * @returns The formatted PreTeXt XML string, or `""` if `markdownContent` is blank.
 * @throws If the underlying `markdownToPretext` conversion throws.
 */
export function convertMarkdownToPretext(markdownContent: string): string {
  const trimmedMarkdown = markdownContent.trim();
  if (!trimmedMarkdown) {
    return "";
  }
  const converted = String(markdownToPretext(trimmedMarkdown)).trim();
  return converted ? formatPretext(converted) : "";
}

/**
 * Normalises an unknown thrown value into a displayable error message.
 *
 * @param error - The value caught in a `catch` block.
 * @returns A non-empty string suitable for showing to the user.
 */
export function getConversionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "Could not convert LaTeX to PreTeXt.";
}

/**
 * Derives PreTeXt content from `source` according to `sourceFormat`.
 *
 * - If `sourceFormat` is `"pretext"`, the content is returned as-is.
 * - If `sourceFormat` is `"latex"`, the content is converted via
 *   {@link convertLatexToPretext}.  Conversion errors are caught and returned
 *   as `pretextError` so callers never need a try/catch.
 * - If `sourceFormat` is `"markdown"`, the content is converted via
 *   {@link convertMarkdownToPretext}.  Conversion errors are caught and returned
 *   as `pretextError` so callers never need a try/catch.
 *
 * @param source - The raw source string.
 * @param sourceFormat - The format of `source`.
 * @returns A {@link DerivedPretextResult} with either `pretextSource` or `pretextError`.
 */
export function derivePretextContent(
  source: string,
  sourceFormat: SourceFormat,
): DerivedPretextResult {
  if (sourceFormat === "pretext") {
    return { pretextSource: source };
  }

  if (sourceFormat === "markdown") {
    try {
      return { pretextSource: convertMarkdownToPretext(source) };
    } catch (error) {
      return { pretextError: getConversionErrorMessage(error) };
    }
  }

  try {
    return { pretextSource: convertLatexToPretext(source) };
  } catch (error) {
    return { pretextError: getConversionErrorMessage(error) };
  }
}
