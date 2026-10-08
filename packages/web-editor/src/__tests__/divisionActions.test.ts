import { describe, it, expect, vi } from "vitest";
import {
  canAddChildDivision,
  divisionActionEntries,
  findDivisionPlacement,
  type DivisionActionHandlers,
} from "../components/toc/divisionActions";
import type { Division } from "../types/sections";

const division = (
  xmlId: string,
  type: Division["type"],
  source: string,
): Division => ({ id: xmlId, xmlId, title: xmlId, type, sourceFormat: "pretext", source });

// doc → sec → (ex); orph → orphchild, with orph unreachable from doc.
const pool: Division[] = [
  division("doc", "article", '<article xml:id="doc"><plus:section ref="sec"/></article>'),
  division("sec", "section", '<section xml:id="sec"><plus:exercises ref="ex"/></section>'),
  division("ex", "exercises", '<exercises xml:id="ex"/>'),
  division("orph", "section", '<section xml:id="orph"><plus:subsection ref="orphchild"/></section>'),
  division("orphchild", "subsection", '<subsection xml:id="orphchild"/>'),
];

const handlers = (): DivisionActionHandlers => ({
  unplace: vi.fn(),
  remove: vi.fn(),
  placeInDocument: vi.fn(),
});

const labels = (xmlId: string) =>
  divisionActionEntries(
    pool.find((d) => d.xmlId === xmlId)!,
    findDivisionPlacement(pool, "doc", xmlId),
    handlers(),
  ).map((a) => a.label);

describe("findDivisionPlacement", () => {
  it("tells the root, placed divisions and unplaced ones apart", () => {
    expect(findDivisionPlacement(pool, "doc", "doc")).toEqual({ kind: "root" });
    expect(findDivisionPlacement(pool, "doc", "sec")).toEqual({
      kind: "placed",
      parentXmlId: "doc",
    });
    expect(findDivisionPlacement(pool, "doc", "ex")).toEqual({
      kind: "placed",
      parentXmlId: "sec",
    });
    expect(findDivisionPlacement(pool, "doc", "orph")).toEqual({
      kind: "unplaced",
      parentXmlId: null,
    });
    expect(findDivisionPlacement(pool, "doc", "orphchild")).toEqual({
      kind: "unplaced",
      parentXmlId: "orph",
    });
  });
});

describe("canAddChildDivision", () => {
  const canAdd = (xmlId: string) =>
    canAddChildDivision(
      pool.find((d) => d.xmlId === xmlId)!,
      findDivisionPlacement(pool, "doc", xmlId),
    );

  it("lets the root and placed divisions grow, when their type holds divisions", () => {
    expect(canAdd("doc")).toBe(true);
    expect(canAdd("sec")).toBe(true);
    // <exercises> holds no divisions, so there is no child to add.
    expect(canAdd("ex")).toBe(false);
  });

  it("offers an unplaced division no child", () => {
    expect(canAdd("orph")).toBe(false);
    expect(canAdd("orphchild")).toBe(false);
  });
});

describe("divisionActionEntries", () => {
  it("offers the root no drawer actions", () => {
    expect(labels("doc")).toEqual([]);
  });

  it("offers a placed division removal and deletion", () => {
    expect(labels("sec")).toEqual(["Remove from document", "Delete from project"]);
    expect(labels("ex")).toEqual(["Remove from document", "Delete from project"]);
  });

  it("offers an unplaced subtree's head a way back into the document", () => {
    expect(labels("orph")).toEqual(["Place in document", "Delete from project"]);
    expect(labels("orphchild")).toEqual(["Delete from project"]);
  });

  it("routes each action to its handler with the division's parent", () => {
    const h = handlers();
    const sec = pool[1];
    const entries = divisionActionEntries(sec, { kind: "placed", parentXmlId: "doc" }, h);
    entries.find((a) => a.label === "Remove from document")!.onClick();
    entries.find((a) => a.label === "Delete from project")!.onClick();
    expect(h.unplace).toHaveBeenCalledWith("sec", "doc");
    expect(h.remove).toHaveBeenCalledWith(sec, "doc");
    expect(entries.find((a) => a.label === "Delete from project")!.danger).toBe(true);
  });
});
