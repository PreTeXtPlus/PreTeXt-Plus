/**
 * Monaco's built-in `xml` language configuration, adjusted to match the
 * PreTeXt VS Code extension's, which `@pretextbook/completions` and
 * `@pretextbook/typing-shortcuts` are written against:
 *
 * - `<` is not auto-closed. The completions read `<|>` as a start tag that is
 *   already complete (the one typing `<` over a selection makes) and offer
 *   bare names for it; an auto-closed `<` would turn every element completion
 *   into one of those, and the full snippets would never be offered.
 * - `$`, `*` and `` ` `` join `<` and `"` as surrounding pairs: typed over a
 *   selection, the typing shortcuts turn `$text$` into `<m>text</m>`, `<text>`
 *   into an element named by typing, and so on.
 *
 * Only those two properties are set; the rest (comments, brackets, onEnter
 * rules) still come from Monaco's configuration, since Monaco merges language
 * configurations property by property.
 */
const PRETEXT_XML_CONFIGURATION = {
  autoClosingPairs: [
    { open: "'", close: "'" },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: "'", close: "'" },
    { open: '"', close: '"' },
    { open: "<", close: ">" },
    { open: "$", close: "$" },
    { open: "*", close: "*" },
    { open: "`", close: "`" },
  ],
};

/**
 * Apply {@link PRETEXT_XML_CONFIGURATION} to `languageId` (Monaco's `xml`).
 * The configuration is per language, so it applies to every editor showing
 * XML while it is registered; dispose it when the PreTeXt editor goes away.
 */
export const registerPretextLanguageConfiguration = (
  monaco: any,
  languageId: string,
): { dispose: () => void } => {
  let registration: { dispose: () => void } | undefined;
  let disposed = false;

  // Monaco loads its own `xml` configuration lazily, the first time a model
  // uses the language, and of two configurations the later one wins. Its
  // tokenizer comes from the same lazy load, so once `colorize` (which waits
  // for the tokenizer) settles, Monaco's configuration is in and ours goes
  // on top of it.
  const colorized: Promise<unknown> =
    monaco.editor.colorize?.("", languageId, {}) ?? Promise.resolve();
  colorized
    .catch(() => {})
    .then(() => {
      if (disposed) return;
      registration = monaco.languages.setLanguageConfiguration(
        languageId,
        PRETEXT_XML_CONFIGURATION,
      );
    });

  return {
    dispose: () => {
      disposed = true;
      registration?.dispose();
    },
  };
};
