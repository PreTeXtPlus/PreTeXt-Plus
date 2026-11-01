import {
  PRETEXT_MARKDOWN_LANGUAGE_ID,
  pretextMarkdownLanguage,
} from "@pretextbook/markdown-style-pretext";
import type { PretextFlavorLanguage } from "@pretextbook/latex-style-pretext";
import { maskProseDollars } from "./markdownDollars";
import { registerMarkdownSyntax } from "./markdownSyntax";
import { registerFlavorLanguage } from "./flavorLanguage";
import { registerConfiguredSpellCheck } from "./spellcheck";
import type { FormatEditorConfig } from "./types";

/**
 * The language core, reading the `$` the way the converter does. Blanking keeps
 * every offset, so what comes back fits the buffer as it stands. The newline is
 * for a cursor at the very end of the buffer: the core reads open math as ending
 * just before it, and with `$` not auto-closed that is where math gets typed.
 */
export const markdownFlavor: PretextFlavorLanguage = {
  ...pretextMarkdownLanguage,
  getCompletions: ({ text, offset, ...rest }) =>
    pretextMarkdownLanguage.getCompletions({
      text: `${maskProseDollars(text, offset)}\n`,
      offset,
      ...rest,
    }),
  getDiagnostics: (text) =>
    pretextMarkdownLanguage.getDiagnostics(maskProseDollars(text)),
};

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
      flavor: markdownFlavor,
      monacoLanguageId: PRETEXT_MARKDOWN_LANGUAGE_ID,
      // `:` opens a directive, `#` a cross-reference target, `\` a math macro,
      // `{` a directive's `{#id}` modifier.  All four are ordinary prose
      // characters, so the core re-checks the cursor context and returns
      // nothing unless the position is genuinely directive-plausible.
      triggerCharacters: [":", "#", "\\", "{"],
    });
    // Spelling reads the same scopes the PreTeXt editor does; what changes is
    // how prose is told apart from markup (see `spellcheck/markdownRegions.ts`).
    const spelling = registerConfiguredSpellCheck(
      monaco,
      editor,
      PRETEXT_MARKDOWN_LANGUAGE_ID,
      "markdown",
    );

    return {
      dispose: () => {
        spelling?.dispose();
        language.dispose();
        syntax.dispose();
      },
    };
  },
};
