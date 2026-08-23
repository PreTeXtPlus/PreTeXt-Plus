import type { Division } from "../types/sections";
import type { ProjectMatch } from "../types/projectScan";

export interface ProjectFindOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  useRegex?: boolean;
}

const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;

/** Escapes a literal query for use inside a regex, unless the user asked for regex mode. */
function buildMatcher(query: string, options: ProjectFindOptions): RegExp | null {
  if (!query) return null;
  let pattern = options.useRegex ? query : query.replace(REGEX_SPECIAL_CHARS, "\\$&");
  if (options.wholeWord) pattern = `\\b(?:${pattern})\\b`;
  try {
    return new RegExp(pattern, options.matchCase ? "g" : "gi");
  } catch {
    // An unfinished or invalid regex while the user is still typing — surface
    // as "no matches" rather than throwing on every keystroke.
    return null;
  }
}

function offsetToLineCol(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart + 1 };
}

/**
 * Scans every division's source for `query`, returning one {@link ProjectMatch}
 * per hit. Offsets are relative to that division's own `source` string, so a
 * caller must not mix matches from different divisions when splicing.
 */
export function findInProject(
  divisions: Division[],
  query: string,
  options: ProjectFindOptions = {},
): ProjectMatch[] {
  const matcher = buildMatcher(query, options);
  if (!matcher) return [];

  const results: ProjectMatch[] = [];
  for (const division of divisions) {
    const source = division.source;
    matcher.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(source))) {
      const matchedText = match[0];
      if (matchedText.length === 0) {
        // A regex that can match empty (e.g. `a*`) would otherwise loop forever.
        matcher.lastIndex++;
        continue;
      }
      const startOffset = match.index;
      const endOffset = startOffset + matchedText.length;
      const start = offsetToLineCol(source, startOffset);
      const end = offsetToLineCol(source, endOffset);
      const lineStart = source.lastIndexOf("\n", startOffset - 1) + 1;
      const nextNewline = source.indexOf("\n", endOffset);
      const lineEnd = nextNewline === -1 ? source.length : nextNewline;

      results.push({
        divisionId: division.xmlId,
        startOffset,
        endOffset,
        range: {
          startLine: start.line,
          startCol: start.col,
          endLine: end.line,
          endCol: end.col,
        },
        preview: source.slice(lineStart, lineEnd).trim(),
        matchedText,
      });
    }
  }
  return results;
}

/**
 * Replaces every match in `matches` within `source` with `replacement`.
 * `matches` must all belong to the division `source` came from — offsets are
 * applied back-to-front so earlier matches' offsets aren't shifted by later
 * replacements.
 */
export function applyReplacements(
  source: string,
  matches: ProjectMatch[],
  replacement: string,
): string {
  const sorted = [...matches].sort((a, b) => b.startOffset - a.startOffset);
  let result = source;
  for (const match of sorted) {
    result = result.slice(0, match.startOffset) + replacement + result.slice(match.endOffset);
  }
  return result;
}
