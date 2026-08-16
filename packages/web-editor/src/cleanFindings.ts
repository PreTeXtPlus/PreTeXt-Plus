/**
 * Rolls the source-cleanup engine's positioned fixes up into one row per rule.
 *
 * `@pretextbook/latex-style-pretext` reports every occurrence separately, which
 * is what the squiggles and the per-occurrence quick fixes need. A human
 * reading a summary wants the other view: "`\vspace` — 14 occurrences, removed
 * on import", once. This module is that projection, and nothing else — it is
 * deliberately free of Monaco and of React so both the editor's review dialog
 * and the LaTeX import dialog can share it.
 */

import type { LatexFix } from "@pretextbook/latex-style-pretext";

/**
 * One positioned cleanup finding.
 *
 * This is the engine's own `LatexFix`, not the `CleanFix` mirror declared on
 * `PretextFlavorLanguage`. The mirror exists to keep that interface free of a
 * dependency on the rule tables, and pays for it by widening `kind` to
 * `string` — which makes it unassignable to the package's own `describeFix`.
 * Since every cleanup path here is LaTeX's, we take the precise type and get
 * the description function with it.
 */
export type CleanFix = LatexFix;

/** One rule's findings, collapsed. */
export interface CleanFinding {
  /** The rule that produced these findings. */
  ruleId: string;
  /** Macro or environment name, for display. */
  macro: string;
  /** Why the rule exists (`presentation`, `archaic`, …). */
  kind: string;
  category: string;
  severity: CleanFix["severity"];
  action: CleanFix["action"];
  /** How many times the rule matched. */
  count: number;
  /**
   * False for `flag` findings, which carry no replacement on purpose: only the
   * author knows whether a `\textbf` meant `<em>`, `<term>`, or `<alert>`, so
   * the engine reports them and changes nothing.
   */
  fixable: boolean;
  /** The sentence shown to the author. */
  description: string;
  /**
   * A few matched snippets, for rules whose text the author needs to see to
   * reconstruct what was there (the engine marks these with `reportMatch`).
   */
  examples: string[];
}

/** Most urgent first. */
const SEVERITY_ORDER: Record<CleanFix["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** Enough to recognize the pattern; more would bury the rest of the list. */
const MAX_EXAMPLES = 3;

/**
 * Group `fixes` by rule, in a stable order: most severe first, then the rules
 * that fire most often.
 *
 * `describeFix` comes from the flavor rather than being built here — the
 * wording is the language package's business (it knows which PreTeXt elements
 * to suggest in place of a flagged font macro).
 */
export function summarizeCleanFixes(
  fixes: CleanFix[],
  describeFix: (fix: CleanFix) => string,
): CleanFinding[] {
  const byRule = new Map<string, CleanFinding>();

  for (const fix of fixes) {
    const existing = byRule.get(fix.ruleId);
    if (existing) {
      existing.count += 1;
      if (fix.reportMatch && existing.examples.length < MAX_EXAMPLES) {
        existing.examples.push(fix.matched);
      }
      continue;
    }
    byRule.set(fix.ruleId, {
      ruleId: fix.ruleId,
      macro: fix.macro,
      kind: fix.kind,
      category: fix.category,
      severity: fix.severity,
      action: fix.action,
      count: 1,
      fixable: fix.replacement !== undefined,
      description: describeFix(fix),
      examples: fix.reportMatch ? [fix.matched] : [],
    });
  }

  return [...byRule.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.count - a.count ||
      a.macro.localeCompare(b.macro),
  );
}

/** How many individual occurrences an "apply everything" run would change. */
export function countFixable(findings: CleanFinding[]): number {
  return findings.reduce(
    (total, finding) => total + (finding.fixable ? finding.count : 0),
    0,
  );
}

/** How many findings only a human can resolve. */
export function countFlagged(findings: CleanFinding[]): number {
  return findings.reduce(
    (total, finding) => total + (finding.fixable ? 0 : finding.count),
    0,
  );
}
