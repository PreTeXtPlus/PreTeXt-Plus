/**
 * Braille for PreFigure's tactile output: text labels in contracted UEB
 * (liblouis), math labels in Nemeth (Speech Rule Engine). A few megabytes, so
 * it is its own module (`@pretextbook/web-editor/prefigure-braille`), which the
 * host serves beside the PreFigure worker and the worker imports by URL on its
 * first tactile render — never for a visual one.
 */
import { translateText } from "./liblouis";
import { loadNemeth, mathmlToNemeth } from "./nemeth";

export interface BrailleTranslator {
  /** Text → Unicode braille (contracted UEB); `typeform` is liblouis's per-character emphasis. */
  text(text: string, typeform?: readonly number[]): string;
  /** A MathML `<math>` element → Nemeth braille. */
  math(mathml: string): string;
}

export async function createBrailleTranslator(): Promise<BrailleTranslator> {
  await loadNemeth();
  return { text: translateText, math: mathmlToNemeth };
}
