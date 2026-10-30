import { describe, it, expect } from "vitest";
import {
  generators,
  generatorIds,
  generatorFor,
  renderInputFor,
  sha256Hex,
  docinfoElementInner,
  RENDER_INPUT_SEPARATOR,
} from "../generators/index";
import { RENDER_INPUT_SEPARATOR as SEPARATOR } from "../generators/renderInput";
import { editorConfigs } from "../components/editorConfigs";

describe("renderInput", () => {
  // Rails digests the identical string (Content#render_input); this hex is pinned in
  // test/models/content_test.rb too. If either side changes what it digests, both fail.
  it("digests the source and the generator's docinfo elements to the fixture Rails pins", async () => {
    const docinfo = "<docinfo>\n  <macros>\\newcommand{\\R}{\\mathbb{R}}</macros>\n</docinfo>";
    const input = renderInputFor(generators.prefigure, '<diagram dimensions="(300,300)"/>', docinfo);
    expect(input).toBe(
      ['<diagram dimensions="(300,300)"/>', "\\newcommand{\\R}{\\mathbb{R}}", ""].join(SEPARATOR),
    );
    expect(await sha256Hex(input)).toBe(
      "65ad0eda2b54873333e717242fe79d69243c7ac4f4f1ce5a37fe8641f0d2e9c3",
    );
  });

  it("digests a TikZ asset's preamble to the fixture Rails pins, passing over one with @syntax as core does", async () => {
    const source = "\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}";
    const docinfo = [
      "<docinfo>",
      "  <macros>\\newcommand{\\R}{\\mathbb{R}}</macros>",
      '  <latex-image-preamble syntax="PGF">\\usepackage{ignored}</latex-image-preamble>',
      "  <latex-image-preamble>\\usetikzlibrary{calc}</latex-image-preamble>",
      "</docinfo>",
    ].join("\n");
    const input = renderInputFor(generators.tikz, source, docinfo);
    expect(input).toBe([source, "\\newcommand{\\R}{\\mathbb{R}}", "\\usetikzlibrary{calc}"].join(SEPARATOR));
    expect(await sha256Hex(input)).toBe(
      "9cbc7d80acb18afb7b3fb96cdab13750344d897c4fe2d55d98be4e3dfdcfa711",
    );
  });

  it("reads an element's raw inner text, tolerating attributes, and is empty when absent", () => {
    expect(
      docinfoElementInner('<docinfo><macros xml:space="preserve"> a &amp; b </macros></docinfo>', "macros"),
    ).toBe(" a &amp; b ");
    expect(docinfoElementInner("<docinfo/>", "prefigure-preamble")).toBe("");
    // The separator is one no author types, so a source cannot forge a boundary.
    expect(RENDER_INPUT_SEPARATOR).toContain("\u0000");
  });
});

describe("registry", () => {
  it("every generator wraps its source with the ref as the label and opens with something", () => {
    for (const id of generatorIds) {
      const generator = generators[id];
      const wrapped = generator.wrapSource("the source", "my-fig");
      expect(wrapped).toContain('label="my-fig"');
      expect(wrapped).toContain("the source");
      expect(generator.starterSource.trim()).not.toBe("");
    }
  });

  // An asset's source format is what makes it a generated asset: each generator's
  // id is a format, and PreTeXt (or no format at all) is not a generator's.
  it("finds the generator an asset's source format names, and none for PreTeXt", () => {
    for (const id of generatorIds) expect(generatorFor(id)).toBe(generators[id]);
    expect(generatorFor("pretext")).toBeUndefined();
    expect(generatorFor(undefined)).toBeUndefined();
  });

  // TeX is not XML: an author writes `x < y` and a tikzcd row as they are, and
  // the document's copy of it is escaped.
  it("tikz wraps its source as the XML text of a latex-image", () => {
    expect(generators.tikz.wrapSource("a < b & c > d \\amp 'e' \"f\"", "fig")).toBe(
      "<latex-image label=\"fig\">\na &lt; b &amp; c &gt; d \\amp 'e' \"f\"\n</latex-image>",
    );
  });

  it("every generator's language is one the code editor has", () => {
    for (const id of generatorIds) expect(editorConfigs[generators[id].language]).toBeDefined();
  });

  it("prefigure wraps in the PreFigure namespace", () => {
    expect(generators.prefigure.wrapSource("<diagram/>", "fig")).toBe(
      '<prefigure xmlns="https://prefigure.org" label="fig">\n<diagram/>\n</prefigure>',
    );
  });
});
