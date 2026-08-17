/**
 * The Insert menu's catalog, checked against the real pipeline.
 *
 * A snippet is a promise that the markup it writes is markup this project
 * accepts, so every body is run through the thing that would reject it: the
 * PreTeXt schema for PreTeXt, and the actual converters for LaTeX and
 * Markdown. That is what stops the catalog from drifting as those packages
 * grow support (a construct becoming *supported* is a reason to add a body
 * here; a construct silently regressing to a `<TODO>` placeholder fails here
 * rather than in an author's document).
 *
 * The grammar is read from the installed package with `fetch` stubbed to serve
 * it, exactly as `pretextSchema.test.ts` does, so the suite stays offline.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { latexToPretext } from "@pretextbook/latex-pretext";
import { markdownToPretext } from "@pretextbook/remark-pretext";
import {
  snippetGroupsFor,
  snippetPlainText,
  type EditorSnippet,
} from "../components/editorConfigs/snippets";
import {
  setPretextSchemaUrl,
  validatePretextDocument,
} from "../components/editorConfigs/pretextSchema";
import type { SourceFormat } from "../types/editor";

const require = createRequire(import.meta.url);
const GRAMMAR_URL = "https://test.invalid/pretext.json";

let realFetch: typeof globalThis.fetch;

beforeAll(() => {
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

/**
 * A snippet as an author would leave it after tabbing through: placeholders
 * accepted as-is, empty tab stops filled with a word, so the check is about
 * the structure rather than about empty elements.
 */
const filled = (body: string): string =>
  snippetPlainText(body.replace(/(?<!\\)\$\{?\d+\}?(?!:)/g, "Text"));

/** Every snippet of a format, flattened out of its groups. */
const snippetsOf = (format: SourceFormat): EditorSnippet[] =>
  snippetGroupsFor(format).flatMap((group) => group.snippets);

const byKey = (format: SourceFormat): Map<string, EditorSnippet> =>
  new Map(snippetsOf(format).map((snippet) => [snippet.key, snippet]));

/**
 * What each construct has to become, whichever format it was written in —
 * "Theorem" means `<theorem>` in all three or the menus are lying.
 */
const EXPECTED_ELEMENT: Record<string, RegExp> = {
  paragraph: /<p[ >]/,
  emphasis: /<em[ >]/,
  term: /<term[ >]/,
  "code-inline": /<c[ >]/,
  xref: /<xref[ /]/,
  link: /<url[ >]/,
  theorem: /<theorem[ >]/,
  definition: /<definition[ >]/,
  example: /<example[ >]/,
  remark: /<remark[ >]/,
  exercise: /<exercise[ >]/,
  "list-bulleted": /<ul[ >]/,
  "list-numbered": /<ol[ >]/,
  "list-description": /<dl[ >]/,
  "math-inline": /<m[ >]/,
  "math-display": /<(me|md)[ >]/,
  "math-aligned": /<md[ >]/,
  figure: /<figure[ >]/,
  table: /<table[ >]/,
  program: /<program[ >]/,
};

/** Snippets that belong inside a paragraph rather than beside one. */
const INLINE_KEYS = new Set([
  "emphasis",
  "term",
  "code-inline",
  "xref",
  "link",
  "math-inline",
]);

describe("the shared catalog", () => {
  it("gives a construct the same label in every format", () => {
    const labels = new Map<string, string>();
    for (const format of ["pretext", "latex", "markdown"] as const) {
      for (const snippet of snippetsOf(format)) {
        const seen = labels.get(snippet.key);
        if (seen) expect(seen).toBe(snippet.label);
        labels.set(snippet.key, snippet.label);
      }
    }
    // The catalog is only worth having if the formats really do overlap.
    expect(labels.size).toBeGreaterThan(10);
  });

  it("offers each format the groups it has snippets for, in one order", () => {
    for (const format of ["pretext", "latex", "markdown"] as const) {
      const groups = snippetGroupsFor(format).map((group) => group.key);
      expect(groups).toEqual(
        ["text", "blocks", "lists", "math", "figures"].filter((key) =>
          groups.includes(key),
        ),
      );
      expect(groups.length).toBeGreaterThan(0);
    }
  });

  it("has no empty group and no duplicate key", () => {
    for (const format of ["pretext", "latex", "markdown"] as const) {
      for (const group of snippetGroupsFor(format)) {
        expect(group.snippets.length).toBeGreaterThan(0);
      }
      const keys = snippetsOf(format).map((snippet) => snippet.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("describes every snippet it offers", () => {
    for (const format of ["pretext", "latex", "markdown"] as const) {
      for (const snippet of snippetsOf(format)) {
        expect(snippet.detail).not.toBe("");
        expect(snippet.body).not.toBe("");
        expect(EXPECTED_ELEMENT[snippet.key]).toBeDefined();
      }
    }
  });
});

describe("snippetPlainText", () => {
  it("keeps a placeholder's default text and drops the bare stops", () => {
    expect(snippetPlainText('<xref ref="${1:xml-id}"/>')).toBe(
      '<xref ref="xml-id"/>',
    );
    expect(snippetPlainText("<p>$0</p>")).toBe("<p></p>");
  });

  it("unescapes a literal dollar rather than reading it as a tab stop", () => {
    // LaTeX inline math: `\$$0\$` is `$`, a tab stop, `$`.
    expect(snippetPlainText("\\$$0\\$")).toBe("$$");
  });

  it("unescapes a LaTeX row break", () => {
    expect(snippetPlainText("a & b \\\\\\\\")).toBe("a & b \\\\");
  });
});

describe("PreTeXt snippets", () => {
  const wrap = (body: string) =>
    [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<pretext>`,
      `<article>`,
      `<title>Doc</title>`,
      `<section xml:id="sec-a">`,
      `<title>One</title>`,
      body,
      `</section>`,
      `</article>`,
      `</pretext>`,
    ].join("\n");

  it.each(snippetsOf("pretext").map((s) => [s.key, s] as const))(
    "%s validates against the PreTeXt schema",
    async (key, snippet) => {
      // A cross-reference is checked against the document it lands in, so point
      // the placeholder at something the wrapper below actually contains.
      const text = filled(snippet.body).replace('ref="xml-id"', 'ref="sec-a"');
      const body = INLINE_KEYS.has(key) ? `<p>Some ${text} prose.</p>` : text;

      expect(await validatePretextDocument(wrap(body))).toEqual([]);
      expect(text).toMatch(EXPECTED_ELEMENT[key]);
    },
  );
});

describe("LaTeX snippets", () => {
  it.each(snippetsOf("latex").map((s) => [s.key, s] as const))(
    "%s converts to the element it promises",
    (key, snippet) => {
      const converted = String(latexToPretext(filled(snippet.body)));

      expect(converted).toMatch(EXPECTED_ELEMENT[key]);
      expect(converted).not.toContain("<TODO");
      expect(converted.toLowerCase()).not.toContain("unsupported");
    },
  );
});

describe("Markdown snippets", () => {
  it.each(snippetsOf("markdown").map((s) => [s.key, s] as const))(
    "%s converts to the element it promises",
    (key, snippet) => {
      const converted = markdownToPretext(filled(snippet.body), {
        topLevelDivision: "section",
      });

      expect(converted).toMatch(EXPECTED_ELEMENT[key]);
      expect(converted).not.toContain("<TODO");
      expect(converted.toLowerCase()).not.toContain("unsupported");
    },
  );

  it("omits the constructs the Markdown converter cannot handle yet", () => {
    const markdown = byKey("markdown");
    for (const key of ["table", "figure", "link", "xref"]) {
      expect(markdown.has(key)).toBe(false);
    }
  });
});
