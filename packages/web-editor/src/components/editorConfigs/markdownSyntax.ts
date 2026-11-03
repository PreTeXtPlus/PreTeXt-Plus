import { INLINE_MATH, WORD_CHAR } from "./markdownDollars";

const DIRECTIVE_NAMES =
  "theorem|lemma|corollary|proposition|claim|fact|conjecture|axiom|" +
  "principle|hypothesis|algorithm|definition|notation|remark|note|" +
  "observation|warning|insight|assemblage|example|question|problem|" +
  "exercise|activity|exploration|investigation|project|task|" +
  "proof|case|solution|hint|answer";

// Two separate patterns avoid the Monarch optional-group alignment bug (absent
// optional groups shift the action-array indices, breaking token assignment).
//
// The modifier group uses alternation (longest match first) to cover all forms
// without optional captures:
//   [Title]{#ref}   ← both title and id
//   [Title]         ← title only
//   {#ref}          ← id only
const PYTHON_DIRECTIVE_WITH_MODIFIER =
  `^(\\s*)(${DIRECTIVE_NAMES})(\\[.*?\\]\\{.*?\\}|\\[.*?\\]|\\{.*?\\})(\\s*:)\\s*$`;
const PYTHON_DIRECTIVE_PLAIN =
  `^(\\s*)(${DIRECTIVE_NAMES})(\\s*:)\\s*$`;

/**
 * Registers a custom `pretext-markdown` language in Monaco with a Monarch
 * tokenizer tailored for PreTeXt-flavoured Markdown.
 *
 * Differences from the built-in `markdown` language:
 *  - 4-space-indented lines are NOT coloured as code blocks.
 *  - Colon-fenced directives (:::theorem) are highlighted as keywords.
 *  - Python-style directive lines (Theorem: or Theorem[Title]:) are highlighted as keywords.
 *  - Math delimiters ($, $$, \[, \() are highlighted as numbers, and a `$` is
 *    math only where the converter says so (see `markdownDollars.ts`).
 *  - Raw PreTeXt tags and HTML comments are highlighted as such, so a `$` in an
 *    attribute or a comment is left alone.
 *
 * Token types are chosen to match Monaco's built-in Monarch theme rules:
 *  - `keyword`  → colored (blue/purple) — used for headings, directives, list markers
 *  - `strong`   → bold font             — used for **bold** and __bold__
 *  - `emphasis` → italic font           — used for *italic*
 *  - `term`     → bold + italic font    — used for _term_ (a PreTeXt <term>)
 *  - `variable.source.markdown` → inline code color
 *  - `string`   → string color          — used for fenced code, links, escapes
 *  - `number`   → number color          — used for math
 *  - `comment`  → comment color         — used for block quotes, HTML comments
 *  - `tag`      → tag color             — used for raw PreTeXt tags
 */
export function registerMarkdownSyntax(monaco: any): { dispose: () => void } {
  monaco.languages.register({ id: "pretext-markdown" });

  // The `term` token (single-underscore _term_) needs a bold + italic font
  // style, which no built-in theme token provides. Define a theme that
  // inherits the default light theme and adds that one rule, then apply it.
  // The rule only matches the markdown `term` token, so other languages
  // (xml/latex) are visually unchanged.
  monaco.editor.defineTheme("pretext-markdown", {
    base: "vs",
    inherit: true,
    rules: [{ token: "term", fontStyle: "bold italic" }],
    colors: {},
  });
  monaco.editor.setTheme("pretext-markdown");

  monaco.languages.setMonarchTokensProvider("pretext-markdown", {
    // Lets the directive name alternation match both `theorem:` and `Theorem:`
    // without enumerating both cases. Safe here because no other rule has
    // alphabetic characters where case sensitivity matters.
    ignoreCase: true,
    // For the `\p{…}` classes the math rule shares with `markdownDollars.ts`.
    unicode: true,

    tokenizer: {
      root: [
        // ATX headings (#, ##, … ######) — entire line coloured as keyword
        [/^#{1,6}\s+.*$/, "keyword"],

        // Colon-fenced directive openers: :::theorem, :::theorem[Title]{#id}
        [/^:{3,}\w+.*$/, "keyword"],
        // Colon-fenced directive closers: bare ::: or ::::
        [/^:{3,}\s*$/, "keyword"],

        // Python-style directive lines — with modifier first (more specific).
        [PYTHON_DIRECTIVE_WITH_MODIFIER, ["", "keyword", "string", "keyword"]],
        [PYTHON_DIRECTIVE_PLAIN, ["", "keyword", "keyword"]],

        // Fenced code blocks (``` or ~~~); persistent state so interior lines
        // aren't re-parsed as markdown.
        [/^`{3,}.*$/, { token: "string", next: "@fencedBacktick" }],
        [/^~{3,}.*$/, { token: "string", next: "@fencedTilde" }],

        // Block quotes
        [/^(\s*>+\s*)/, "comment"],

        // Unordered list markers  (- , * , +)
        [/^(\s*)([-*+])( +)/, ["", "keyword", ""]],
        // Ordered list markers  (1. , 2) , …)
        [/^(\s*)(\d+[.)])( +)/, ["", "keyword", ""]],

        // Inline content — shared rules applied to remaining characters
        { include: "@inline" },
      ],

      fencedBacktick: [
        [/^`{3,}\s*$/, { token: "string", next: "@pop" }],
        [/.*$/, "string"],
      ],

      fencedTilde: [
        [/^~{3,}\s*$/, { token: "string", next: "@pop" }],
        [/.*$/, "string"],
      ],

      // Multi-line math states: consume everything as `number` until the
      // matching closing delimiter, so markdown emphasis is never applied
      // inside math that spans more than one line.
      mathDollarDollar: [
        [/\$\$/, { token: "number", next: "@pop" }],
        [/[^$]+/, "number"],
        [/\$/, "number"],
      ],
      mathBracket: [
        [/\\\]/, { token: "number", next: "@pop" }],
        [/[^\\]+/, "number"],
        [/\\/, "number"],
      ],
      mathParen: [
        [/\\\)/, { token: "number", next: "@pop" }],
        [/[^\\]+/, "number"],
        [/\\/, "number"],
      ],

      htmlComment: [
        [/-->/, { token: "comment", next: "@pop" }],
        [/[^-]+/, "comment"],
        [/./, "comment"],
      ],

      inline: [
        // Math — same-line forms first, then multi-line openers that switch
        // into a dedicated state. Inside math everything is tokenized as
        // `number`, so interior underscores/asterisks never reach the
        // emphasis/term rules below.
        //
        // Display math $$…$$ (before single $ to avoid a partial match)
        [/\$\$[^$]*\$\$/, "number"],
        [/\$\$/, { token: "number", next: "@mathDollarDollar" }],
        // LaTeX display math  \[…\]
        [/\\\[[^\]]*\\\]/, "number"],
        [/\\\[/, { token: "number", next: "@mathBracket" }],
        // LaTeX inline math   \(…\)
        [/\\\([^)]*\\\)/, "number"],
        [/\\\(/, { token: "number", next: "@mathParen" }],
        // Inline math $…$. The converter's other condition, on the character
        // before the `$`, is out of a rule's sight: Monarch matches from the
        // current position. See the text rules at the end of this list.
        [INLINE_MATH, "number"],

        // Bold before italic so ** isn't consumed as two * tokens
        [/\*\*[^*\n]+\*\*/, "strong"],
        [/__[^_\n]+__/, "strong"],
        // Italic (asterisk form only)
        [/\*[^*\n]+\*/, "emphasis"],
        // A single underscore marks a PreTeXt <term> — rendered bold + italic.
        // Multi-line math is handled above, so underscores inside math never
        // reach this rule.
        [/_[^_\n]+_/, "term"],

        // Inline code
        [/`[^`\n]+`/, "variable.source.markdown"],

        // Images before links (both start with [)
        [/!\[.*?\]\(.*?\)/, "string.link"],
        [/\[.*?\]\(.*?\)/, "string.link"],

        // Raw PreTeXt and `<https://…>` autolinks, whole, so a `$` in an
        // attribute never reaches the math rule. Comments are dropped on the way
        // to PreTeXt.
        [/<!--/, { token: "comment", next: "@htmlComment" }],
        [/<\/?[a-z][\w:-]*(?:\s[^<>\n]*)?\/?>/, "tag"],
        [/<[a-z][a-z0-9+.-]*:[^\s<>]*>/, "string.link"],

        // Escape sequences
        [/\\[\\`*_{}[\]()#+\-.!$]/, "string.escape"],

        // A `$` straight after a letter or digit doesn't open math, as in US$5.
        [new RegExp(`${WORD_CHAR.source}\\$(?!\\$)`, "u"), ""],

        // Bulk-consume plain text for performance (avoids one-char-at-a-time
        // fallback), stopping short of a character the rule above may want.
        [/(?:[^$*`_[\\!<](?!\$))+/, ""],

        // Single-character fallthrough
        [/./, ""],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration("pretext-markdown", {
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "`", close: "`" },
      // No `$`: it can't be told from a price while it is being typed, and a
      // closing `$` the author didn't write turns `$5 today` into math.
    ],
    surroundingPairs: [
      { open: "*", close: "*" },
      { open: "_", close: "_" },
      { open: "`", close: "`" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "$", close: "$" },
    ],
  });

  // Language registrations in Monaco are permanent for the lifetime of the
  // Monaco instance, so there is nothing to dispose.
  return { dispose: () => {} };
}
