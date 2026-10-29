// The PreFigure engine: PreFigure's wasm build running in a Web Worker, so an
// author's PreFigure diagram renders as they type and its SVG is stored with
// the asset (see docs/generated-assets-plan.md).
//
// Bundled as its own entry because `npm run build` globs `app/javascript/*.*`;
// the editor is handed the URL it is served from (projects/_form) and starts it
// as an ES-module Web Worker when a PreFigure asset is opened. The engine itself
// (vendor/prefigure, a couple of megabytes) is fetched by the worker from
// app/assets/builds/prefigure under digested names (script/copy-static-assets.js).
import "@pretextbook/web-editor/prefigure-worker";
