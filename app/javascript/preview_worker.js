// The live preview's render worker: the PreTeXt stylesheets, run through
// libxslt-in-WebAssembly, off the main thread so a long division never
// freezes the editor while it renders.
//
// Bundled as its own entry because `npm run build` globs `app/javascript/*.*`;
// the editor is handed the URL it is served from (see projects/_form) and
// starts it as an ES-module Web Worker. The WASM binary is found next to this
// script, the same way the main bundle finds it, and the stylesheets come from
// the CDN, so nothing else needs serving.
import "@pretextbook/web-editor/preview-worker";
