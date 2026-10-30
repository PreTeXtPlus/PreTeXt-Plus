// The TikZ engine: a TeX in a Web Worker, so an author's TikZ picture renders as
// they type and its SVG is stored with the asset (see
// docs/generated-assets-plan.md).
//
// Bundled as its own entry because `npm run build` globs `app/javascript/*.*`;
// the editor is handed the URL it is served from (projects/_form) and starts it
// as an ES-module Web Worker when a TikZ asset is opened. The engine itself is
// fetched by the worker from public/engines, where script/fetch-tikz-engine.js
// puts it.
import "@pretextbook/web-editor/tikz-worker";
