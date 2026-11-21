/**
 * Line endings, of which this editor keeps one: `\n`.
 *
 * Source arrives with others — a file saved on Windows, text an import engine
 * wrote, and until November 2026 Monaco itself, which gives a buffer with no
 * line break in it the platform's ending and so wrote `\r\n` for every Enter
 * typed into a division started empty on Windows. A `\r\n` is not harmless:
 * the LaTeX converter counts `\r` and `\n` as a line end each, making every
 * line its own paragraph, and Monaco rewrites inserted text to its model's
 * ending, so a shared `Y.Text` holding a `\r` its peers' models lack puts
 * every later edit one character out.
 *
 * So text is normalized where it comes in (imports, a collaborative document's
 * seed and its whole-string rewrites), the code editor's model is held to
 * `\n` (`CodeEditor`), and a document that already holds a `\r\n` has the
 * `\r` taken out when a bridge attaches (`stripCarriageReturns`). The Rails
 * host normalizes on every write as well (`Content.normalize_line_endings`).
 */

/** `text` with every `\r\n` and lone `\r` written as `\n`. */
export function normalizeLineEndings(text: string): string {
  return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}
