import { describe, it, expect } from "vitest";
import {
  DEFAULT_SPELL_CHECK_SCOPES,
  type SpellCheckScope,
} from "../components/editorConfigs/spellcheck/scopes";
import { findCheckableRegions } from "../components/editorConfigs/spellcheck/xmlRegions";
import {
  extractWords,
  splitCompound,
} from "../components/editorConfigs/spellcheck/words";

/** The words a given source yields under the given scopes. */
const wordsIn = (
  source: string,
  scopes: SpellCheckScope = DEFAULT_SPELL_CHECK_SCOPES,
): string[] =>
  extractWords(source, findCheckableRegions(source, scopes)).map((w) => w.word);

const withScope = (
  overrides: Partial<SpellCheckScope>,
): SpellCheckScope => ({ ...DEFAULT_SPELL_CHECK_SCOPES, ...overrides });

describe("findCheckableRegions", () => {
  it("checks prose and skips the markup around it", () => {
    expect(wordsIn("<p>Hello there world</p>")).toEqual([
      "Hello",
      "there",
      "world",
    ]);
  });

  it("reports offsets that point at the word in the source", () => {
    const source = "<p>Hello world</p>";
    const found = extractWords(
      source,
      findCheckableRegions(source, DEFAULT_SPELL_CHECK_SCOPES),
    );
    for (const word of found) {
      expect(source.slice(word.start, word.end)).toBe(word.word);
    }
  });

  it("ignores inline and display math by default", () => {
    expect(
      wordsIn("<p>Given <m>alpha beta</m> and <me>gamma delta</me> done</p>"),
    ).toEqual(["Given", "and", "done"]);
  });

  it("ignores code elements by default", () => {
    expect(
      wordsIn("<p>Run <c>ptxfoo</c> then <program>zzz qqq</program> now</p>"),
    ).toEqual(["Run", "then", "now"]);
  });

  it("ignores latex-image content by default", () => {
    expect(
      wordsIn("<p>See <latex-image>draww circlee</latex-image> above</p>"),
    ).toEqual(["See", "above"]);
  });

  it("suppresses nested content inside an ignored element", () => {
    expect(
      wordsIn("<p>Before <latex-image>x <node>innerr</node> y</latex-image> after</p>"),
    ).toEqual(["Before", "after"]);
  });

  it("checks comments by default but not when told otherwise", () => {
    const source = "<p>Body <!-- a remark here --> tail</p>";
    expect(wordsIn(source)).toEqual(["Body", "remark", "here", "tail"]);
    expect(wordsIn(source, withScope({ comments: "Ignore" }))).toEqual([
      "Body",
      "tail",
    ]);
  });

  it("checks math when the scope is switched on", () => {
    expect(
      wordsIn("<p>Given <m>alpha</m> here</p>", withScope({ inlineMath: "Check" })),
    ).toEqual(["Given", "alpha", "here"]);
  });

  it("checks attribute values, but never tag or attribute names, when tags are checked", () => {
    // `section` and `title` are markup vocabulary; only the quoted value is prose.
    expect(
      wordsIn(
        '<section xml:id="sec-intro" title="Some Prose">Body</section>',
        withScope({ tags: "Check" }),
      ),
    ).toEqual(["Some", "Prose", "Body"]);
  });

  it("never looks inside CDATA", () => {
    expect(wordsIn("<p>Before <![CDATA[ zzz qqq ]]> after</p>")).toEqual([
      "Before",
      "after",
    ]);
  });

  it("does not let a > inside an attribute value end the tag early", () => {
    expect(wordsIn('<p title="a > b">Body text</p>')).toEqual(["Body", "text"]);
  });

  it("keeps checking after a stray < that is not a tag", () => {
    expect(wordsIn("<p>When alpha < beta the result holds</p>")).toEqual([
      "When",
      "alpha",
      "beta",
      "the",
      "result",
      "holds",
    ]);
  });

  it("treats an unterminated comment as comment text, per the comments scope", () => {
    // Half-typed `<!--` is the common case, and its text is genuinely comment
    // prose — so it follows the scope rather than becoming a parse failure.
    expect(wordsIn("<p>Body <!-- dangling remark")).toEqual([
      "Body",
      "dangling",
      "remark",
    ]);
    expect(
      wordsIn("<p>Body <!-- dangling remark", withScope({ comments: "Ignore" })),
    ).toEqual(["Body"]);
  });

  it("survives an unclosed ignored element by suppressing to the end", () => {
    expect(wordsIn("<p>Body <m>alpha beta")).toEqual(["Body"]);
  });

  it("recovers from a mismatched end tag instead of desynchronising", () => {
    expect(wordsIn("<p>One <em>two</strong> three</p> four")).toEqual([
      "One",
      "two",
      "three",
      "four",
    ]);
  });

  it("does not treat a self-closing ignored element as opening a region", () => {
    expect(wordsIn("<p>Before <image source='x.png'/> after</p>")).toEqual([
      "Before",
      "after",
    ]);
  });
});

describe("extractWords", () => {
  it("keeps contractions and possessives whole", () => {
    expect(wordsIn("<p>don't Cauchy's theorem</p>")).toEqual([
      "don't",
      "Cauchy's",
      "theorem",
    ]);
  });

  it("splits hyphenated compounds into checkable parts", () => {
    expect(wordsIn("<p>a well-known result</p>")).toEqual([
      "well",
      "known",
      "result",
    ]);
  });

  it("skips very short words and acronyms", () => {
    expect(wordsIn("<p>an HTML PDF file of the day</p>")).toEqual([
      "file",
      "the",
      "day",
    ]);
  });

  it("skips identifiers, paths, macros and handles", () => {
    expect(
      wordsIn("<p>see images/figure and snake_case and \\alpha and @handle</p>"),
    ).toEqual(["see", "and", "and", "and"]);
  });

  it("skips entity references", () => {
    expect(wordsIn("<p>this &amp; that</p>")).toEqual(["this", "that"]);
  });

  it("skips words that read as calls", () => {
    expect(wordsIn("<p>call compute(x) now</p>")).toEqual(["call", "now"]);
  });
});

describe("splitCompound", () => {
  it("splits CamelCase so the parts can be checked individually", () => {
    expect(splitCompound("CamelCase")).toEqual(["Camel", "Case"]);
    expect(splitCompound("lowerCamel")).toEqual(["lower", "Camel"]);
  });

  it("leaves ordinary words alone", () => {
    expect(splitCompound("theorem")).toEqual(["theorem"]);
    expect(splitCompound("Theorem")).toEqual(["Theorem"]);
  });
});
