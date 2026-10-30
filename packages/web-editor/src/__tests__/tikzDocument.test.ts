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

  it("names the preamble for a line before the source", () => {
    const missing = "! LaTeX Error: File `nope.sty' not found.\nl.4 \\usepackage{nope}\n";
    expect(texErrorExcerpt(missing, 9)).toContain("preamble \\usepackage{nope}");
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
    expect(tikzFailureMessage("no errors here", "\\tikz;", 1)).toBe("TeX produced no picture.");
  });

  it("points at \\amp when a tikzcd has a literal ampersand", () => {
    const message = tikzFailureMessage("! Undefined control sequence.\n", "\\begin{tikzcd} A & B \\end{tikzcd}", 1);
    expect(message).toContain("! Undefined control sequence.");
    expect(message).toContain("\\amp");
    expect(tikzFailureMessage("! x\n", "\\begin{tikzcd} A \\amp B \\end{tikzcd}", 1)).not.toContain("\\amp");
  });
});

describe("TIKZ_BUNDLES", () => {
  // The fetch script keeps only these, and the worker fails to start on a bundle it left out.
  it("is the list the fetch script keeps", () => {
    const pin = JSON.parse(readFileSync(new URL("../../../../config/tikz_engine.json", import.meta.url), "utf8"));
    expect(pin.bundles).toEqual([...TIKZ_BUNDLES]);
  });
});
