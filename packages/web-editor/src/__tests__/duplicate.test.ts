import { describe, it, expect } from "vitest";
import {
  NO_DUPLICATE_SUPPORT,
  canDuplicateAsset,
  canDuplicateDivision,
  copySource,
  copyTitle,
  projectXmlIds,
} from "../duplicate";
import type { Division } from "../types/sections";

const ALL = {
  division: true,
  snippet: true,
  exercise: true,
  fileAsset: true,
  authoredAsset: true,
  generatedAsset: true,
};

const division = (source: string, sourceFormat: Division["sourceFormat"] = "pretext"): Division => ({
  xmlId: "sec",
  title: "Section",
  type: "section",
  sourceFormat,
  source,
});

describe("copySource", () => {
  it("renames the ids the project already uses, and the references to them", () => {
    const source = '<p>See <xref ref="eq"/>.</p><md><mrow xml:id="eq">x</mrow></md><p xml:id="fresh"/>';
    const { source: copied, renamed } = copySource(source, "pretext", new Set(["eq"]), "sec-2");
    expect(renamed).toEqual([{ from: "eq", to: "eq-2" }]);
    expect(copied).toContain('xml:id="eq-2"');
    expect(copied).toContain('<xref ref="eq-2"/>');
    // Unique ids are the author's, and stay.
    expect(copied).toContain('xml:id="fresh"');
  });

  it("keeps an inner id clear of the copy's own ref", () => {
    const { renamed } = copySource('<p xml:id="sec-2"/>', "pretext", new Set(), "sec-2");
    expect(renamed).toEqual([{ from: "sec-2", to: expect.not.stringMatching(/^sec-2$/) }]);
  });

  it("reads an absent format as PreTeXt", () => {
    expect(copySource('<p xml:id="a"/>', undefined, new Set(["a"]), "x").renamed).toHaveLength(1);
  });

  it("copies other formats as they are", () => {
    const prefigure = '<diagram><point xml:id="a" p="(0,0)"/></diagram>';
    expect(copySource(prefigure, "prefigure", new Set(["a"]), "x")).toEqual({ source: prefigure, renamed: [] });
    const latex = "\\begin{equation}\\label{a}x\\end{equation}";
    expect(copySource(latex, "latex", new Set(["a"]), "x")).toEqual({ source: latex, renamed: [] });
  });
});

describe("copyTitle", () => {
  it("marks a title as a copy, and leaves a blank one blank", () => {
    expect(copyTitle("Graph")).toBe("Graph (copy)");
    expect(copyTitle("  ")).toBe("");
    expect(copyTitle(undefined)).toBe("");
  });
});

describe("canDuplicateDivision", () => {
  it("allows a division with no divisions inside it", () => {
    expect(canDuplicateDivision(division('<p>Hi</p><plus:image ref="fig"/>'), false)).toBe(true);
  });

  it("refuses the root", () => {
    expect(canDuplicateDivision(division("<p>Hi</p>"), true)).toBe(false);
  });

  it("refuses a division that places another, even commented out", () => {
    expect(canDuplicateDivision(division('<plus:subsection ref="a"/>'), false)).toBe(false);
    expect(canDuplicateDivision(division('<!-- <plus:subsection ref="a"/> -->'), false)).toBe(false);
    expect(canDuplicateDivision(division("\\plus{subsection}{a}", "latex"), false)).toBe(false);
  });
});

describe("canDuplicateAsset", () => {
  it("asks for the hooks each kind of asset is made with", () => {
    const generated = { ref: "g", title: "G", sourceFormat: "prefigure" as const };
    const file = { ref: "f", title: "F", isFile: true, url: "https://example.com/f.png" };
    const authored = { ref: "a", title: "A" };
    expect(canDuplicateAsset(generated, ALL)).toBe(true);
    expect(canDuplicateAsset(generated, { ...ALL, generatedAsset: false })).toBe(false);
    expect(canDuplicateAsset(file, ALL)).toBe(true);
    expect(canDuplicateAsset({ ...file, url: undefined }, ALL)).toBe(false);
    expect(canDuplicateAsset(authored, ALL)).toBe(true);
    expect(canDuplicateAsset(authored, NO_DUPLICATE_SUPPORT)).toBe(false);
  });
});

describe("projectXmlIds", () => {
  it("holds every ref and every xml:id written in any record", () => {
    const ids = projectXmlIds({
      divisions: [division('<p xml:id="in-div"/>')],
      projectSnippets: [{ ref: "snip", source: "<p xml:id='in-snip'/>" }],
      projectExercises: [{ ref: "ex", source: '<task xml:id="in-ex"/>' }],
      projectAssets: [{ ref: "img", title: "Img" }],
    });
    expect([...ids].sort()).toEqual(["ex", "img", "in-div", "in-ex", "in-snip", "sec", "snip"]);
  });
});
