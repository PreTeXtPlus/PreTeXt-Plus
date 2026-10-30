/** Reading a TeX transcript for what an author needs to see of it. */

/** The most an excerpt runs to, for an error TeX gives no `l.<n>` line for. */
const MAX_EXCERPT_LINES = 12;

const CONTEXT_LINE = /^l\.(\d+)/;

/**
 * TeX counts lines of the whole document, and the author sees only the source
 * inside it. Numbered from there, a line above it is in the preamble. Padded so
 * the line TeX prints under this one, indented to the error point, stays aligned.
 */
function authorContextLine(line: string, sourceLine: number): string {
  return line.replace(CONTEXT_LINE, (label, number: string) => {
    const relative = Number(number) - sourceLine + 1;
    return (relative > 0 ? `l.${relative}` : "preamble").padEnd(label.length);
  });
}

/**
 * The first error in `log`, from its `!` line through the `l.<n>` line that says
 * where TeX stopped and the line that shows how far along it. Undefined if TeX
 * reported none.
 */
export function texErrorExcerpt(log: string, sourceLine: number): string | undefined {
  const lines = log.split("\n");
  const start = lines.findIndex((line) => line.startsWith("!"));
  if (start < 0) return undefined;
  const context = lines.findIndex((line, index) => index > start && CONTEXT_LINE.test(line));
  const end = Math.min(context < 0 ? lines.length : context + 2, start + MAX_EXCERPT_LINES);
  return lines
    .slice(start, end)
    .map((line) => authorContextLine(line, sourceLine))
    .join("\n")
    .trimEnd();
}

/**
 * Core sets `ampersand replacement=\amp` for every image, because an `&` does
 * not survive the XML it came through; so a `tikzcd` row is written with `\amp`
 * in PreTeXt, whatever tikz-cd's own manual shows.
 */
const AMPERSAND_HINT = "Columns of a tikzcd are separated by \\amp in PreTeXt, not by &.";

/** What to tell the author about a run that made no picture. */
export function tikzFailureMessage(log: string, source: string, sourceLine: number): string {
  const excerpt = texErrorExcerpt(log, sourceLine) ?? "TeX produced no picture.";
  return /\\begin\{tikzcd\}[\s\S]*&/.test(source) ? `${excerpt}\n\n${AMPERSAND_HINT}` : excerpt;
}
