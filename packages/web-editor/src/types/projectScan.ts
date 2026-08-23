/**
 * A single hit produced by a project-wide scan over every division's source —
 * currently just `findInProject` (see `../components/projectFind.ts`), but the
 * shape is scanner-agnostic on purpose: a future spellcheck-summary or
 * schema-problems panel would produce the same `ProjectMatch[]` and render
 * through the same `ScanResultsList`.
 */
export interface ProjectMatch {
  /** The division (`Division.xmlId`) this match was found in. */
  divisionId: string;
  /** Character offsets into that division's `source`, for splicing a replacement. */
  startOffset: number;
  endOffset: number;
  /** 1-based line/column range, for revealing and selecting in Monaco. */
  range: {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };
  /** The source line surrounding the match, trimmed, for the results-list row. */
  preview: string;
  /** The literal text that matched. */
  matchedText: string;
}
