import { describe, it, expect } from "vitest";
import { describeFix, findLatexFixes } from "@pretextbook/latex-style-pretext";
import {
  countFixable,
  countFlagged,
  summarizeCleanFixes,
} from "../cleanFindings";

/**
 * These run the real rule table rather than hand-built fixtures: the point of
 * the rollup is to be a faithful view of what the engine reports, so a change
 * in the engine that the summary can't represent should fail here.
 */
const summarize = (latex: string) =>
  summarizeCleanFixes(findLatexFixes(latex), describeFix);

describe("summarizeCleanFixes", () => {
  it("collapses repeated occurrences of one rule into a single row", () => {
    const findings = summarize(
      "Some text \\hspace{1cm} more \\hspace{2cm} and \\hspace{3cm} end.",
    );

    const hspace = findings.find((f) => f.ruleId === "hspace");
    expect(hspace).toBeDefined();
    expect(hspace?.count).toBe(3);
    expect(hspace?.fixable).toBe(true);
    expect(hspace?.description).toBeTruthy();
  });

  it("marks a flag-only finding as needing a human", () => {
    const findings = summarize("This is \\textbf{important} text.");

    const textbf = findings.find((f) => f.ruleId === "textbf");
    expect(textbf).toBeDefined();
    // The engine deliberately offers no replacement: only the author knows
    // whether the bold stood for <em>, <term>, or <alert>.
    expect(textbf?.fixable).toBe(false);
    expect(countFixable(findings)).toBe(0);
    expect(countFlagged(findings)).toBe(1);
  });

  it("counts fixable and flagged occurrences separately", () => {
    const findings = summarize(
      "\\hspace{1cm} and \\hspace{2cm} around \\textbf{bold}.",
    );

    expect(countFixable(findings)).toBe(2);
    expect(countFlagged(findings)).toBe(1);
  });

  it("orders rows by severity, then by how often the rule fired", () => {
    const findings = summarize(
      [
        "\\def\\foo{bar}", // warning
        "\\hspace{1cm}",
        "\\hspace{2cm}", // info, twice
        "\\date{today}", // info, once
      ].join("\n"),
    );

    const severities = findings.map((f) => f.severity);
    const firstInfo = severities.indexOf("info");
    expect(severities.indexOf("warning")).toBeLessThan(firstInfo);

    const infoRows = findings.filter((f) => f.severity === "info");
    for (let i = 1; i < infoRows.length; i += 1) {
      expect(infoRows[i - 1].count).toBeGreaterThanOrEqual(infoRows[i].count);
    }
  });

  it("keeps the matched text for rules the author needs to see verbatim", () => {
    // `\def` is deleted, but the author has to see what was in it to
    // reconstruct the intent — the engine marks those with `reportMatch`.
    const findings = summarize("\\def\\ds{\\displaystyle}\nbody text");

    const def = findings.find((f) => f.examples.length > 0);
    expect(def).toBeDefined();
    expect(def?.examples[0]).toContain("\\def");
  });

  it("caps the examples it keeps, however many times the rule fires", () => {
    const findings = summarize(
      Array.from({ length: 8 }, (_, i) => `\\def\\m${i}{x}`).join("\n"),
    );

    const def = findings.find((f) => f.examples.length > 0);
    expect(def?.count).toBe(8);
    expect(def?.examples.length).toBeLessThanOrEqual(3);
  });

  it("reports nothing for source that is already clean", () => {
    const findings = summarize("Plain prose with \\emph{emphasis} and math $x$.");

    expect(findings).toEqual([]);
    expect(countFixable(findings)).toBe(0);
  });
});
