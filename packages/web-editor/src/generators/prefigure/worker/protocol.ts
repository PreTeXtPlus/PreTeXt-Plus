/**
 * Messages between the PreFigure runtime (main thread, `../runtime.ts`) and its
 * worker (`./handler.ts`). Plain data only.
 */

/**
 * The PreFigure release the vendored engine was built from (`vendor/prefigure`
 * in the Rails app, which `script/build-prefig-wasm.sh` produces). The worker
 * checks the loaded engine reports it, so a stale vendored build is noticed.
 */
export const PREFIG_WASM_VERSION = "0.7.9";

/**
 * The engine's files, keyed so in the host's `assetUrls`: wasm-pack's `--target web` output
 * for the prefigure repo's `packages/prefig-wasm` crate — the JS glue, which
 * loads the binary and exposes `build_from_string`, and the binary itself.
 */
export const PREFIG_WASM_GLUE = "prefig_wasm.js";
export const PREFIG_WASM_BINARY = "prefig_wasm_bg.wasm";

export type PrefigureWorkerRequest =
  | { type: "load"; token: number; glueUrl: string; wasmUrl: string }
  | { type: "render"; token: number; source: string; macros: string };

export type PrefigureWorkerResponse =
  | { type: "progress"; token: number; message: string }
  | { type: "loaded"; token: number }
  | { type: "rendered"; token: number; svg: string; annotations: string | null }
  | { type: "failed"; token: number; message: string };
