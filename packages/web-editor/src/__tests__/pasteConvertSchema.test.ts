/**
 * @vitest-environment jsdom
 *
 * The contract between `@pretextbook/import`'s paste placement and the PreTeXt
 * schema: whatever a paste puts in the buffer has to be legal where it lands.
 *
 * This is checked against the real grammar rather than against expected strings
 * because the rule it encodes is the schema's, not ours. PreTeXt decides
 * legality by parent: prose, a list and displayed math are only valid *inside*
 * a `<p>`, while a theorem is only valid outside one. A converted snippet
 * arrives as whichever of those the source happened to be, so the placement
 * pass has to supply or withhold the paragraph accordingly — and getting it
 * backwards is invisible in a unit test that only compares markup.
 *
 * The regression that prompted this: `unified-latex` emits a wrapping `<p>`
 * only when the LaTeX it converts has more than one paragraph, so the single
 * most common paste — one paragraph of prose — used to arrive as bare text and
 * was rejected wherever the cursor was not already inside a paragraph.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { convertPastedSnippet, type PasteContextModel } from "../pasteConvert";
import {
  setPretextSchemaUrl,
  validatePretextDocument,
} from "../components/editorConfigs/pretextSchema";

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
  globalThis.fetch = vi.fn(async (input: unknown) => {
    if (String(input) !== GRAMMAR_URL) throw new Error(`unexpected fetch: ${input}`);
    return new Response(grammar, { status: 200 });
  }) as typeof globalThis.fetch;
  setPretextSchemaUrl(GRAMMAR_URL);
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

/** A stand-in for Monaco's text model, backed by a plain string. */
function modelFor(text: string): PasteContextModel {
  const lines = text.split("\n");
  return {
    getLineContent: (lineNumber) => lines[lineNumber - 1] ?? "",
    getValueInRange: ({
      startLineNumber,
      startColumn,
      endLineNumber,
      endColumn,
    }) => {
      if (startLineNumber === endLineNumber) {
        return (lines[startLineNumber - 1] ?? "").slice(
          startColumn - 1,
          endColumn - 1,
        );
      }
      const first = (lines[startLineNumber - 1] ?? "").slice(startColumn - 1);
      const middle = lines.slice(startLineNumber, endLineNumber - 1);
      const last = (lines[endLineNumber - 1] ?? "").slice(0, endColumn - 1);
      return [first, ...middle, last].join("\n");
    },
  };
}

// A division mid-edit: a paragraph with prose in it, and a blank line below it
// where block content would go.
const DIVISION = [
  '<section xml:id="sec-x">', // 1
  "  <title>A section</title>", // 2
  "  <p>", // 3
  "    Some existing prose.", // 4
  "  </p>", // 5
  "  ", // 6
  "</section>", // 7
].join("\n");

/** Line 6 — between the paragraph and the closing tag. */
const BETWEEN_BLOCKS = { lineNumber: 6, column: 3 };
/** Line 4 — inside the paragraph, among its words. */
const INSIDE_PARAGRAPH = { lineNumber: 4, column: 5 };

/** The pasted markup as the schema will see it: a section of a real article. */
const asDocument = (body: string) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  "<pretext>\n" +
  '<article xml:id="art-a">\n<title>Doc</title>\n' +
  '<section xml:id="sec-x">\n<title>A section</title>\n' +
  `${body}\n` +
  "</section>\n</article>\n</pretext>";

/** Paste `snippet` at `position` and hand back what would enter the buffer. */
function pasted(snippet: string, position: { lineNumber: number; column: number }) {
  const result = convertPastedSnippet(snippet, modelFor(DIVISION), position);
  expect(result, "the detector should have claimed this snippet").toBeDefined();
  return result!;
}

// Each of these converts to something with a different relationship to `<p>`:
// bare inline content, an element that must live inside a paragraph, an element
// that must not, and a mixture of the first and third.
const SNIPPETS: [name: string, latex: string][] = [
  ["one paragraph of prose", "Let $G$ be a \\emph{group} of order $n$."],
  ["two paragraphs", "First para with $x$.\n\nSecond para here."],
  ["displayed math", "\\[ \\int_0^1 x^2\\,dx \\]"],
  ["a list", "\\begin{itemize}\n\\item one\n\\item two\n\\end{itemize}"],
  [
    "a theorem",
    "\\begin{theorem}\nEvery group of prime order is cyclic.\n\\end{theorem}",
  ],
  [
    "prose either side of a theorem",
    "Intro prose.\n\\begin{theorem}\nT.\n\\end{theorem}\nOutro prose.",
  ],
];

describe("a paste landing outside a paragraph", () => {
  it.each(SNIPPETS)("is valid PreTeXt: %s", async (_name, latex) => {
    const { markup } = pasted(latex, BETWEEN_BLOCKS);
    expect(await validatePretextDocument(asDocument(markup))).toEqual([]);
  });

  // The wrap is not unconditional, and asserting only validity would not catch
  // it becoming so: `<p><theorem/></p>` is just as invalid as a bare paragraph
  // of prose, but in the other direction.
  it("does not wrap a block element that is already legal on its own", () => {
    const { markup } = pasted(SNIPPETS[4][1], BETWEEN_BLOCKS);
    expect(markup.trimStart()).toMatch(/^<theorem[\s>]/);
  });

  it("leaves markup that already carries its own paragraphs alone", () => {
    const { markup } = pasted(SNIPPETS[1][1], BETWEEN_BLOCKS);
    expect(markup).not.toMatch(/<p>\s*<p[\s>]/);
  });
});

describe("a paste landing inside a paragraph", () => {
  // The host's `<p>` supplies what the snippet must not, so these are validated
  // as the *contents* of a paragraph, which is where they are going.
  const inParagraph = (body: string) => asDocument(`<p>${body}</p>`);

  // Everything a paragraph can legally hold: no wrapper added, and no warning,
  // because the result needs no repair.
  const FITS: [string, string][] = [
    SNIPPETS[0], // one paragraph of prose
    SNIPPETS[2], // displayed math
    SNIPPETS[3], // a list
  ];

  it.each(FITS)("is valid inside the enclosing paragraph: %s", async (_n, latex) => {
    const { markup, warning } = pasted(latex, INSIDE_PARAGRAPH);
    expect(await validatePretextDocument(inParagraph(markup))).toEqual([]);
    expect(warning).toBeUndefined();
  });

  // The two things a paragraph cannot hold. Neither can be repaired from here —
  // one would need the host paragraph split, the other needs the block moved
  // out of it — so the paste goes in as asked and says what is wrong with it.
  // Refusing would lose work the author asked for; silently mangling it would
  // be worse than either.
  it.each([
    ["a theorem", SNIPPETS[4][1], /theorem/],
    ["more than one paragraph", SNIPPETS[1][1], /more than one paragraph/],
  ] as [string, string, RegExp][])(
    "reports rather than repairs: %s",
    (_name, latex, expected) => {
      expect(pasted(latex, INSIDE_PARAGRAPH).warning).toMatch(expected);
    },
  );
});
