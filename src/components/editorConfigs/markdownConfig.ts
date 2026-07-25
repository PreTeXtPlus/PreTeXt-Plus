import {
  PRETEXT_MARKDOWN_LANGUAGE_ID,
  pretextMarkdownLanguage,
} from "@pretextbook/markdown-style-pretext";
import { registerMarkdownSyntax } from "./markdownSyntax";
import { registerFlavorLanguage } from "./flavorLanguage";
import type { FormatEditorConfig } from "./types";

export const markdownConfig: FormatEditorConfig = {
  // Same id the local Monarch grammar registers below; the language core
  // publishes it as a constant so both ends stay in step.
  language: PRETEXT_MARKDOWN_LANGUAGE_ID,
  registerMonacoExtensions: (monaco, editor) => {
    // Highlighting stays local — `markdownSyntax` is a richer grammar than the
    // one the language package's own demo ships — while completions and lint
    // come from the shared core.
    const syntax = registerMarkdownSyntax(monaco);
    const language = registerFlavorLanguage(monaco, editor, {
      flavor: pretextMarkdownLanguage,
      monacoLanguageId: PRETEXT_MARKDOWN_LANGUAGE_ID,
      // `:` opens a directive, `#` a cross-reference target, `\` a math macro,
      // `{` a directive's `{#id}` modifier.  All four are ordinary prose
      // characters, so the core re-checks the cursor context and returns
      // nothing unless the position is genuinely directive-plausible.
      triggerCharacters: [":", "#", "\\", "{"],
    });

    return {
      dispose: () => {
        language.dispose();
        syntax.dispose();
      },
    };
  },
};
