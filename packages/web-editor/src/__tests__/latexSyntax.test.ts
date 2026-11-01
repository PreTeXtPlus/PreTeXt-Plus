/**
 * The Monarch grammar behind LaTeX-style divisions and TikZ source. Monaco
 * throws on a rule with several actions whose groups leave any of the match
 * uncaptured, and the line it was tokenizing goes unhighlighted.
 */
import { describe, it, expect } from "vitest";
import { registerLatexSyntax } from "../components/editorConfigs/latexSyntax";

type Rule = [RegExp, string | string[]];

function rulesOf(language?: Parameters<typeof registerLatexSyntax>[1]) {
  let rules: Rule[] = [];
  const monaco = {
    languages: {
      register: () => {},
      setLanguageConfiguration: () => {},
      setMonarchTokensProvider: (_id: string, provider: { tokenizer: { root: Rule[] } }) => {
        rules = provider.tokenizer.root;
      },
    },
  };
  registerLatexSyntax(monaco, language);
  return rules;
}

describe("the LaTeX grammar", () => {
  it("captures all of a match in a rule with an action per group", () => {
    const line = "\\begin{tikzpicture}[scale=2]";
    const grouped = rulesOf().filter(([, action]) => Array.isArray(action));
    expect(grouped.length).toBeGreaterThan(0);
    for (const [regex, action] of grouped) {
      const match = regex.exec(line);
      expect(match).not.toBeNull();
      expect(match!.slice(1)).toHaveLength((action as string[]).length);
      expect(match!.slice(1).join("")).toBe(match![0]);
    }
  });

  it("registers under the language it is given", () => {
    const registered: unknown[] = [];
    const monaco = {
      languages: {
        register: (language: unknown) => registered.push(language),
        setLanguageConfiguration: () => {},
        setMonarchTokensProvider: () => {},
      },
    };
    const tex = { id: "tex", extensions: [".tex"], aliases: ["TeX"] };
    registerLatexSyntax(monaco, tex);
    expect(registered).toEqual([tex]);
  });
});
