import { describe, it, expect } from "vitest";
import type { DivisionType } from "../types/sections";
import {
  ALLOWED_CHILD_DIVISION_TYPES,
  DIVISION_ID_PREFIXES,
  canContainDivisions,
  defaultChildDivisionType,
  getSelectableDivisionTypes,
} from "../components/toc/types";

/**
 * `DIVISION_ID_PREFIXES` is a total `Record<DivisionType, …>`, so its keys are
 * every division type the editor knows about — a stand-in for enumerating the
 * union at runtime.
 */
const ALL_DIVISION_TYPES = Object.keys(DIVISION_ID_PREFIXES) as DivisionType[];

describe("ALLOWED_CHILD_DIVISION_TYPES", () => {
  it("states a rule for every division type", () => {
    for (const type of ALL_DIVISION_TYPES) {
      expect(ALLOWED_CHILD_DIVISION_TYPES[type], type).toBeDefined();
    }
  });

  it("never allows a child that is more structural than its parent", () => {
    // Rank by how much structure a type carries: nothing may contain a type
    // ranked at or above itself (no section inside a section, no chapter
    // inside a section, …).
    const rank: Partial<Record<DivisionType, number>> = {
      book: 6,
      article: 6,
      slideshow: 6,
      part: 5,
      // Front and back matter sit at the part level: they are a book's direct
      // children, and backmatter holds appendices.
      frontmatter: 5,
      backmatter: 5,
      chapter: 4,
      // An appendix divides like a chapter, so it ranks with one.
      appendix: 4,
      section: 3,
      subsection: 2,
      subsubsection: 1,
    };
    for (const parent of ALL_DIVISION_TYPES) {
      const parentRank = rank[parent] ?? 0;
      for (const child of ALLOWED_CHILD_DIVISION_TYPES[parent]) {
        const childRank = rank[child] ?? 0;
        expect(
          childRank < parentRank || childRank === 0,
          `${child} should not be offered inside ${parent}`,
        ).toBe(true);
      }
    }
  });

  it("never offers paragraphs as a choice", () => {
    // A lightweight block division, not something to create from the TOC —
    // though an existing one still shows its own type.
    for (const parent of ALL_DIVISION_TYPES) {
      expect(ALLOWED_CHILD_DIVISION_TYPES[parent], parent).not.toContain(
        "paragraphs",
      );
    }
    expect(getSelectableDivisionTypes(null, "section")).not.toContain(
      "paragraphs",
    );
    expect(getSelectableDivisionTypes("section", "paragraphs")[0]).toBe(
      "paragraphs",
    );
  });

  it("never offers introduction or conclusion as a choice", () => {
    // Both are positionally constrained (first/last within their parent), so
    // they're created deliberately, never picked from the Type dropdown.
    for (const parent of ALL_DIVISION_TYPES) {
      expect(ALLOWED_CHILD_DIVISION_TYPES[parent]).not.toContain(
        "introduction",
      );
      expect(ALLOWED_CHILD_DIVISION_TYPES[parent]).not.toContain("conclusion");
    }
  });
});

describe("getSelectableDivisionTypes", () => {
  it("restricts a book's children to chapters and parts", () => {
    expect(getSelectableDivisionTypes("book", "chapter")).toEqual([
      "chapter",
      "part",
    ]);
  });

  it("keeps part/chapter out of an article's children", () => {
    const types = getSelectableDivisionTypes("article", "section");
    expect(types).toContain("section");
    expect(types).not.toContain("part");
    expect(types).not.toContain("chapter");
    expect(types).not.toContain("subsection");
  });

  it("offers one level down from each structural type", () => {
    expect(getSelectableDivisionTypes("part", "chapter")).toEqual(["chapter"]);
    expect(getSelectableDivisionTypes("chapter", "section")[0]).toBe("section");
    expect(getSelectableDivisionTypes("section", "subsection")[0]).toBe(
      "subsection",
    );
    expect(getSelectableDivisionTypes("subsection", "subsubsection")[0]).toBe(
      "subsubsection",
    );
    expect(getSelectableDivisionTypes("subsubsection", "worksheet")).not.toContain(
      "subsubsection",
    );
  });

  it("offers nothing but the division's own type under a leaf parent", () => {
    // An <exercises> holds exercises, not divisions — there is no valid type
    // for a child of one, so the only option is the type it already has.
    expect(getSelectableDivisionTypes("exercises", "section")).toEqual([
      "section",
    ]);
  });

  it("always includes the division's current type, even where it isn't allowed", () => {
    // An <introduction> is never *offered*, but opening its properties must
    // show it as an introduction — the dropdown is what Save persists, so a
    // missing option would silently rewrite the division's type.
    const types = getSelectableDivisionTypes("chapter", "introduction");
    expect(types[0]).toBe("introduction");
    expect(types).toContain("section");
  });

  it("does not duplicate the current type when it is already allowed", () => {
    const types = getSelectableDivisionTypes("chapter", "worksheet");
    expect(types.filter((t) => t === "worksheet")).toHaveLength(1);
  });

  it("falls back to every regular type only when there is no parent at all", () => {
    const types = getSelectableDivisionTypes(null, "section");
    expect(types).toContain("chapter");
    expect(types).toContain("section");
  });
});

describe("defaultChildDivisionType", () => {
  it("picks a type the parent actually allows", () => {
    expect(defaultChildDivisionType("book")).toBe("chapter");
    expect(defaultChildDivisionType("part")).toBe("chapter");
    expect(defaultChildDivisionType("article")).toBe("section");
    expect(defaultChildDivisionType("chapter")).toBe("section");
    expect(defaultChildDivisionType("section")).toBe("subsection");
    expect(defaultChildDivisionType("subsection")).toBe("subsubsection");
  });

  it("is always itself a selectable type for that parent", () => {
    for (const parent of ALL_DIVISION_TYPES) {
      if (!canContainDivisions(parent)) continue;
      expect(
        getSelectableDivisionTypes(parent, null),
        parent,
      ).toContain(defaultChildDivisionType(parent));
    }
  });

  it("falls back to section with no parent", () => {
    expect(defaultChildDivisionType(null)).toBe("section");
  });
});

// A division's type is derived from its source, not stored by the host, so a
// record can reach the TOC with no type at all (LaTeX divisions never have
// one) or with a tag outside DivisionType. None of these lookups may throw,
// and none may pretend to know a rule they don't have.
describe("types the editor doesn't know", () => {
  // A real PreTeXt element that is not a division the editor models. It used
  // to be `appendix`, until imports started producing those — see
  // `importDivisionTags.test.ts`.
  const unknown = "titlepage" as DivisionType;

  it("treats a missing or unknown parent type as unrestricted", () => {
    for (const parent of [undefined, null, unknown]) {
      const types = getSelectableDivisionTypes(parent, "section");
      expect(types, String(parent)).toContain("section");
      expect(types, String(parent)).toContain("chapter");
    }
  });

  it("allows nesting under a division whose type is unknown", () => {
    expect(canContainDivisions(undefined)).toBe(true);
    expect(canContainDivisions(null)).toBe(true);
    expect(canContainDivisions(unknown)).toBe(true);
  });

  it("falls back to section as the default child type", () => {
    expect(defaultChildDivisionType(undefined)).toBe("section");
    expect(defaultChildDivisionType(unknown)).toBe("section");
  });

  it("tolerates a missing current type", () => {
    expect(getSelectableDivisionTypes("chapter", undefined)).toEqual(
      ALLOWED_CHILD_DIVISION_TYPES.chapter,
    );
  });
});

describe("canContainDivisions", () => {
  it("is true for structural types and false for leaf ones", () => {
    for (const type of ["book", "article", "part", "chapter", "section"] as const) {
      expect(canContainDivisions(type), type).toBe(true);
    }
    for (const type of [
      "exercises",
      "references",
      "glossary",
      "solutions",
      "reading-questions",
      "paragraphs",
      "worksheet",
      "handout",
      "introduction",
      "conclusion",
    ] as const) {
      expect(canContainDivisions(type), type).toBe(false);
    }
  });
});
