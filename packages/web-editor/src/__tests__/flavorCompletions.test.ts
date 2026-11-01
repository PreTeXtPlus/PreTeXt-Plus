import { describe, expect, it } from "vitest";
import { pretextLatexLanguage } from "@pretextbook/latex-style-pretext";
import { pretextMarkdownLanguage } from "@pretextbook/markdown-style-pretext";
import { registerFlavorLanguage } from "../components/editorConfigs/flavorLanguage";
import { latexFlavor } from "../components/editorConfigs/latexConfig";

/**
 * The LSP→Monaco side of completions, driven by the real language cores: what a
 * core returns only reaches the author if the adapter carries it across.
 */

const SNIPPET_RULE = 4;

class FakeRange {
  constructor(
    public startLineNumber: number,
    public startColumn: number,
    public endLineNumber: number,
    public endColumn: number,
  ) {}
}

/** The suggestions a flavor offers at the `|` in `fixture`. */
const suggestionsAt = (
  flavor: typeof pretextLatexLanguage,
  fixture: string,
): any[] => {
  let provider: any;
  const monaco = {
    Range: FakeRange,
    languages: {
      CompletionItemKind: {},
      CompletionItemInsertTextRule: { InsertAsSnippet: SNIPPET_RULE },
      registerCompletionItemProvider: (_language: string, given: any) => {
        provider = given;
        return { dispose: () => {} };
      },
    },
  };
  registerFlavorLanguage(monaco, null, {
    flavor,
    monacoLanguageId: "test",
    triggerCharacters: [],
  });

  const offset = fixture.indexOf("|");
  const text = fixture.replace("|", "");
  const model = {
    getValue: () => text,
    getOffsetAt: () => offset,
  };
  return provider.provideCompletionItems(model, null, {}).suggestions;
};

const byLabel = (suggestions: any[], label: string) =>
  suggestions.find((suggestion) => suggestion.label === label);

describe("flavor completions in Monaco", () => {
  it("matches \\begin{...} on the macro name, not its label", () => {
    const begin = byLabel(
      suggestionsAt(pretextLatexLanguage, "\\beg|"),
      "\\begin{...}",
    );
    expect(begin.filterText).toBe("begin");
    expect(begin.insertText).toBe("begin{$1}\n\t$0\n\\end{$1}");
    expect(begin.insertTextRules).toBe(SNIPPET_RULE);
  });

  it("opens the environment names once \\begin{...} is in", () => {
    const begin = byLabel(
      suggestionsAt(pretextLatexLanguage, "\\|"),
      "\\begin{...}",
    );
    expect(begin.command).toEqual({
      id: "editor.action.triggerSuggest",
      title: "Suggest",
      arguments: undefined,
    });
  });

  it("moves to the body once a name is picked in the skeleton", () => {
    const theorem = byLabel(
      suggestionsAt(pretextLatexLanguage, "\\begin{theo|}\n\t\n\\end{theo}\n"),
      "theorem",
    );
    expect(theorem.insertText).toBe("theorem");
    expect(theorem.insertTextRules).toBeUndefined();
    expect(theorem.command?.id).toBe("jumpToNextSnippetPlaceholder");
  });

  it.each([
    ["at the end of a row", "a & b \\\\|"],
    ["before more text", "a \\\\|\nb"],
    ["with a word after it", "a \\\\foo|"],
  ])("offers no macros after a line break %s", (_where, fixture) => {
    expect(suggestionsAt(latexFlavor, fixture)).toEqual([]);
  });

  it("still offers macros after a line break and a new backslash", () => {
    const labels = suggestionsAt(latexFlavor, "\\\\\\|").map((s) => s.label);
    expect(labels).toContain("\\begin{...}");
  });

  it("offers math macros in open math at the very end of the buffer", () => {
    const labels = suggestionsAt(latexFlavor, "Let $\\fra|").map((s) => s.label);
    expect(labels).toContain("frac");
  });

  it("leaves both unset on an item that has neither", () => {
    const target = byLabel(
      suggestionsAt(
        pretextMarkdownLanguage,
        "## Intro {#sec-intro}\n\nSee [](#sec|",
      ),
      "sec-intro",
    );
    expect(target.filterText).toBeUndefined();
    expect(target.command).toBeUndefined();
  });
});
