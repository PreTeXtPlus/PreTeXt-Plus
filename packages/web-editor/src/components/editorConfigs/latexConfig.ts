import {
  describeFix,
  findLatexFixes,
  getLatexCleanDiagnostics,
  PRETEXT_LATEX_LANGUAGE_ID,
  pretextLatexLanguage,
  type PretextFlavorLanguage,
} from "@pretextbook/latex-style-pretext";
import { registerLatexSyntax } from "./latexSyntax";
import { registerFlavorLanguage } from "./flavorLanguage";
import { applyCleanFixes } from "./latexClean";
import type { CleanSupport, FormatEditorConfig } from "./types";
import { registerConfiguredSpellCheck } from "./spellcheck";

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

/** Whether the backslashes before `offset` pair off, as `\\` does at a line end. */
const afterLineBreak = (text: string, offset: number): boolean => {
  const run = /(\\+)[a-zA-Z]*$/.exec(text.slice(0, offset));
  return run !== null && run[1].length % 2 === 0;
};

/**
 * The language core, minus its macro list after a `\\`. The second backslash
 * looks like the start of a macro, and with the list open the Enter that ends a
 * table row would accept `\begin{...}` rather than start a new line. The newline
 * is for a cursor at the very end of the buffer: the core reads open math as
 * ending just before it, and with `$` not auto-closed that is where math gets
 * typed.
 */
export const latexFlavor: PretextFlavorLanguage = {
  ...pretextLatexLanguage,
  getCompletions: (params) =>
    afterLineBreak(params.text, params.offset)
      ? []
      : pretextLatexLanguage.getCompletions({
          ...params,
          text: `${params.text}\n`,
        }),
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
      flavor: latexFlavor,
      monacoLanguageId: PRETEXT_LATEX_LANGUAGE_ID,
      // `\` opens a macro, `{` an environment name after \begin/\end, `[` a
      // \hyperref target.
      triggerCharacters: ["\\", "{", "["],
      clean: latexCleanSupport,
      cleanAll: {
        label: "Clean up LaTeX",
        run: () =>
          applyCleanFixes(monaco, editor, latexCleanSupport),
      },
    });
    // Spelling reads the same scopes the PreTeXt editor does; what changes is
    // how prose is told apart from markup (see `spellcheck/latexRegions.ts`).
    const spelling = registerConfiguredSpellCheck(
      monaco,
      editor,
      PRETEXT_LATEX_LANGUAGE_ID,
      "latex",
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
