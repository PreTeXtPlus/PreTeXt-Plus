import { PRETEXT_LATEX_LANGUAGE_ID } from "@pretextbook/latex-style-pretext";

/**
 * Registers a `pretext-latex` language in Monaco with a Monarch tokenizer for
 * LaTeX-style PreTeXt.
 *
 * Monaco ships **no** built-in `latex` language (see
 * `monaco-editor/esm/vs/basic-languages/`), and an unregistered language id
 * silently resolves to plain text — which also means no completion provider
 * registered against it can ever match the model. Registering the id here is
 * therefore what makes both highlighting *and* completions work; it mirrors
 * what `markdownSyntax.ts` does for `pretext-markdown`.
 *
 * Token types are chosen to match Monaco's built-in Monarch theme rules:
 *  - `comment`         → comment color — used for `%` line comments
 *  - `keyword`         → colored       — used for `\macro`, `\begin`, `\end`
 *  - `type`            → type color    — used for the environment name
 *  - `delimiter.curly` → punctuation   — used for braces around it
 *  - `string.escape`   → string color  — used for escapes such as `\%`, `\&`
 */
export function registerLatexSyntax(monaco: any): { dispose: () => void } {
  monaco.languages.register({
    id: PRETEXT_LATEX_LANGUAGE_ID,
    extensions: [".ptx.tex"],
    aliases: ["PreTeXt (LaTeX)"],
  });

  monaco.languages.setMonarchTokensProvider(PRETEXT_LATEX_LANGUAGE_ID, {
    tokenizer: {
      root: [
        // Comments first — everything after `%` is inert, including macros.
        [/%.*$/, "comment"],
        // `\begin{env}` / `\end{env}` as one rule so the environment name can
        // be colored differently from the command itself.
        [
          /\\(begin|end)(\{)([a-zA-Z0-9*-]*)(\})/,
          ["keyword", "delimiter.curly", "type", "delimiter.curly"],
        ],
        [/\\[a-zA-Z@]+/, "keyword"],
        // A backslash before a non-letter is an escaped character (`\%`, `\$`),
        // never a macro.
        [/\\[^a-zA-Z]/, "string.escape"],
        [/\$\$?/, "delimiter.math"],
        [/[{}[\]]/, "delimiter"],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration(PRETEXT_LATEX_LANGUAGE_ID, {
    comments: { lineComment: "%" },
    brackets: [
      ["{", "}"],
      ["[", "]"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "$", close: "$" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "$", close: "$" },
    ],
  });

  // Language registrations in Monaco are permanent for the lifetime of the
  // Monaco instance, so there is nothing to dispose.
  return { dispose: () => {} };
}
