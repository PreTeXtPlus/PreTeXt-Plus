import type { FormatEditorConfig } from "./types";

/**
 * Raw text, for a `raw` snippet: verbatim source that is inserted into the
 * assembled document as CDATA. Monaco's built-in `plaintext` gives it no
 * highlighting, and nothing of ours is added — no completions, no lint — since
 * the text is never read as markup.
 */
export const rawConfig: FormatEditorConfig = {
  language: "plaintext",
};
