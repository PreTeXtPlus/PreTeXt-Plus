import { describe, it, expect } from "vitest";
import { findInProject, applyReplacements } from "../components/projectFind";
import type { Division } from "../types/sections";

const division = (xmlId: string, source: string): Division => ({
  xmlId,
  title: xmlId,
  type: "section",
  sourceFormat: "pretext",
  source,
});

describe("findInProject", () => {
  it("returns no matches for an empty query", () => {
    const divisions = [division("intro", "<section><p>hello</p></section>")];
    expect(findInProject(divisions, "")).toEqual([]);
  });

  it("finds every literal occurrence across all divisions", () => {
    const divisions = [
      division("intro", "<p>the cat sat</p>"),
      division("conclusion", "<p>a cat and another cat</p>"),
    ];
    const matches = findInProject(divisions, "cat");
    expect(matches).toHaveLength(3);
    expect(matches.filter((m) => m.divisionId === "intro")).toHaveLength(1);
    expect(matches.filter((m) => m.divisionId === "conclusion")).toHaveLength(2);
  });

  it("is case-insensitive by default and case-sensitive when matchCase is set", () => {
    const divisions = [division("intro", "Cat cat CAT")];
    expect(findInProject(divisions, "cat")).toHaveLength(3);
    expect(findInProject(divisions, "cat", { matchCase: true })).toHaveLength(1);
  });

  it("honors wholeWord to exclude substring hits", () => {
    const divisions = [division("intro", "cat catalog concatenate")];
    expect(findInProject(divisions, "cat")).toHaveLength(3);
    expect(findInProject(divisions, "cat", { wholeWord: true })).toHaveLength(1);
  });

  it("escapes literal queries so regex metacharacters match literally", () => {
    const divisions = [division("intro", "<m>a+b</m> and a?b")];
    expect(findInProject(divisions, "a+b")).toHaveLength(1);
  });

  it("treats the query as a regex when useRegex is set", () => {
    const divisions = [division("intro", "cat1 cat2 dog3")];
    const matches = findInProject(divisions, "cat\\d", { useRegex: true });
    expect(matches.map((m) => m.matchedText)).toEqual(["cat1", "cat2"]);
  });

  it("returns no matches (rather than throwing) for an unterminated regex", () => {
    const divisions = [division("intro", "a(b")];
    expect(findInProject(divisions, "a(", { useRegex: true })).toEqual([]);
  });

  it("computes 1-based line/column ranges", () => {
    const divisions = [division("intro", "line one\nline two target\nline three")];
    const [match] = findInProject(divisions, "target");
    expect(match.range).toEqual({
      startLine: 2,
      startCol: 10,
      endLine: 2,
      endCol: 16,
    });
  });

  it("does not loop forever on a pattern that can match empty", () => {
    const divisions = [division("intro", "abc")];
    expect(() => findInProject(divisions, "x*", { useRegex: true })).not.toThrow();
  });
});

describe("applyReplacements", () => {
  it("replaces a single match", () => {
    const source = "<p>the cat sat</p>";
    const [match] = findInProject([division("intro", source)], "cat");
    expect(applyReplacements(source, [match], "dog")).toBe("<p>the dog sat</p>");
  });

  it("replaces multiple matches without offsets shifting into each other", () => {
    const source = "cat cat cat";
    const matches = findInProject([division("intro", source)], "cat");
    expect(applyReplacements(source, matches, "dog")).toBe("dog dog dog");
  });

  it("replaces with a different-length string correctly at every offset", () => {
    const source = "a cat, a cat, a cat";
    const matches = findInProject([division("intro", source)], "cat");
    expect(applyReplacements(source, matches, "elephant")).toBe(
      "a elephant, a elephant, a elephant",
    );
  });
});
