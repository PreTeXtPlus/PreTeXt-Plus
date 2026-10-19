// The PreFigure engine: `prefig` running under Pyodide in a Web Worker, so an
// author's PreFigure diagram renders as they type and its SVG is stored with
// the asset (see docs/generated-assets-plan.md).
//
// Bundled as its own entry because `npm run build` globs `app/javascript/*.*`;
// the editor is handed the URL it is served from (projects/_form) and starts it
// as an ES-module Web Worker on the author's request -- never on page load,
// since Pyodide plus scipy is ~100 MB the first time. Pyodide itself is fetched
// from jsDelivr by the worker at runtime; the `prefig` wheel comes from
// public/assets/prefigure (script/copy-static-assets.js).
import "@pretextbook/web-editor/prefigure-worker";
