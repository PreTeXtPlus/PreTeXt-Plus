/** Reading a TeX transcript for what an author needs to see of it. */

/** The most an excerpt runs to, for an error TeX gives no `l.<n>` line for. */
const MAX_EXCERPT_LINES = 12;

const CONTEXT_LINE = /^l\.(\d+)/;

/**
 * Whether TeX was reading the document itself, and not a file it had opened
 * from there, when it reached line `index` of the transcript. TeX prints `(` as
 * it opens a file and `)` as it closes one, so the document is open at depth 1
 * and a package at depth 2 or more. Other parentheses in the transcript are
 * nearly always balanced; an unbalanced `)` can only lower the depth, which
 * errs towards reading the line as the document's, as before.
 */
function inDocument(lines: string[], index: number): boolean {
  let depth = 0;
  for (const line of lines.slice(0, index)) {
    for (const character of line) {
      if (character === "(") depth += 1;
      else if (character === ")") depth -= 1;
    }
  }
  return depth <= 1;
}

/**
 * TeX counts lines of the whole document, and the author sees only the source
 * inside it. Numbered from there, a line above it is in the preamble. The line
 * TeX prints under this one is indented to the error point, so when the label
 * changes width, the next line is shifted to match.
 */
function renumberContext(lines: string[], sourceLine: number): string[] {
  const index = lines.findIndex((line) => CONTEXT_LINE.test(line));
  if (index < 0) return lines;
  const [label, number] = CONTEXT_LINE.exec(lines[index])!;
  const relative = Number(number) - sourceLine + 1;
  const replacement = (relative > 0 ? `l.${relative}` : "preamble").padEnd(label.length);
  const renumbered = [...lines];
  renumbered[index] = replacement + lines[index].slice(label.length);
  const shift = replacement.length - label.length;
  if (shift > 0 && index + 1 < renumbered.length) {
    renumbered[index + 1] = " ".repeat(shift) + renumbered[index + 1];
  }
  return renumbered;
}

/**
 * The first error in `log`, from its `!` line through the `l.<n>` line that says
 * where TeX stopped and the line that shows how far along it. The `l.<n>` is
 * renumbered from the source when TeX was reading the document; a line of a
 * package file is left as the package's own. Undefined if TeX reported none.
 */
export function texErrorExcerpt(log: string, sourceLine: number): string | undefined {
  const lines = log.split("\n");
  const start = lines.findIndex((line) => line.startsWith("!"));
  if (start < 0) return undefined;
  const context = lines.findIndex((line, index) => index > start && CONTEXT_LINE.test(line));
  const end = Math.min(context < 0 ? lines.length : context + 2, start + MAX_EXCERPT_LINES);
  const excerpt = lines.slice(start, end);
  return (inDocument(lines, start) ? renumberContext(excerpt, sourceLine) : excerpt).join("\n").trimEnd();
}

/**
 * Core sets `ampersand replacement=\amp` for every image, because an `&` does
 * not survive the XML it came through; so a `tikzcd` row — or a `\matrix` — is
 * written with `\amp` in PreTeXt, whatever tikz-cd's own manual shows. A bare
 * `&` fails in pgf's matrix code as an undefined control sequence, of all
 * things, so the error's name is no help; what gives it away is TeX's context
 * line, which shows how far it had read when it stopped: up to the `&`.
 */
const STOPPED_AT_AMPERSAND = /^l\.\d+ .*&\s*$/m;
const AMPERSAND_HINT = "TeX stopped at a &. Columns of a tikzcd or matrix are separated by \\amp in PreTeXt, not by &.";

/** What to tell the author about a run that made no picture. */
export function tikzFailureMessage(log: string, sourceLine: number): string {
  const excerpt = texErrorExcerpt(log, sourceLine) ?? "TeX produced no picture.";
  return STOPPED_AT_AMPERSAND.test(excerpt) ? `${excerpt}\n\n${AMPERSAND_HINT}` : excerpt;
}
