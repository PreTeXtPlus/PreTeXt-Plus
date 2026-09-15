/**
 * End-to-end cover for PreTeXt linting: the real `@pretextbook/schema`
 * validator, the real grammar, and the real assembled → buffer mapping.
 *
 * The unit tests in `pretextDiagnostics.test.ts` feed the mapper hand-written
 * diagnostics; this is the only place that checks the shape upstream actually
 * produces — the option names it accepts, the LSP severities it returns, the
 * 0-based ranges. Those are exactly what a version bump breaks silently.
 *
 * The grammar is read from the installed package rather than fetched, with
 * `fetch` stubbed to serve it, so the suite stays offline.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  setPretextSchemaUrl,
  validatePretextDocument,
} from "../components/editorConfigs/pretextSchema";
import { computePretextMarkers } from "../components/editorConfigs/pretextDiagnostics";
import { assembleFullProjectSource } from "../sectionUtils";
import type { Division } from "../types/sections";

const require = createRequire(import.meta.url);
const GRAMMAR_URL = "https://test.invalid/pretext.json";

const monaco = {
  MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
};

let realFetch: typeof globalThis.fetch;

beforeAll(() => {
  // `@pretextbook/schema` does not export its assets (upstream #256), so the
  // path is rebuilt from the package entry.
  const grammar = fs.readFileSync(
    path.join(
      path.dirname(require.resolve("@pretextbook/schema")),
      "assets",
      "pretext.json",
    ),
    "utf8",
  );

  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: any) => {
    if (String(input) !== GRAMMAR_URL) throw new Error(`unexpected fetch: ${input}`);
    return new Response(grammar, { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  setPretextSchemaUrl(GRAMMAR_URL);
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

const wrap = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<pretext>\n<article>\n<title>Doc</title>\n${body}\n</article>\n</pretext>`;

describe("validatePretextDocument", () => {
  it("finds nothing wrong with a valid document", async () => {
    const diagnostics = await validatePretextDocument(
      wrap(
        `<section xml:id="sec-a">\n  <title>One</title>\n  <p>Hello.</p>\n</section>`,
      ),
    );

    expect(diagnostics).toEqual([]);
  });

  it("reports an element the schema does not allow, with a 0-based range", async () => {
    const diagnostics = await validatePretextDocument(
      wrap(
        `<section xml:id="sec-a">\n  <title>One</title>\n  <p>Hello <notarealelement/>.</p>\n</section>`,
      ),
    );

    expect(diagnostics).toHaveLength(1);
    // Line 6 zero-based: the `<p>` line, counting the XML declaration.
    expect(diagnostics[0].range.start.line).toBe(6);
    expect(diagnostics[0].severity).toBeGreaterThanOrEqual(1);
  });

  it("reports a well-formedness failure rather than throwing", async () => {
    const diagnostics = await validatePretextDocument(
      wrap(`<section xml:id="sec-a">\n  <title>One</title>\n  <p>Unclosed.\n</section>`),
    );

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("resolves empty when the grammar cannot be fetched", async () => {
    setPretextSchemaUrl("https://test.invalid/missing.json");
    try {
      expect(await validatePretextDocument(wrap("<p>Hi.</p>"))).toEqual([]);
    } finally {
      setPretextSchemaUrl(GRAMMAR_URL);
    }
  });
});

describe("computePretextMarkers", () => {
  it("puts a real schema error on the buffer line that caused it", async () => {
    const editorSource = [
      `<section xml:id="sec-a">`,
      `  <title>One</title>`,
      `  <p>Hello <notarealelement/>.</p>`,
      `  <plus:section ref="sec-b"/>`,
      `</section>`,
    ].join("\n");

    const assembledDocument = wrap(
      [
        `<section xml:id="sec-a">`,
        `  <title>One</title>`,
        `  <p>Hello <notarealelement/>.</p>`,
        `  <section xml:id="sec-b">`,
        `    <title>Two</title>`,
        `    <p>Child.</p>`,
        `  </section>`,
        `</section>`,
      ].join("\n"),
    );

    const markers = await computePretextMarkers(monaco, {
      editorSource,
      assembledDocument,
    });

    expect(markers).toHaveLength(1);
    expect(markers[0].startLineNumber).toBe(3);
    // The `<plus:section .../>` placeholder validated as real content, so it
    // contributes no marker of its own — the whole point of assembling first.
    expect(markers.some((m: any) => m.startLineNumber === 4)).toBe(false);
  });

  it("does not blame the placeholder line for an error inside the child", async () => {
    const editorSource = [
      `<section xml:id="sec-a">`,
      `  <title>One</title>`,
      `  <plus:section ref="sec-b"/>`,
      `</section>`,
    ].join("\n");

    const assembledDocument = wrap(
      [
        `<section xml:id="sec-a">`,
        `  <title>One</title>`,
        `  <section xml:id="sec-b">`,
        `    <title>Two</title>`,
        `    <p>Child <alsonotreal/>.</p>`,
        `  </section>`,
        `</section>`,
      ].join("\n"),
    );

    const markers = await computePretextMarkers(monaco, {
      editorSource,
      assembledDocument,
    });

    expect(markers).toEqual([]);
  });
});

/**
 * The point of the placeholder attribute pass-through is that the document it
 * produces is real PreTeXt. `@component` on an *included* division has no
 * other route into the assembled source — the division's own record is shared
 * by every include of it — so this is the end-to-end check that the route
 * works: placeholder attribute → assembled document → the real grammar.
 */
describe("assembled placeholder attributes", () => {
  const division = (
    xmlId: string,
    type: Division["type"],
    source: string,
  ): Division => ({
    id: xmlId,
    xmlId,
    title: xmlId,
    type,
    sourceFormat: "pretext",
    source,
  });

  it("produces a schema-valid document for a @component on an include", async () => {
    const xml = assembleFullProjectSource(
      [
        division(
          "art-a",
          "article",
          `<article xml:id="art-a">\n<title>Doc</title>\n<plus:section ref="sec-a" component="teacher"/>\n</article>`,
        ),
        division(
          "sec-a",
          "section",
          `<section xml:id="sec-a">\n<title>One</title>\n<p>Hi</p>\n</section>`,
        ),
      ],
      "art-a",
      "",
    );

    expect(xml).toContain('<section xml:id="sec-a" component="teacher">');
    expect(await validatePretextDocument(xml)).toEqual([]);
  });
});
