import { registerLatexSyntax } from "./latexSyntax";
import type { FormatEditorConfig } from "./types";

const TEX_LANGUAGE_ID = "tex";

/**
 * Plain TeX: drawing code, a TikZ asset's source. Only highlighting and bracket
 * matching. The `latex` format is LaTeX-flavoured PreTeXt, whose completions,
 * lint and cleanup rules (`\vspace` should not be here) are about a document
 * that will be converted, and this never is.
 */
export const texConfig: FormatEditorConfig = {
  language: TEX_LANGUAGE_ID,
  registerMonacoExtensions: (monaco) =>
    registerLatexSyntax(monaco, { id: TEX_LANGUAGE_ID, extensions: [".tex"], aliases: ["TeX"] }),
};
