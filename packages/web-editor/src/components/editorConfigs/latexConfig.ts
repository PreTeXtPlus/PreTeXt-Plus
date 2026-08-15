import {
  describeFix,
  findLatexFixes,
  getLatexCleanDiagnostics,
  PRETEXT_LATEX_LANGUAGE_ID,
  pretextLatexLanguage,
} from "@pretextbook/latex-style-pretext";
import { registerLatexSyntax } from "./latexSyntax";
import { registerFlavorLanguage } from "./flavorLanguage";
import { applyCleanFixes, editableRangeFor } from "./latexClean";
import type { CleanSupport, FormatEditorConfig } from "./types";

/**
 * Source-cleanup engine for LaTeX-style PreTeXt: legacy markup that converts
 * badly or shouldn't survive into PreTeXt at all (`\vspace`, `{\bf …}`,
 * `\textbf` and friends).
 *
 * Every call omits the scope option, leaving the core's `"auto"` default: it
 * looks for `\begin{document}` and treats the text as a whole document if it
 * finds one, a body fragment if not.  A division buffer is the latter, so only
 * body rules fire — which is what we want, since a division has no preamble of
 * its own (that lives in the docinfo, edited from "Edit Preamble").
 *
 * Code actions come off the flavor interface, which declares them (optional,
 * since a flavor with no legacy dialect behind it omits them). The fixes come
 * from `findLatexFixes` directly rather than through the interface's
 * `getCleanFixes`, whose return type is a deliberately widened mirror that the
 * package's own `describeFix` will not accept — see `cleanFindings.ts`.
 */
const latexCleanSupport: CleanSupport = {
  getDiagnostics: (text) => getLatexCleanDiagnostics(text),
  getFixes: (text) => findLatexFixes(text),
  getCodeActions: (text, range, uri) =>
    pretextLatexLanguage.getCleanCodeActions?.(text, range, uri) ?? [],
  describeFix,
};

export const latexConfig: FormatEditorConfig = {
  // Not Monaco's `latex` — there is no such built-in language, and an
  // unregistered id resolves to plain text (killing completions with it).
  // `registerLatexSyntax` registers this one; the model picks the language up
  // as soon as it does.
  language: PRETEXT_LATEX_LANGUAGE_ID,
  clean: latexCleanSupport,
  registerMonacoExtensions: (monaco, editor) => {
    const syntax = registerLatexSyntax(monaco);
    const language = registerFlavorLanguage(monaco, editor, {
      flavor: pretextLatexLanguage,
      monacoLanguageId: PRETEXT_LATEX_LANGUAGE_ID,
      // `\` opens a macro, `{` an environment name after \begin/\end, `[` a
      // \hyperref target.
      triggerCharacters: ["\\", "{", "["],
      clean: latexCleanSupport,
      // A LaTeX division's `\section{…}\label{…}` header line is structural and
      // locked; fixes and quick fixes stay below it.
      getEditableRange: (model) => editableRangeFor(model, "latex"),
      cleanAll: {
        label: "Clean up LaTeX",
        run: () =>
          applyCleanFixes(monaco, editor, latexCleanSupport, {
            sourceFormat: "latex",
          }),
      },
    });

    return {
      dispose: () => {
        language.dispose();
        syntax.dispose();
      },
    };
  },
};
