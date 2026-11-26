// Braille translation for PreFigure's tactile diagrams: liblouis (text labels in
// contracted UEB) and Speech Rule Engine (math labels in Nemeth), a few
// megabytes that only a tactile render needs.
//
// Bundled as its own entry, like prefigure_worker.js, so the worker stays its
// size for every visual render: projects/_form hands the editor this file's
// URL among the `prefigureAssetUrls`, and the PreFigure worker imports it the
// first time an author switches a diagram's preview to Tactile.
export * from "@pretextbook/web-editor/prefigure-braille";
