/**
 * The live preview shows a generated asset's stored picture wherever the page
 * refers to `generated/<element>/<label>.svg`, under any placement's label.
 */
import { describe, it, expect } from "vitest";
import { generatedImageResolver, rewriteGeneratedImages } from "../generators/previewImages";
import type { Asset } from "../types/editor";

const assets: Asset[] = [
  { ref: "graph", title: "Graph", sourceFormat: "prefigure", url: "/p/external/graph.svg", previewInputDigest: "0123456789abcdef0123" },
  { ref: "graph-two", title: "Graph two", sourceFormat: "prefigure", url: "/p/external/graph-two.svg" },
  { ref: "unrendered", title: "Not yet", sourceFormat: "prefigure" },
  { ref: "photo", title: "Photo", url: "/p/external/photo.png" },
];
const resolve = generatedImageResolver(assets);

describe("generatedImageResolver", () => {
  it("resolves a plain label, and a placement's qualified one, to the asset's versioned URL", () => {
    expect(resolve("prefigure", "graph")).toBe("/p/external/graph.svg?v=0123456789abcdef");
    expect(resolve("prefigure", "graph-ch3")).toBe("/p/external/graph.svg?v=0123456789abcdef");
  });

  it("prefers the longest ref the label extends", () => {
    expect(resolve("prefigure", "graph-two")).toBe("/p/external/graph-two.svg");
    expect(resolve("prefigure", "graph-two-ch3")).toBe("/p/external/graph-two.svg");
  });

  it("leaves what it cannot place: no stored picture, another element, not a generated asset", () => {
    expect(resolve("prefigure", "unrendered")).toBeUndefined();
    expect(resolve("latex-image", "graph")).toBeUndefined();
    expect(resolve("prefigure", "photo")).toBeUndefined();
  });
});

describe("rewriteGeneratedImages", () => {
  it("rewrites the generated paths it can resolve and leaves everything else", () => {
    const html =
      '<img src="generated/prefigure/graph-ch3.svg" alt="x">' +
      '<img src="generated/prefigure/unrendered.svg">' +
      '<img src="external/photo.png">';
    expect(rewriteGeneratedImages(html, resolve)).toBe(
      '<img src="/p/external/graph.svg?v=0123456789abcdef" alt="x">' +
        '<img src="generated/prefigure/unrendered.svg">' +
        '<img src="external/photo.png">',
    );
  });
});
