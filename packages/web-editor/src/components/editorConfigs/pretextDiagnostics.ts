/**
 * PreTeXt (XML) diagnostics, published as Monaco markers.
 *
 * Unlike the LaTeX and Markdown flavors — whose linters read the editor buffer
 * directly (see `flavorLanguage.ts`) — PreTeXt is validated against a *schema*,
 * and a schema has opinions about the whole document. The buffer is one
 * division: it is full of `<plus:* ref="…"/>` placeholders in an undeclared
 * namespace, and its root element (`<article>`, or a lone `<section>`) may or
 * may not be something the grammar accepts on its own.
 *
 * So what gets validated is the assembled document the preview already builds —
 * placeholders expanded into real content, wrapped in `<pretext>` — and the
 * resulting ranges are mapped back onto the buffer through the same
 * `buildPreviewLineMap` walk that drives preview scroll sync.
 *
 * The alternative — validating the buffer after swapping each placeholder for
 * some schema-valid stub — was tried and abandoned. There is no stub that works
 * everywhere: `<p/>` satisfies a `<chapter>` but not a `<book>`, `<title/>` is
 * required in a `<section>` and rejected in an `<introduction>`, `<exercises>`
 * wants `<exercise>` children and nothing else. Getting it right means
 * re-encoding PreTeXt's content model here, where it would rot. Assembly
 * already knows the real content; use it.
 */

import { buildPreviewLineMap } from "../previewSync";
import { mapSeverity } from "./flavorLanguage";
import { validatePretextDocument, type Diagnostic } from "./pretextSchema";

/** Marker owner, so these never collide with a flavor linter's markers. */
export const PRETEXT_MARKER_OWNER = "pretext-schema";

/** The two texts a PreTeXt lint pass needs. */
export interface PretextValidationInput {
  /** The division's own source, exactly as the editor buffer holds it. */
  editorSource: string;
  /** The assembled `<pretext>` document built from it. */
  assembledDocument: string;
}

/**
 * Validate `input` and return markers positioned in the *buffer*.
 *
 * Exported for tests; `usePretextDiagnostics` is what the editor calls.
 */
export async function computePretextMarkers(
  monaco: any,
  input: PretextValidationInput,
): Promise<any[]> {
  const diagnostics = await validatePretextDocument(input.assembledDocument);
  if (diagnostics.length === 0) return [];
  return mapDiagnosticsToBuffer(monaco, diagnostics, input);
}

/**
 * Project assembled-document diagnostics onto buffer lines.
 *
 * Only *exact* line correspondences count. `PreviewLineMap.toEditor` falls
 * outward to the nearest mapped line above, which is right for scroll sync —
 * land the reader somewhere sensible — and wrong here: an error inside an
 * expanded child division would be drawn on this buffer's placeholder line,
 * blaming source the author cannot see, let alone fix. Dropped instead. It
 * shows up when they open that division, which is where they can act on it.
 *
 * Exported for tests, which exercise it without a validator or a network.
 */
export function mapDiagnosticsToBuffer(
  monaco: any,
  diagnostics: Diagnostic[],
  { editorSource, assembledDocument }: PretextValidationInput,
): any[] {
  const lineMap = buildPreviewLineMap(editorSource, assembledDocument);
  if (lineMap.size === 0) return [];

  const editorLines = editorSource.split("\n");
  const assembledLines = assembledDocument.split("\n");

  // Exact assembled → editor, inverted from the forward direction so the
  // fall-outward behaviour of `toEditor` cannot leak in.
  const exact = new Map<number, number>();
  for (let line = 1; line <= editorLines.length; line++) {
    const assembled = lineMap.toAssembled(line);
    if (assembled !== undefined) exact.set(assembled, line);
  }

  const markers: any[] = [];
  for (const diagnostic of diagnostics) {
    // LSP ranges are 0-based; Monaco's and the line map's are 1-based.
    const startLine = exact.get(diagnostic.range.start.line + 1);
    if (startLine === undefined) continue;

    // Assembly may re-indent what it splices (the line map matches on trimmed
    // content), so a column is only meaningful after correcting for the
    // indentation delta on that line.
    const shift = indentShift(
      editorLines[startLine - 1],
      assembledLines[diagnostic.range.start.line],
    );

    // An end line that did not map — a diagnostic spanning into expanded
    // content — is clamped to the end of the start line rather than dropped:
    // the problem genuinely starts here, and a marker to the line end reads
    // correctly.
    const endLine = exact.get(diagnostic.range.end.line + 1) ?? startLine;
    const endColumn =
      endLine === startLine && diagnostic.range.end.line !== diagnostic.range.start.line
        ? editorLines[startLine - 1].length + 1
        : diagnostic.range.end.character + 1 + shift;

    markers.push({
      startLineNumber: startLine,
      startColumn: Math.max(1, diagnostic.range.start.character + 1 + shift),
      endLineNumber: endLine,
      endColumn: Math.max(1, endColumn),
      message: diagnostic.message,
      source: typeof diagnostic.code === "string" ? diagnostic.code : "pretext",
      severity: mapSeverity(monaco, diagnostic.severity),
    });
  }
  return markers;
}

/** How far right the buffer's copy of a line sits relative to the assembled one. */
function indentShift(editorLine: string, assembledLine: string | undefined): number {
  if (assembledLine === undefined) return 0;
  return indentOf(editorLine) - indentOf(assembledLine);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}
