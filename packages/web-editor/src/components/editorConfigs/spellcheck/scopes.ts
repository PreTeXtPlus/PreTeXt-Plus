/**
 * Which PreTeXt constructs the spell checker looks inside.
 *
 * These seven scopes — their names, their `"Check" | "Ignore"` vocabulary and
 * their defaults — deliberately mirror `pretext-tools.spellCheck.
 * checkErrorsInsideScope` in the PreTeXt VS Code extension, so an author moving
 * between the two tools gets the same behaviour and the same words flagged.
 * The *implementations* have nothing in common: the VS Code extension feeds
 * regexes to the Code Spell Checker extension's `ignoreRegExpList` (its only
 * lever, since cSpell has no PreTeXt grammar), while here we resolve scopes
 * against a real parse of the source.  Keep the vocabulary in step; do not port
 * the regexes.
 */
export type SpellCheckScopeSetting = "Check" | "Ignore";

export interface SpellCheckScope {
  /** `<!-- ... -->` */
  comments: SpellCheckScopeSetting;
  /** `<m>` */
  inlineMath: SpellCheckScopeSetting;
  /** `<me>`, `<men>`, `<md>`, `<mdn>` */
  displayMath: SpellCheckScopeSetting;
  /** `<c>` */
  inlineCode: SpellCheckScopeSetting;
  /** `<program>`, `<sage>`, `<pre>` */
  blockCode: SpellCheckScopeSetting;
  /** `<latex-image>` */
  latexImage: SpellCheckScopeSetting;
  /** Tag names, attribute names and attribute values. */
  tags: SpellCheckScopeSetting;
}

/**
 * Matches the VS Code extension's shipped defaults: prose and comments are
 * checked, everything machine-readable is not.
 */
export const DEFAULT_SPELL_CHECK_SCOPES: SpellCheckScope = {
  comments: "Check",
  inlineMath: "Ignore",
  displayMath: "Ignore",
  inlineCode: "Ignore",
  blockCode: "Ignore",
  latexImage: "Ignore",
  tags: "Ignore",
};

/**
 * The elements each element-shaped scope covers.  Everything between such an
 * element's start and end tag is suppressed when its scope is `"Ignore"`,
 * nested content included.
 *
 * These lists match the element sets the VS Code extension's ignore patterns
 * target.  `<pre>` sits under `blockCode` there and does the same here, even
 * though PreTeXt also allows it outside a code context.
 */
export const SCOPE_ELEMENTS: Record<
  "inlineMath" | "displayMath" | "inlineCode" | "blockCode" | "latexImage",
  readonly string[]
> = {
  inlineMath: ["m"],
  displayMath: ["me", "men", "md", "mdn"],
  inlineCode: ["c"],
  blockCode: ["program", "sage", "pre"],
  latexImage: ["latex-image"],
};

/**
 * Flattens the scope settings into the set of element names whose contents must
 * not be checked, so the scanner can answer "is this element suppressing?" with
 * a single lookup.
 */
export const suppressedElements = (scopes: SpellCheckScope): Set<string> => {
  const suppressed = new Set<string>();
  for (const [scope, elements] of Object.entries(SCOPE_ELEMENTS)) {
    if (scopes[scope as keyof typeof SCOPE_ELEMENTS] === "Ignore") {
      for (const element of elements) suppressed.add(element);
    }
  }
  return suppressed;
};
