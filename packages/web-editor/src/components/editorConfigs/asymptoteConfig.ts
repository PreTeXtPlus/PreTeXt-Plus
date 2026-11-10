import type { FormatEditorConfig } from "./types";

export const ASYMPTOTE_LANGUAGE_ID = "asymptote";

/**
 * Asymptote's own words: its types, control flow and the few constants an
 * author types on most lines. The language is C-like, but borrowing Monaco's
 * `cpp` grammar would colour `path`, `pair` and `pen` as nothing and flag
 * things Asymptote allows, so this is a small grammar of its own.
 */
const KEYWORDS = [
  "import", "include", "access", "from", "as", "unravel", "struct", "typedef", "new", "operator",
  "if", "else", "while", "for", "do", "break", "continue", "return", "this", "static", "public",
  "private", "restricted", "explicit", "var", "void", "bool", "bool3", "int", "real", "string",
  "pair", "triple", "path", "path3", "guide", "guide3", "pen", "transform", "transform3", "frame",
  "picture", "file", "code",
];

const CONSTANTS = [
  "true", "false", "null", "pi", "inf", "infinity", "nan", "currentpicture", "currentpen",
  "defaultpen", "cycle", "unitsquare", "unitcircle", "origin", "N", "S", "E", "W", "NE", "NW",
  "SE", "SW", "up", "down", "left", "right",
];

/**
 * Asymptote: the drawing code of an `<asymptote>`. Highlighting and bracket
 * matching only; the source runs on a build server, so nothing here checks it.
 */
export const asymptoteConfig: FormatEditorConfig = {
  language: ASYMPTOTE_LANGUAGE_ID,
  registerMonacoExtensions: (monaco) => {
    monaco.languages.register({ id: ASYMPTOTE_LANGUAGE_ID, extensions: [".asy"], aliases: ["Asymptote"] });
    monaco.languages.setMonarchTokensProvider(ASYMPTOTE_LANGUAGE_ID, {
      keywords: KEYWORDS,
      constants: CONSTANTS,
      tokenizer: {
        root: [
          [/\/\/.*$/, "comment"],
          [/\/\*/, "comment", "@comment"],
          [/"/, "string", "@string"],
          [/'/, "string", "@singleString"],
          [/\d+(\.\d*)?([eE][+-]?\d+)?(bp|pt|cm|mm|inch|inches)?/, "number"],
          [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@constants": "constant", "@default": "identifier" } }],
          [/[{}()[\]]/, "@brackets"],
          [/[-+*/%=<>!&|^~?:.]+/, "operator"],
          [/[;,]/, "delimiter"],
        ],
        comment: [
          [/[^/*]+/, "comment"],
          [/\*\//, "comment", "@pop"],
          [/[/*]/, "comment"],
        ],
        // A TeX label lives in a string, so an escape is `\$` or `\\`, kept whole.
        string: [
          [/[^\\"]+/, "string"],
          [/\\./, "string.escape"],
          [/"/, "string", "@pop"],
        ],
        singleString: [
          [/[^\\']+/, "string"],
          [/\\./, "string.escape"],
          [/'/, "string", "@pop"],
        ],
      },
    });
    monaco.languages.setLanguageConfiguration(ASYMPTOTE_LANGUAGE_ID, {
      comments: { lineComment: "//", blockComment: ["/*", "*/"] },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"', notIn: ["string"] },
      ],
      surroundingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
      ],
    });
    // Language registrations are permanent for the Monaco instance; nothing to dispose.
    return { dispose: () => {} };
  },
};
