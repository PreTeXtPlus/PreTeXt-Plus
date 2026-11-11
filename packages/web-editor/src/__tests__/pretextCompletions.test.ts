import { describe, expect, it } from "vitest";
import { registerCodeEditorCompletions } from "../components/editorConfigs/pretextCompletions";

/**
 * A division's buffer holds only its body: the start tag and title are drawn
 * around it (`virtualWrapper`). The completer has to see them to know which
 * element the caret is in.
 */

class FakeRange {
  constructor(
    public startLineNumber: number,
    public startColumn: number,
    public endLineNumber: number,
    public endColumn: number,
  ) {}
}

/** The suggestions offered at the `|` in `fixture`, below `wrapperBefore`. */
const suggestionsAt = async (
  fixture: string,
  wrapperBefore: string[],
  { ownModel = true } = {},
): Promise<any[]> => {
  let provider: any;
  const monaco = {
    Range: FakeRange,
    languages: {
      CompletionItemKind: { Text: 0, File: 1, Reference: 2, TypeParameter: 3 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      registerCompletionItemProvider: (_language: string, given: any) => {
        provider = given;
        return { dispose: () => {} };
      },
    },
  };
  const text = fixture.replace("|", "");
  const model = { getValue: () => text };
  const editor = { getModel: () => (ownModel ? model : {}) };
  registerCodeEditorCompletions(monaco, editor, {
    getWrapperBefore: () => wrapperBefore,
  });

  const lines = fixture.slice(0, fixture.indexOf("|")).split("\n");
  const position = {
    lineNumber: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
  const result = await provider.provideCompletionItems(model, position, {});
  return result.suggestions;
};

const labels = (suggestions: any[]) => suggestions.map((s) => s.label);

const WORKSHEET = ['<worksheet xml:id="ws" label="ws">', "<title>Practice</title>"];

describe("PreTeXt completions inside a wrapped division", () => {
  it("offers <page> in a worksheet's body, whose start tag is only in the wrapper", async () => {
    const suggestions = await suggestionsAt("<p>Warm up.</p>\n|", WORKSHEET);
    expect(labels(suggestions)).toContain("<page>");
    expect(labels(suggestions)).toContain("</worksheet");
  });

  it("offers no <page> in a section's body", async () => {
    const suggestions = await suggestionsAt("|", [
      '<section xml:id="s" label="s">',
      "<title>Intro</title>",
    ]);
    expect(labels(suggestions)).not.toContain("<page>");
    expect(labels(suggestions)).toContain("</section");
  });

  it("maps edit ranges back onto the buffer's own lines", async () => {
    const suggestions = await suggestionsAt("<p>Warm up.</p>\n  <|", WORKSHEET);
    const page = suggestions.find((s) => s.label === "<page>");
    expect(page.range).toEqual(new FakeRange(2, 3, 2, 4));
  });

  it("still sees elements opened in the buffer itself", async () => {
    const suggestions = await suggestionsAt("<page>\n  |", WORKSHEET);
    expect(labels(suggestions)).toContain("</page");
  });

  it("answers only for its own editor's model", async () => {
    const suggestions = await suggestionsAt("|", WORKSHEET, { ownModel: false });
    expect(suggestions).toEqual([]);
  });
});
