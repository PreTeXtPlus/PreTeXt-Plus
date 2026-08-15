// Web Worker entry point, loaded via `new Worker(...)` from editor.jsx's
// `createConversionWorker`. All the actual logic lives in the library — this
// file only needs to exist so esbuild has something to build.
//
// Deliberately NOT at the top level of app/javascript/ (which would make it
// match the `app/javascript/*.*` glob the root `build` script uses for the
// main app bundle): that glob's output goes to app/assets/builds, which
// Propshaft content-digests, so the URL isn't knowable at the time
// createConversionWorker constructs it. Instead, the root `build` script has
// a second, explicit esbuild invocation for this file that outputs straight
// to public/assets — the same place (and for the same reason) the root
// build script copies @pretextbook/libxslt-wasm's binary — so it's served at
// a stable, undigested `/assets/pretext-conversion-worker.js` that
// `new URL("pretext-conversion-worker.js", import.meta.url)` can resolve
// against relative to the main bundle's own (digested) URL, since both live
// under the same `/assets/` path.
import "@pretextbook/web-editor/conversion-worker";
