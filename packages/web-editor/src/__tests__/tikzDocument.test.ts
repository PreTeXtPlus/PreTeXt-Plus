/**
 * The document the TikZ worker compiles, and what an author is told when TeX
 * refuses it. These are the two places the buffer, which holds TeX, meets the
 * docinfo, which holds XML, and the transcript, which counts lines of a document
 * the author never sees.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { buildTikzDocument, docinfoTextToTex, DEFAULT_LATEX_IMAGE_PREAMBLE } from "../generators/tikz/document";
import { texErrorExcerpt, tikzFailureMessage } from "../generators/tikz/texLog";
import { TIKZ_BUNDLES } from "../generators/tikz/worker/protocol";

describe("docinfoTextToTex", () => {
  it("resolves references, drops comments and unwraps CDATA", () => {
    expect(docinfoTextToTex("a &lt; b &amp;&amp; c &gt; d")).toBe("a < b && c > d");
    expect(docinfoTextToTex("\\def\\a{1}<!-- &lt; not this -->\\def\\b{2}")).toBe("\\def\\a{1}\\def\\b{2}");
    expect(docinfoTextToTex("<![CDATA[x & y < &amp;]]> &amp;")).toBe("x & y < &amp; &");
  });
});

describe("buildTikzDocument", () => {
  const input = { source: "\\tikz\\draw (0,0);", preamble: "\\usepackage{tikz-cd}", macros: "\\def\\a{1}" };

  it("is the document core writes for a latex-image, in core's order", () => {
    const { document } = buildTikzDocument(input);
    const order = [
      "\\documentclass",
      "\\usepackage{amsmath,amssymb}",
      DEFAULT_LATEX_IMAGE_PREAMBLE,
      "\\usepackage{tikz-cd}",
      "\\ifdefined\\tikzset \\tikzset{ampersand replacement = \\amp}\\fi",
      "\\def\\a{1}",
      "\\begin{document}",
      "\\tikz\\draw (0,0);",
      "\\end{document}",
    ].map((piece) => document.indexOf(piece));
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("gives TeX the docinfo as text and the source as it stands", () => {
    const { document } = buildTikzDocument({
      source: "\\node {$a < b$} &amp;",
      preamble: "\\def\\lt{&lt;}",
      macros: "\\def\\amper{\\&amp;}",
    });
    expect(document).toContain("\\def\\lt{<}");
    expect(document).toContain("\\def\\amper{\\&}");
    expect(document).toContain("\\node {$a < b$} &amp;");
  });

  it("says which line of the document the source starts on, whatever the preamble's length", () => {
    const { document, sourceLine } = buildTikzDocument({ ...input, preamble: "\\a\n\\b\n\\c" });
    expect(document.split("\n")[sourceLine - 1]).toBe(input.source);
  });
});

describe("texErrorExcerpt", () => {
  const log = [
    "This is pdfTeX, Version 3.141592653",
    "(./doc.tex",
    "! Undefined control sequence.",
    "l.14 \\draw (0,0) -- \\nosuchmacro",
    "                                (1,1);",
    "The control sequence at the end of the top line",
    "of your error message was never \\def'ed.",
    "! Another error.",
  ].join("\n");

  it("runs from the first error through the lines that say where TeX stopped", () => {
    expect(texErrorExcerpt(log, 1)).toBe(
      [
        "! Undefined control sequence.",
        "l.14 \\draw (0,0) -- \\nosuchmacro",
        "                                (1,1);",
      ].join("\n"),
    );
  });

  it("numbers lines from the source, keeping the next line's alignment", () => {
    const [, context, under] = texErrorExcerpt(log, 12)!.split("\n");
    expect(context).toBe("l.3  \\draw (0,0) -- \\nosuchmacro");
    expect(under.indexOf("(1,1)")).toBe(context.length);
  });

  it("names the preamble for a line before the source, shifting the next line to match", () => {
    const context = "l.4 \\usepackage{nope}";
    const missing = `! LaTeX Error: File \`nope.sty' not found.\n${context}\n${" ".repeat(context.length)}{x}`;
    const [, renumbered, under] = texErrorExcerpt(missing, 9)!.split("\n");
    expect(renumbered).toBe("preamble \\usepackage{nope}");
    expect(under.indexOf("{x}")).toBe(renumbered.length);
  });

  it("leaves a line of a package file as the package's own", () => {
    const inPackage = [
      "(./doc.tex (/tex/latex/base/article.cls",
      "Document Class: article 2024/06/29 v1.4n (LaTeX2e)",
      ") (/tex/latex/foo/foo.sty",
      "! Undefined control sequence.",
      "l.120 \\nosuch",
      "",
    ].join("\n");
    expect(texErrorExcerpt(inPackage, 9)).toContain("l.120 \\nosuch");

    const inDocument = inPackage.replace("(/tex/latex/foo/foo.sty", "(/tex/latex/foo/foo.sty)");
    expect(texErrorExcerpt(inDocument, 9)).toContain("l.112 \\nosuch");
  });

  it("stops at a bound when TeX gives no line", () => {
    const endless = ["! Emergency stop.", ...Array.from({ length: 50 }, (_, i) => `line ${i}`)].join("\n");
    expect(texErrorExcerpt(endless, 1)!.split("\n")).toHaveLength(12);
  });

  it("finds nothing in a clean transcript", () => {
    expect(texErrorExcerpt("This is pdfTeX\nOutput written on doc.dvi", 1)).toBeUndefined();
  });
});

describe("tikzFailureMessage", () => {
  it("falls back to a plain statement when TeX reported no error", () => {
    expect(tikzFailureMessage("no errors here", 1)).toBe("TeX produced no picture.");
  });

  it("points at \\amp when TeX stopped at a bare ampersand, and only then", () => {
    // What the engine says of `A \arrow[r, "f"] & B` in a tikzcd.
    const log = [
      "! Undefined control sequence.",
      "<argument> \\pgf@matrix@last@nextcell@options ",
      "                                             ",
      'l.2 A \\arrow[r, "f"] &',
      "                       B",
      "",
    ].join("\n");
    const message = tikzFailureMessage(log, 1);
    expect(message).toContain("! Undefined control sequence.");
    expect(message).toContain("\\amp");
    // An unrelated error stopping elsewhere on a line with a `&` (a comment, say).
    expect(tikzFailureMessage("! Undefined control sequence.\nl.3 \\nosuch\n           % a & b\n", 1)).not.toContain(
      "\\amp",
    );
  });
});

describe("TIKZ_BUNDLES", () => {
  // The fetch script keeps only these, and the worker fails to start on a bundle it left out.
  it("is the list the fetch script keeps", () => {
    const pin = JSON.parse(readFileSync(new URL("../../../../config/tikz_engine.json", import.meta.url), "utf8"));
    expect(pin.bundles).toEqual([...TIKZ_BUNDLES]);
  });
});
