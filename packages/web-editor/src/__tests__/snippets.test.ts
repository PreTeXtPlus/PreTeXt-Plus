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
 * A PreTeXt body is validated the way the editor validates one: assembled
 * first. A buffer here is a *division*, and a division may hold
 * `<plus:* ref="…"/>` placeholders — the figure snippet writes one for its
 * image — which are expanded by `assembleFullProjectSource` before the schema
 * ever sees them. Validating a body as written would fail on a namespace the
 * grammar has never heard of, and would say nothing about what actually
 * reaches a build.
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
  wrapInParagraph,
  type EditorSnippet,
} from "../components/editorConfigs/snippets";
import {
  setPretextSchemaUrl,
  validatePretextDocument,
} from "../components/editorConfigs/pretextSchema";
import { assembleFullProjectSource } from "../sectionUtils";
import type { Asset, SourceFormat } from "../types/editor";
import type { Division } from "../types/sections";

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
  /**
   * The asset the figure snippet's `<plus:image ref/>` placeholder resolves
   * against. Its `ref` is the placeholder's own default text, since {@link
   * filled} keeps a placeholder's default — so the figure body points at a real
   * asset here exactly as an author's would once they picked one.
   */
  const ASSETS: Asset[] = [
    {
      title: "A picture",
      ref: "image-ref",
      isFile: true,
      fileRef: "image-ref.png",
      shortDescription: "A picture.",
    },
  ];

  /** A division of PreTeXt source, as the divisions pool holds one. */
  const division = (
    xmlId: string,
    type: Division["type"],
    source: string,
  ): Division => ({ xmlId, title: xmlId, type, sourceFormat: "pretext", source });

  /**
   * `body` in the document it would really be built into: a section of an
   * article, assembled by the same function the preview and the schema linter
   * assemble with, so `<plus:* ref/>` placeholders are expanded rather than
   * handed to the grammar raw.
   */
  const wrap = (body: string) =>
    assembleFullProjectSource(
      [
        division(
          "art-a",
          "article",
          `<article xml:id="art-a">\n<title>Doc</title>\n<plus:section ref="sec-a"/>\n</article>`,
        ),
        division(
          "sec-a",
          "section",
          `<section xml:id="sec-a">\n<title>One</title>\n${body}\n</section>`,
        ),
      ],
      "art-a",
      "",
      ASSETS,
    );

  /**
   * A snippet as it reaches the buffer: tab stops filled, and a cross-reference
   * pointed at something the wrapper below actually contains, since a `<xref>`
   * is validated against the document it lands in.
   */
  const written = (body: string) =>
    filled(body).replace('ref="xml-id"', 'ref="sec-a"');

  it.each(snippetsOf("pretext").map((s) => [s.key, s] as const))(
    "%s validates against the PreTeXt schema",
    async (key, snippet) => {
      const text = written(snippet.body);
      // Each body is checked where the placement gate would put it: an
      // `in-paragraph` construct inside a paragraph, a block one beside it.
      const body =
        snippet.placement === "in-paragraph"
          ? `<p>Some ${text} prose.</p>`
          : text;

      expect(await validatePretextDocument(wrap(body))).toEqual([]);
      expect(text).toMatch(EXPECTED_ELEMENT[key]);
    },
  );

  // The other half of the gate: outside a paragraph the same body is wrapped in
  // one, and that wrapping has to be valid too — this is what the menu writes
  // when the cursor sits between paragraphs, which is the common case.
  it.each(
    snippetsOf("pretext")
      .filter((s) => s.placement === "in-paragraph")
      .map((s) => [s.key, s] as const),
  )("%s validates once wrapped in a paragraph", async (_key, snippet) => {
    const wrapped = written(wrapInParagraph(snippet.body));

    expect(await validatePretextDocument(wrap(wrapped))).toEqual([]);
  });
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
