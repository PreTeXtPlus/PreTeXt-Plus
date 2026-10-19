import { describe, it, expect } from "vitest";
import {
  generators,
  generatorIds,
  renderInputFor,
  sha256Hex,
  docinfoElementInner,
  RENDER_INPUT_SEPARATOR,
} from "../generators/index";
import { RENDER_INPUT_SEPARATOR as SEPARATOR } from "../generators/renderInput";
import { diagcessSvg, hasAnnotations, prefigureOutputFilenames } from "../generators/prefigure/outputs";

describe("renderInput", () => {
  // Rails digests the identical string (Asset#render_input); this hex is pinned in
  // test/models/asset_test.rb too. If either side changes what it digests, both fail.
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
  it("every generator wraps its source with the ref as the label and names an SVG first", () => {
    for (const id of generatorIds) {
      const generator = generators[id];
      const wrapped = generator.wrapSource("<diagram/>", "my-fig");
      expect(wrapped).toContain('label="my-fig"');
      expect(wrapped).toContain("<diagram/>");
      expect(generator.outputFilenames("my-fig", generator.starterSource)[0]).toBe("my-fig.svg");
      expect(generator.starterSource.trim()).not.toBe("");
    }
  });

  it("prefigure wraps in the PreFigure namespace", () => {
    expect(generators.prefigure.wrapSource("<diagram/>", "fig")).toBe(
      '<prefigure xmlns="https://prefigure.org" label="fig">\n<diagram/>\n</prefigure>',
    );
  });
});

describe("prefigure outputs", () => {
  it("an annotated diagram produces the annotations and diagcess companions", () => {
    expect(prefigureOutputFilenames("fig", "<diagram/>")).toEqual(["fig.svg"]);
    expect(prefigureOutputFilenames("fig", "<diagram><annotations><annotation/></annotations></diagram>")).toEqual([
      "fig.svg",
      "fig-annotations.xml",
      "fig-diagcess.svg",
    ]);
    expect(hasAnnotations("<diagram><annotations/></diagram>")).toBe(true);
    expect(hasAnnotations("<diagram><annotationsx/></diagram>")).toBe(false);
  });

  // What prefig writes as <label>-diagcess.svg: the same drawing with width/height
  // moved into an aspect-ratio style so diagcess can size it.
  it("diagcessSvg moves the root's width and height into an aspect-ratio style", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="1" height="1"/></svg>';
    expect(diagcessSvg(svg)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" style="aspect-ratio: 300 / 200;"><rect width="1" height="1"/></svg>',
    );
  });

  it("diagcessSvg leaves an SVG without dimensions alone", () => {
    const svg = '<svg viewBox="0 0 1 1"/>';
    expect(diagcessSvg(svg)).toBe(svg);
  });
});
