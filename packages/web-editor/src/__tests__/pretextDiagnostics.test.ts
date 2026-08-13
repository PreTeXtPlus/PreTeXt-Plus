import { describe, it, expect } from "vitest";
import { mapDiagnosticsToBuffer } from "../components/editorConfigs/pretextDiagnostics";
import type { Diagnostic } from "../components/editorConfigs/pretextSchema";

/**
 * Only the two fields the mapper reads. Severity values mirror Monaco's real
 * ones (Hint 1, Info 2, Warning 4, Error 8) so a mix-up with LSP's would show.
 */
const monaco = {
  MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
};

/** LSP ranges are 0-based; these helpers keep the tests readable. */
function diagnostic(
  line: number,
  startChar: number,
  endChar: number,
  message = "problem",
  extra: Partial<Diagnostic> = {},
): Diagnostic {
  return {
    range: {
      start: { line, character: startChar },
      end: { line, character: endChar },
    },
    severity: 1,
    message,
    ...extra,
  } as Diagnostic;
}

// A division buffer and the document assembly builds from it: a `<pretext>`
// wrapper on top, and the `<plus:section ref="sec-b"/>` placeholder expanded
// into the child division's real content.
const editorSource = [
  `<section xml:id="sec-a">`,
  `  <title>One</title>`,
  `  <p>Hello <notarealelement/>.</p>`,
  `  <plus:section ref="sec-b"/>`,
  `</section>`,
].join("\n");

const assembledDocument = [
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<pretext>`,
  `<article>`,
  `<title>Doc</title>`,
  `<section xml:id="sec-a">`,
  `  <title>One</title>`,
  `  <p>Hello <notarealelement/>.</p>`,
  `  <section xml:id="sec-b">`,
  `    <title>Two</title>`,
  `    <p>Child <alsonotreal/>.</p>`,
  `  </section>`,
  `</section>`,
  `</article>`,
  `</pretext>`,
].join("\n");

const input = { editorSource, assembledDocument };

describe("mapDiagnosticsToBuffer", () => {
  it("maps a diagnostic in the buffer's own lines back to its editor line", () => {
    // `<notarealelement/>` sits on assembled line index 6 → editor line 3.
    const markers = mapDiagnosticsToBuffer(
      monaco,
      [diagnostic(6, 11, 29, "<notarealelement> is not allowed here.")],
      input,
    );

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      startLineNumber: 3,
      endLineNumber: 3,
      startColumn: 12,
      endColumn: 30,
      message: "<notarealelement> is not allowed here.",
      severity: monaco.MarkerSeverity.Error,
    });
  });

  it("drops diagnostics from inside an expanded child division", () => {
    // `<alsonotreal/>` is on assembled line index 9, which belongs to the
    // child division — not this buffer. Reporting it would blame the
    // placeholder line for source the author cannot see here.
    const markers = mapDiagnosticsToBuffer(
      monaco,
      [diagnostic(9, 12, 26, "<alsonotreal> is not allowed here.")],
      input,
    );

    expect(markers).toEqual([]);
  });

  it("drops diagnostics on the wrapper assembly added", () => {
    // `<article>` (assembled line index 2) exists in no buffer.
    const markers = mapDiagnosticsToBuffer(
      monaco,
      [diagnostic(2, 0, 9, "<article> is not allowed here.")],
      input,
    );

    expect(markers).toEqual([]);
  });

  it("corrects columns for lines assembly re-indented", () => {
    const reindented = {
      editorSource: `<section xml:id="sec-a">\n<p>Hi <bogus/>.</p>\n</section>`,
      // Assembly indented the `<p>` by four spaces.
      assembledDocument: `<pretext>\n<article>\n<section xml:id="sec-a">\n    <p>Hi <bogus/>.</p>\n</section>\n</article>\n</pretext>`,
    };
    // In the assembled text `<bogus/>` starts at character 10; in the buffer it
    // starts at 6, four columns to the left.
    const markers = mapDiagnosticsToBuffer(
      monaco,
      [diagnostic(3, 10, 18)],
      reindented,
    );

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      startLineNumber: 2,
      startColumn: 7,
      endColumn: 15,
    });
  });

  it("clamps a multi-line range whose end escapes the buffer", () => {
    // Starts on the buffer's `<p>` line, ends inside expanded child content.
    const markers = mapDiagnosticsToBuffer(
      monaco,
      [
        {
          range: {
            start: { line: 6, character: 2 },
            end: { line: 9, character: 4 },
          },
          severity: 1,
          message: "unclosed",
        } as Diagnostic,
      ],
      input,
    );

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      startLineNumber: 3,
      endLineNumber: 3,
      // Through end of the buffer line, not character 5 of an unrelated one.
      endColumn: `  <p>Hello <notarealelement/>.</p>`.length + 1,
    });
  });

  it("maps LSP severities onto Monaco's", () => {
    const severities = [1, 2, 3, 4].map(
      (severity) =>
        mapDiagnosticsToBuffer(
          monaco,
          [diagnostic(6, 11, 29, "m", { severity } as Partial<Diagnostic>)],
          input,
        )[0].severity,
    );

    expect(severities).toEqual([
      monaco.MarkerSeverity.Error,
      monaco.MarkerSeverity.Warning,
      monaco.MarkerSeverity.Info,
      monaco.MarkerSeverity.Hint,
    ]);
  });

  it("uses the diagnostic code as the marker source when there is one", () => {
    const [withCode] = mapDiagnosticsToBuffer(
      monaco,
      [diagnostic(6, 11, 29, "m", { code: "element-not-allowed" })],
      input,
    );
    const [withoutCode] = mapDiagnosticsToBuffer(
      monaco,
      [diagnostic(6, 11, 29)],
      input,
    );

    expect(withCode.source).toBe("element-not-allowed");
    expect(withoutCode.source).toBe("pretext");
  });

  it("returns nothing when the two texts share no lines at all", () => {
    const markers = mapDiagnosticsToBuffer(monaco, [diagnostic(0, 0, 1)], {
      editorSource: "<section/>",
      assembledDocument: "<pretext><article><p>unrelated</p></article></pretext>",
    });

    expect(markers).toEqual([]);
  });
});
