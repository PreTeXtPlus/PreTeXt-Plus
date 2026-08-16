import { describe, it, expect } from "vitest";
import {
  DEFAULT_SPELL_CHECK_SCOPES,
  type SpellCheckScope,
} from "../components/editorConfigs/spellcheck/scopes";
import { findCheckableLatexRegions } from "../components/editorConfigs/spellcheck/latexRegions";
import { findCheckableMarkdownRegions } from "../components/editorConfigs/spellcheck/markdownRegions";
import type { RegionFinder } from "../components/editorConfigs/spellcheck/regions";
import { extractWords } from "../components/editorConfigs/spellcheck/words";

/**
 * The LaTeX and Markdown counterparts of `spellcheck.test.ts`, which covers the
 * PreTeXt (XML) scanner.  All three answer to the same scopes, so the cases run
 * deliberately parallel: what an author sets once should behave the same way in
 * whichever flavor a division happens to be written in.
 */

const withScope = (overrides: Partial<SpellCheckScope>): SpellCheckScope => ({
  ...DEFAULT_SPELL_CHECK_SCOPES,
  ...overrides,
});

/** The words a given source yields under the given scopes. */
const wordsFrom =
  (findRegions: RegionFinder) =>
  (
    source: string,
    scopes: SpellCheckScope = DEFAULT_SPELL_CHECK_SCOPES,
  ): string[] =>
    extractWords(source, findRegions(source, scopes)).map((w) => w.word);

describe("findCheckableLatexRegions", () => {
  const wordsIn = wordsFrom(findCheckableLatexRegions);

  it("checks prose and skips the macros around it", () => {
    expect(wordsIn("Say \\emph{hello there} world")).toEqual([
      "Say",
      "hello",
      "there",
      "world",
    ]);
  });

  it("reports offsets that point at the word in the source", () => {
    const source = "A \\term{winding} number $x$";
    for (const word of extractWords(
      source,
      findCheckableLatexRegions(source, DEFAULT_SPELL_CHECK_SCOPES),
    )) {
      expect(source.slice(word.start, word.end)).toBe(word.word);
    }
  });

  it("ignores delimited inline and display math by default", () => {
    expect(
      wordsIn("Given $alpha beta$ and \\[gamma delta\\] then finish"),
    ).toEqual(["Given", "and", "then", "finish"]);
  });

  it("ignores math environments by default", () => {
    expect(
      wordsIn("Before \\begin{align} alpha &= beta \\end{align} after"),
    ).toEqual(["Before", "after"]);
  });

  it("ignores verbatim environments by default", () => {
    expect(
      wordsIn("Run \\begin{program}\nzzz qqq\n\\end{program}\nnow"),
    ).toEqual(["Run", "now"]);
  });

  it("ignores latex-image drawings by default", () => {
    expect(
      wordsIn("See \\begin{tikzpicture}\ndraww circlee\n\\end{tikzpicture} above"),
    ).toEqual(["See", "above"]);
  });

  it("suppresses nested content inside an ignored environment", () => {
    expect(
      wordsIn(
        "Before \\begin{program}\nx \\emph{innerr} y\n\\end{program} after",
      ),
    ).toEqual(["Before", "after"]);
  });

  it("keeps suppressing when an environment is never closed", () => {
    expect(wordsIn("Before \\begin{sage}\nzzz qqq")).toEqual(["Before"]);
  });

  it("checks comments by default but not when told otherwise", () => {
    const source = "Body % a remark here\ntail";
    expect(wordsIn(source)).toEqual(["Body", "remark", "here", "tail"]);
    expect(wordsIn(source, withScope({ comments: "Ignore" }))).toEqual([
      "Body",
      "tail",
    ]);
  });

  it("checks math when the scope is switched on", () => {
    expect(
      wordsIn("Given \\[gamma\\] here", withScope({ displayMath: "Check" })),
    ).toEqual(["Given", "gamma", "here"]);
  });

  it("checks an environment title, which converts to a <title> element", () => {
    expect(
      wordsIn("\\begin{theorem}[Pythagorean Bananna]\nBody\n\\end{theorem}"),
    ).toEqual(["Pythagorean", "Bananna", "Body"]);
  });

  it("never checks labels, references or paths", () => {
    expect(
      wordsIn(
        "\\label{thm-winding}\\ref{sec-introo} and " +
          "\\includegraphics[width=2in]{images/graff.png} here",
      ),
    ).toEqual(["and", "here"]);
  });

  it("checks the prose argument of a link but not its destination", () => {
    expect(wordsIn("See \\href{https://exampl.org/foo}{this pagee}")).toEqual([
      "See",
      "this",
      "pagee",
    ]);
    expect(wordsIn("See \\hyperref[sec-introo]{that pagee}")).toEqual([
      "See",
      "that",
      "pagee",
    ]);
  });

  it("ignores inline code macros by default", () => {
    expect(wordsIn("Run \\code{ptxfoo} and \\verb|zzz qqq| now")).toEqual([
      "Run",
      "and",
      "now",
    ]);
  });
});

describe("findCheckableMarkdownRegions", () => {
  const wordsIn = wordsFrom(findCheckableMarkdownRegions);

  it("checks prose and skips the directive markup around it", () => {
    expect(
      wordsIn(":::theorem[Pythagorean Bananna]{#thm-pyth}\nSome prose\n:::"),
    ).toEqual(["Pythagorean", "Bananna", "Some", "prose"]);
  });

  it("skips the name of a python-style directive but checks its title", () => {
    expect(wordsIn("Theorem[Pythagorean Bananna]:\n    Some prose")).toEqual([
      "Pythagorean",
      "Bananna",
      "Some",
      "prose",
    ]);
  });

  it("reports offsets that point at the word in the source", () => {
    const source = "A _winding_ number, see [the notes](notes.md).";
    for (const word of extractWords(
      source,
      findCheckableMarkdownRegions(source, DEFAULT_SPELL_CHECK_SCOPES),
    )) {
      expect(source.slice(word.start, word.end)).toBe(word.word);
    }
  });

  it("ignores inline and display math by default", () => {
    expect(
      wordsIn("Given $alpha beta$ and $$gamma delta$$ then finish"),
    ).toEqual(["Given", "and", "then", "finish"]);
  });

  it("ignores fenced code blocks by default", () => {
    expect(wordsIn("Run\n\n```python\nzzz qqq\n```\n\nnow")).toEqual([
      "Run",
      "now",
    ]);
  });

  it("ignores inline code by default", () => {
    expect(wordsIn("Run `ptxfoo` then `zzz qqq` now")).toEqual([
      "Run",
      "then",
      "now",
    ]);
  });

  it("checks comments by default but not when told otherwise", () => {
    const source = "Body <!-- a remark here --> tail";
    expect(wordsIn(source)).toEqual(["Body", "remark", "here", "tail"]);
    expect(wordsIn(source, withScope({ comments: "Ignore" }))).toEqual([
      "Body",
      "tail",
    ]);
  });

  it("checks an emphasised word and a _term_, but not an identifier", () => {
    expect(wordsIn("A **bolded** _termm_ and snake_casey here")).toEqual([
      "bolded",
      "termm",
      "and",
      "here",
    ]);
  });

  it("checks link text but never a destination", () => {
    expect(
      wordsIn("See [this pagee](notes/othr.md) and https://exampl.org/foo"),
    ).toEqual(["See", "this", "pagee", "and"]);
  });

  it("treats image alt text as an attribute value, like alt= in XML", () => {
    const source = "![a graff drawinng](images/graff.png) below";
    expect(wordsIn(source)).toEqual(["below"]);
    expect(wordsIn(source, withScope({ tags: "Check" }))).toEqual([
      "graff",
      "drawinng",
      "below",
    ]);
  });

  it("never checks ids, attributes or frontmatter", () => {
    expect(
      wordsIn("---\ntitle: Graff Theoryy\nxmlid: sec-introo\n---\n\n# Realy prose {#sec-realy}"),
    ).toEqual(["Realy", "prose"]);
  });

  it("checks math when the scope is switched on", () => {
    expect(
      wordsIn("Given $alpha$ here", withScope({ inlineMath: "Check" })),
    ).toEqual(["Given", "alpha", "here"]);
  });
});
