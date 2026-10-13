import { getPretextCompletions } from "@pretextbook/completions";

/** The LSP-shaped values the completer returns, derived so this module needs
 * no direct dependency on `vscode-languageserver-types`. */
type CompletionItem = NonNullable<
  Awaited<ReturnType<typeof getPretextCompletions>>
>[number];
type TextEdit = Extract<
  NonNullable<CompletionItem["textEdit"]>,
  { range: unknown }
>;

const mapCompletionKind = (kind: number | undefined, monaco: any) => {
  switch (kind) {
    case 17:
      return monaco.languages.CompletionItemKind.File;
    case 18:
      return monaco.languages.CompletionItemKind.Reference;
    case 25:
      return monaco.languages.CompletionItemKind.TypeParameter;
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
};

const getLabelText = (label: CompletionItem["label"]): string => {
  if (typeof label === "string") return label;
  if (label && typeof label === "object" && "label" in label) {
    return String((label as { label: unknown }).label);
  }
  return String(label);
};

const isTextEdit = (edit: CompletionItem["textEdit"]): edit is TextEdit => {
  return !!edit && "range" in edit;
};

const isInsideOpenTag = (text: string, lineNumber: number, column: number) => {
  const lineText = text.split("\n")[lineNumber - 1] ?? "";
  const prefix = lineText.slice(0, Math.max(column - 1, 0));
  const lastOpen = prefix.lastIndexOf("<");
  const lastClose = prefix.lastIndexOf(">");
  return lastOpen > lastClose;
};

export const registerCodeEditorCompletions = (monaco: any) => {
  return monaco.languages.registerCompletionItemProvider("xml", {
    triggerCharacters: ["<", "@"],
    provideCompletionItems: async (model: any, position: any, context: any) => {
      const text = model.getValue();

      // Only trigger attribute completions when typing @ inside an open tag.
      const insideOpenTag = isInsideOpenTag(text, position.lineNumber, position.column);
      if (context?.triggerCharacter === "@" && !insideOpenTag) {
        return { suggestions: [] };
      }

      const items = await getPretextCompletions({
        text,
        position: {
          line: position.lineNumber - 1,
          character: position.column - 1,
        },
      });

      if (!items?.length) {
        return { suggestions: [] };
      }

      const suggestions = items.map((item) => {
        const label = getLabelText(item.label);
        const editRange = isTextEdit(item.textEdit)
          ? item.textEdit.range
          : item.textEdit?.insert;
        // `<` isn't auto-closed (see `pretextLanguageConfig.ts`), so a `>`
        // after the caret belongs to a real start tag, and the completions
        // edit just that tag's name.
        const range = editRange
          ? new monaco.Range(
              editRange.start.line + 1,
              editRange.start.character + 1,
              editRange.end.line + 1,
              editRange.end.character + 1,
            )
          : undefined;
        const insertText = item.textEdit?.newText ?? item.insertText ?? label;

        return {
          label,
          kind: mapCompletionKind(item.kind, monaco),
          detail: item.detail,
          documentation: item.documentation,
          insertText,
          insertTextRules:
            item.insertTextFormat === 2
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
          range,
          sortText: item.sortText,
        };
      });

      return { suggestions };
    },
  });
};
