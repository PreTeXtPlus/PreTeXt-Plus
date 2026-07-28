import {
  PRETEXT_LATEX_LANGUAGE_ID,
  pretextLatexLanguage,
} from "@pretextbook/latex-style-pretext";
import { registerLatexSyntax } from "./latexSyntax";
import { registerFlavorLanguage } from "./flavorLanguage";
import type { FormatEditorConfig } from "./types";

export const latexConfig: FormatEditorConfig = {
  // Not Monaco's `latex` — there is no such built-in language, and an
  // unregistered id resolves to plain text (killing completions with it).
  // `registerLatexSyntax` registers this one; the model picks the language up
  // as soon as it does.
  language: PRETEXT_LATEX_LANGUAGE_ID,
  registerMonacoExtensions: (monaco, editor) => {
    const syntax = registerLatexSyntax(monaco);
    const language = registerFlavorLanguage(monaco, editor, {
      flavor: pretextLatexLanguage,
      monacoLanguageId: PRETEXT_LATEX_LANGUAGE_ID,
      // `\` opens a macro, `{` an environment name after \begin/\end, `[` a
      // \hyperref target.
      triggerCharacters: ["\\", "{", "["],
    });

    return {
      dispose: () => {
        language.dispose();
        syntax.dispose();
      },
    };
  },
};
