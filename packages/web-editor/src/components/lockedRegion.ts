/**
 * Geometry of a division's structural ("locked") lines — the wrapper metadata
 * the author edits from the Table of Contents rather than in place.
 *
 * This is shared by the two enforcement strategies, so both lock exactly the
 * same lines and the editor looks identical either way:
 *
 * - **Solo editing** uses `constrained-editor-plugin`, which reverts an edit
 *   that lands outside the editable range *after the fact*, by calling
 *   `model.undo()`.
 * - **Collaborative editing** cannot use that. The plugin listens to
 *   `model.onDidChangeContent`, so it can't tell local typing from a remote
 *   CRDT delta: a peer's legitimate metadata edit would be undone on this
 *   client and re-broadcast as a deletion. Worse, `model.undo()` pops whatever
 *   is on top of the model's undo stack, which in a bound model includes
 *   remote-applied edits — so it can revert unrelated remote text. Collab mode
 *   instead *prevents* out-of-region local edits up front; see
 *   {@link ../collab/editGuard}.
 */
import type { SourceFormat } from "../types/editor";
import { isLatexDivisionHeaderLine } from "../sectionUtils";

/** The slice of Monaco's text model this module needs (kept tiny so it's testable). */
export interface LockedRegionModel {
  getLineCount(): number;
  getLineContent(lineNumber: number): string;
  getLineMaxColumn(lineNumber: number): number;
}

/** A Monaco-style range, as `[startLine, startCol, endLine, endCol]`. */
export type LineRange = [number, number, number, number];

/** The subset of `monaco.IRange` an edit operation carries. */
export interface EditRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface LockedRegion {
  /** The single multiline span the user may edit; every other line is locked. */
  editableRange: LineRange;
  /** Every locked line number, for decoration. */
  lockedLines: number[];
  /**
   * How many lines at the very top are locked. Clicking any of them opens the
   * division's properties form in the Table of Contents.
   */
  leadingLockedLines: number;
}

/**
 * Returns the line number where a PreTeXt division's locked header ends. The
 * header is always at least the opening tag (line 1); if a `<title>` element
 * immediately follows it on line 2, the header is extended through that
 * element's closing `</title>` line, since titles are now only editable from
 * the TOC. Divisions with no title line (introduction/conclusion) keep a
 * one-line header.
 */
export function findPretextHeaderEnd(model: LockedRegionModel): number {
  const lineCount = model.getLineCount();
  if (lineCount < 2 || !/^\s*<title\b/.test(model.getLineContent(2))) return 1;
  let end = 2;
  while (end <= lineCount && !/<\/title\s*>/.test(model.getLineContent(end))) {
    end++;
  }
  return end <= lineCount ? end : 1;
}

/**
 * Describes which lines of the model are structural (locked) for a given source
 * format.  `editableRange` is the single multiline region the user may edit
 * (Monaco `[startLine, startCol, endLine, endCol]`); every other line is
 * locked.  `leadingLockedLines` is how many lines at the very top are locked —
 * clicking any of them opens the division's properties form in the TOC.
 * Returns `null` when nothing should be locked (e.g. mid-edit or unsupported
 * format), leaving the whole document editable.
 */
export function computeLockedRegion(
  model: LockedRegionModel,
  sourceFormat: SourceFormat,
): LockedRegion | null {
  const lineCount = model.getLineCount();

  // PreTeXt: lock the opening tag (plus the title line right after it, when
  // present) and the closing tag, keeping the body in between editable.
  if (sourceFormat === "pretext") {
    if (lineCount < 3) return null;
    const headerEnd = findPretextHeaderEnd(model);
    if (headerEnd >= lineCount - 1) return null;
    const lockedLines: number[] = [];
    for (let ln = 1; ln <= headerEnd; ln++) lockedLines.push(ln);
    lockedLines.push(lineCount);
    return {
      editableRange: [
        headerEnd + 1,
        1,
        lineCount - 1,
        model.getLineMaxColumn(lineCount - 1),
      ],
      lockedLines,
      leadingLockedLines: headerEnd,
    };
  }

  // Markdown: lock a leading `---` ... `---` YAML frontmatter block (the
  // division's type/xml:id/label/title — title included, since it's now only
  // editable from the TOC), keeping the markdown body below fully editable.
  if (sourceFormat === "markdown") {
    if (model.getLineContent(1).trim() !== "---") return null;
    let fence = -1;
    for (let ln = 2; ln <= lineCount; ln++) {
      if (model.getLineContent(ln).trim() === "---") {
        fence = ln;
        break;
      }
    }
    if (fence === -1) return null;

    // Need at least one body line after the locked frontmatter; otherwise
    // lock nothing (don't trap the user mid-edit).
    if (fence >= lineCount) return null;
    const lockedLines: number[] = [];
    for (let ln = 1; ln <= fence; ln++) lockedLines.push(ln);
    return {
      editableRange: [fence + 1, 1, lineCount, model.getLineMaxColumn(lineCount)],
      lockedLines,
      leadingLockedLines: fence,
    };
  }

  // LaTeX: a `\section{title}\label{ref}` header (or `\worksheet{…}` etc. — the
  // command is named after the division type) occupies the first line; lock it
  // and keep the body below editable, so the type/title/xml:id are edited from
  // the TOC instead. Other LaTeX divisions (introduction/conclusion comments,
  // `\begin{section}` environments, a multi-section document root that opens
  // with prose) have no single header line to freeze, so nothing is locked.
  if (sourceFormat === "latex") {
    // Need a body line after the header; otherwise locking line 1 would leave
    // no editable region and trap the user.
    if (lineCount < 2) return null;
    if (!isLatexDivisionHeaderLine(model.getLineContent(1))) return null;
    // The blank line under the header is locked with it: `latex-pretext` reads
    // a first paragraph butted straight against the header as part of the
    // header, so the separation is structural rather than cosmetic and must not
    // be deletable. `CodeEditor` inserts it when it's missing; until it does
    // (and for any caller reading a raw model), fall back to locking the header
    // alone rather than freezing a line of the author's prose.
    const headerEnd = model.getLineContent(2).trim() === "" ? 2 : 1;
    if (headerEnd >= lineCount) return null;
    return {
      editableRange: [
        headerEnd + 1,
        1,
        lineCount,
        model.getLineMaxColumn(lineCount),
      ],
      lockedLines: headerEnd === 2 ? [1, 2] : [1],
      leadingLockedLines: headerEnd,
    };
  }

  return null;
}

/**
 * Whether `range` lies wholly inside `editable` — the same containment test the
 * constrained-editor plugin applies (`Range.containsRange`, endpoints
 * inclusive), so preventing an edit in collab mode rejects exactly what solo
 * mode would have reverted.
 */
export function isRangeWithin(editable: LineRange, range: EditRange): boolean {
  const [startLine, startColumn, endLine, endColumn] = editable;
  const startsInside =
    range.startLineNumber > startLine ||
    (range.startLineNumber === startLine && range.startColumn >= startColumn);
  const endsInside =
    range.endLineNumber < endLine ||
    (range.endLineNumber === endLine && range.endColumn <= endColumn);
  return startsInside && endsInside;
}
