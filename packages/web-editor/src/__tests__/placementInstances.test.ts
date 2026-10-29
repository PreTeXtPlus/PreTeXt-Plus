/**
 * A record placed more than once: PreTeXt requires `@label` and `@xml:id` to
 * be unique, and a generated image's `@label` is its filename, so every
 * placement but the unnamed one names an `instance` and assembly makes the
 * identifiers inside it its own.
 */
import { describe, it, expect } from "vitest";
import {
  addPlacementInstance,
  assembleFullProjectSource,
  parsePlacements,
  qualifyIdentifiers,
} from "../sectionUtils";
import type { Division } from "../types/sections";
import type { Asset, Snippet } from "../types/editor";

const root = (source: string, sourceFormat: Division["sourceFormat"] = "pretext"): Division[] => [
  { id: "1", xmlId: "doc", title: "Doc", type: "article", sourceFormat, source },
];
const graph: Asset = { id: "a1", ref: "graph", title: "Graph", sourceFormat: "prefigure", source: "<diagram/>" };
const labelsIn = (xml: string) => [...xml.matchAll(/<prefigure\b[^>]*\blabel="([^"]+)"/g)].map((m) => m[1]);

describe("qualifyIdentifiers", () => {
  it("renames every xml:id and label, and the references inside that point at them", () => {
    const xml =
      '<theorem xml:id="thm" label="thm"><statement><p>See <xref ref="thm"/>, ' +
      '<xref ref="outside"/> and <xref first="thm" last="outside"/>.</p></statement></theorem>';
    expect(qualifyIdentifiers(xml, "ch3")).toBe(
      '<theorem xml:id="thm-ch3" label="thm-ch3"><statement><p>See <xref ref="thm-ch3"/>, ' +
        '<xref ref="outside"/> and <xref first="thm-ch3" last="outside"/>.</p></statement></theorem>',
    );
  });

  it("follows each target of a reference list", () => {
    expect(qualifyIdentifiers('<p xml:id="a"/><xref ref="a, b"/>', "x")).toBe('<p xml:id="a-x"/><xref ref="a-x, b"/>');
  });

  it("qualifies a generator element's own label but nothing inside it", () => {
    const xml =
      '<image><prefigure xmlns="https://prefigure.org" label="graph">' +
      '<diagram><point label="p" p="(1,2)"/></diagram></prefigure></image>';
    expect(qualifyIdentifiers(xml, "ch3")).toBe(xml.replace('label="graph"', 'label="graph-ch3"'));
  });

  it("is not thrown by drawing code that looks like markup", () => {
    const xml = '<image><latex-image label="fig">\\draw (0,0) -- (a<b); x label="no"</latex-image></image>';
    expect(qualifyIdentifiers(xml, "i")).toBe(xml.replace('label="fig"', 'label="fig-i"'));
  });
});

describe("assembling a record placed twice", () => {
  it("gives a generated image's named placement its own label, and drops the instance attribute", () => {
    const xml = assembleFullProjectSource(
      root('<p>Once</p>\n<plus:image ref="graph"/>\n<plus:image ref="graph" instance="again" width="50%"/>'),
      "doc",
      "",
      [graph],
    );
    expect(labelsIn(xml)).toEqual(["graph", "graph-again"]);
    expect(xml).not.toContain("instance=");
    expect(xml).toContain('<image width="50%">');
  });

  it("does the same from LaTeX's optional argument and Markdown's directive attribute", () => {
    const latex = assembleFullProjectSource(
      root("\\plus{image}{graph}\n\n\\plus[instance=again]{image}{graph}", "latex"),
      "doc",
      "",
      [graph],
    );
    expect(labelsIn(latex)).toEqual(["graph", "graph-again"]);

    const markdown = assembleFullProjectSource(
      root('::image{ref="graph"}\n\n::image{ref="graph" instance="again"}', "markdown"),
      "doc",
      "",
      [graph],
    );
    expect(labelsIn(markdown)).toEqual(["graph", "graph-again"]);
  });

  it("makes a reused snippet's ids its own, its internal xrefs following, nested images included", () => {
    const snippet: Snippet = {
      id: "s1",
      ref: "fact",
      sourceFormat: "pretext",
      source: '<theorem xml:id="fact-thm"><statement><p>True, see <xref ref="fact-thm"/>.</p></statement></theorem>\n<plus:image ref="graph"/>',
    };
    const xml = assembleFullProjectSource(
      root('<plus:snippet ref="fact"/>\n<plus:snippet ref="fact" instance="recap"/>'),
      "doc",
      "",
      [graph],
      undefined,
      [snippet],
    );
    expect(xml).toContain('<theorem xml:id="fact-thm">');
    expect(xml).toContain('<theorem xml:id="fact-thm-recap">');
    expect(xml).toContain('<xref ref="fact-thm-recap"/>');
    expect(labelsIn(xml)).toEqual(["graph", "graph-recap"]);
  });
});

describe("placements", () => {
  it("are found in every format, with their instance and position", () => {
    const pretext = '<p/><plus:image ref="graph"/> <plus:snippet ref="fact" instance="recap"/>';
    expect(parsePlacements(pretext, "pretext")).toEqual([
      { tag: "image", ref: "graph", instance: undefined, index: 4, length: 25 },
      { tag: "snippet", ref: "fact", instance: "recap", index: 30, length: 43 },
    ]);
    expect(parsePlacements("\\plus[width=50%,instance=b]{image}{graph}", "latex")).toEqual([
      { tag: "image", ref: "graph", instance: "b", index: 0, length: 41 },
    ]);
    expect(parsePlacements('::snippet{ref="fact" instance="x"}', "markdown")[0]).toMatchObject({
      tag: "snippet",
      ref: "fact",
      instance: "x",
    });
  });

  it("ignore examples inside verbatim spans", () => {
    expect(parsePlacements('<pre>&lt;plus:image ref="x"/&gt;</pre><c><plus:image ref="y"/></c>', "pretext")).toEqual([]);
  });

  it("take an instance name in each format's own syntax", () => {
    const cases: [Parameters<typeof addPlacementInstance>[1], string, string][] = [
      ["pretext", '<plus:image ref="graph"/>', '<plus:image ref="graph" instance="n"/>'],
      ["pretext", '<plus:image ref="graph" />', '<plus:image ref="graph" instance="n" />'],
      ["markdown", '::image{ref="graph"}', '::image{ref="graph" instance="n"}'],
      ["latex", "\\plus{image}{graph}", "\\plus[instance=n]{image}{graph}"],
      ["latex", "\\plus[width=50%]{image}{graph}", "\\plus[width=50%,instance=n]{image}{graph}"],
    ];
    for (const [format, before, after] of cases) {
      expect(addPlacementInstance(before, format, "n")).toBe(after);
      expect(parsePlacements(after, format)[0]?.instance).toBe("n");
    }
  });
});
