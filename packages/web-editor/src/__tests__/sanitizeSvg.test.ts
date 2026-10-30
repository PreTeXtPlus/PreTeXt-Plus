/**
 * @vitest-environment jsdom
 *
 * The fixtures are real output of the TikZ engine (two figures from its own
 * guide), so what these keep is what the driver actually writes.
 */
import { describe, it, expect } from "vitest";
import { sanitizeSvg } from "../generators/tikz/sanitizeSvg";
import shading from "./fixtures/tikz-shading.svg?raw";
import pattern from "./fixtures/tikz-pattern.svg?raw";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** Reads the output the way an `<img>` does: as XML, which fails on a missing namespace. */
const parsed = (svg: string) => {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(document.querySelector("parsererror")).toBeNull();
  return document.documentElement;
};

const countOf = (root: Element, tag: string) => root.querySelectorAll(tag).length;
const elementsOf = (root: Element) => Array.from(root.querySelectorAll("*"));

const hostile = (body: string) =>
  `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" viewBox="0 0 10 10"><path d="M0 0L1 1"/>${body}</svg>`;

describe("sanitizeSvg", () => {
  it.each([
    ["shadings", shading],
    ["patterns", pattern],
  ])("keeps every element and attribute of %s", (_name, svg) => {
    const source = parsed(svg);
    const clean = parsed(sanitizeSvg(svg));
    expect(clean.namespaceURI).toBe(SVG_NS);
    expect(elementsOf(clean).map((element) => element.tagName)).toEqual(
      elementsOf(source).map((element) => element.tagName),
    );
    elementsOf(source).forEach((element, index) => {
      const kept = elementsOf(clean)[index];
      for (const attribute of Array.from(element.attributes)) {
        // DOMPurify trims values: the driver writes stop-color=' #00f '.
        expect(kept.getAttributeNS(attribute.namespaceURI, attribute.localName)).toBe(attribute.value.trim());
      }
    });
  });

  it("keeps a same-document reference, in its namespace, so an <img> can resolve it", () => {
    const clean = parsed(sanitizeSvg(hostile('<defs><path id="g"/></defs><use xlink:href="#g"/>')));
    expect(clean.querySelector("use")?.getAttributeNS(XLINK_NS, "href")).toBe("#g");
  });

  it("removes what TeX can inject with a raw special", () => {
    const clean = parsed(
      sanitizeSvg(
        hostile(`
          <script>alert(1)</script>
          <rect width="1" height="1" onclick="alert(2)"/>
          <foreignObject><div onmouseover="alert(3)"/></foreignObject>
          <style>@import url(https://example.com/x.css);</style>
          <animate attributeName="href" to="javascript:alert(4)"/>
          <set attributeName="onclick" to="alert(5)"/>`),
      ),
    );
    for (const tag of ["script", "foreignObject", "style", "animate", "set"]) expect(countOf(clean, tag)).toBe(0);
    expect(clean.querySelector("rect")?.hasAttribute("onclick")).toBe(false);
    expect(countOf(clean, "path")).toBe(1);
  });

  it("removes anything that reaches outside the picture", () => {
    const clean = parsed(
      sanitizeSvg(
        hostile(`
          <use xlink:href="https://example.com/x.svg#a"/>
          <use href="https://example.com/x.svg#b"/>
          <image xlink:href="https://example.com/x.png"/>`),
      ),
    );
    expect(countOf(clean, "use")).toBe(0);
    expect(countOf(clean, "image")).toBe(0);
  });

  it("keeps the drawing inside a link and drops where it goes", () => {
    const clean = parsed(
      sanitizeSvg(hostile('<a xlink:href="javascript:alert(1)"><rect width="1" height="1"/></a>')),
    );
    expect(countOf(clean, "rect")).toBe(1);
    expect(clean.querySelector("a")?.getAttributeNS(XLINK_NS, "href") ?? null).toBeNull();
  });

  it("refuses output with no picture in it", () => {
    expect(() => sanitizeSvg("<script>alert(1)</script>")).toThrow("no picture");
  });
});
