// Braille translation for PreFigure's tactile diagrams, as a module of its own:
// a host serves its bundle beside the PreFigure worker and hands the editor its
// URL (`generatorRuntimes.prefigure.assetUrls["prefigure_braille.js"]`); the
// worker imports it the first time an author asks for a tactile diagram.
export { createBrailleTranslator, type BrailleTranslator } from "./generators/prefigure/braille";
