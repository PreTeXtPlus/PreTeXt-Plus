/**
 * The editor's reading of `$` in Markdown-style PreTeXt, held against the
 * converter's: a price must not look like math to the highlighter, the linter,
 * completions or the spell checker, since it won't be math in the output.
 */
import { describe, expect, it } from "vitest";
import { markdownToPretext } from "@pretextbook/remark-pretext";
import { scanDocument } from "@pretextbook/markdown-style-pretext";
import { maskProseDollars } from "../components/editorConfigs/markdownDollars";
import { markdownFlavor } from "../components/editorConfigs/markdownConfig";
import { DEFAULT_SPELL_CHECK_SCOPES } from "../components/editorConfigs/spellcheck/scopes";
import { findCheckableMarkdownRegions } from "../components/editorConfigs/spellcheck/markdownRegions";

/** One paragraph's worth of inline `$`, in each of the ways it can go. */
const INLINE_SOURCES = [
  "$2 to $5 dollars",
  "It costs $5.",
  "From $5 to $10, or $x^2$ when it is math.",
  "US$5 and US$6",
  "a$b$c",
  "$x$ and $y$",
  "$x$-axis and ($y$)",
  "$x$s",
  "$ x $",
  "$x $",
  "$ x$",
  "\\$5 and \\$6",
  "\\\\$x$",
  "$a\\$b$",
  "`$a` and $b`c$",
  "$α$ and é$5$",
];

const mathCount = (pretext: string) => pretext.match(/<m>/g)?.length ?? 0;

/** Pairs of `$` left in a masked source, not counting escaped ones. */
const pairsKept = (masked: string) =>
  (masked.replace(/\\[\s\S]/g, "").match(/\$/g)?.length ?? 0) / 2;

describe("maskProseDollars", () => {
  it.each(INLINE_SOURCES)("agrees with the converter on %s", (source) => {
    expect(pairsKept(maskProseDollars(source))).toBe(
      mathCount(markdownToPretext(source)),
    );
  });

  it("keeps the length, so offsets still fit the source", () => {
    for (const source of INLINE_SOURCES) {
      expect(maskProseDollars(source)).toHaveLength(source.length);
    }
  });

  it("leaves display math alone", () => {
    const source = "$$\nx\n$$\n\nand $$y$$ and \\[z\\]";
    expect(maskProseDollars(source)).toBe(source);
  });

  it("keeps a `$` still being typed on the cursor's line only", () => {
    const source = "It costs $5.\n\nMath $\\fr\n\nAnd $6.";
    const cursor = source.indexOf("\\fr") + 3;
    expect(maskProseDollars(source, cursor)).toBe(
      "It costs  5.\n\nMath $\\fr\n\nAnd  6.",
    );
  });

  it("copes with a cursor before a leading newline", () => {
    expect(maskProseDollars("\n$5", 0)).toBe("\n 5");
  });
});

describe("a `$` that isn't math leaves the document alone", () => {
  const source =
    "It costs $5.\n\n[site](https://example.com/$foo)\n\n" +
    '<url href="https://example.com/$bar">there</url>\n\n' +
    "## Intro {#sec-intro}\n\n:::thorem\nBody\n:::\n\nA misspeled word.\n";

  it("finds no math in it", () => {
    expect(scanDocument(maskProseDollars(source)).mathRegions).toEqual([]);
  });

  it("still lints a directive below it", async () => {
    const messages = (await markdownFlavor.getDiagnostics(source)).map(
      (diagnostic) => diagnostic.message,
    );
    expect(messages.join()).toContain(":::thorem");
  });

  it("still harvests ids below it", () => {
    const text = `${source}\nSee [](#sec`;
    const items = markdownFlavor.getCompletions({ text, offset: text.length });
    expect(items.map((item) => item.label)).toContain("sec-intro");
  });

  it("still offers directives below it", () => {
    const text = "It costs $5.\n\n:::\n\nAnd more.\n";
    const offset = text.indexOf(":::") + 3;
    const items = markdownFlavor.getCompletions({ text, offset });
    expect(items.map((item) => item.label)).toContain("theorem");
  });

  it("still offers math macros in math with no closing `$` yet", () => {
    const text = "Let $\\fra";
    const items = markdownFlavor.getCompletions({ text, offset: text.length });
    expect(items.map((item) => item.label)).toContain("frac");
  });

  it("still spell checks what follows it", () => {
    const checked = findCheckableMarkdownRegions(
      source,
      DEFAULT_SPELL_CHECK_SCOPES,
    )
      .map((region) => source.slice(region.start, region.end))
      .join("");
    expect(checked).toContain("A misspeled word.");
    expect(checked).toContain("there");
  });

  it("does not spell check a raw tag's name or attributes", () => {
    const text = '<url href="https://example.com">there</url>';
    const checked = findCheckableMarkdownRegions(
      text,
      DEFAULT_SPELL_CHECK_SCOPES,
    )
      .map((region) => text.slice(region.start, region.end))
      .join("|");
    expect(checked).toBe("there");
  });
});
