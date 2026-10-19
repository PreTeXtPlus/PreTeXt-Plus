/**
 * Messages between the PreFigure runtime (main thread, `../runtime.ts`) and its
 * worker (`./handler.ts`). Plain data only.
 */

/** Pyodide release the worker loads. Bump together with the wheel set below. */
export const PYODIDE_VERSION = "0.26.4";
export const DEFAULT_PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/**
 * The wheels the host serves under `assetBaseUrl` (copied from `vendor/prefigure`
 * by the Rails app's `script/copy-static-assets.js`). `prefig`'s version is the
 * one place it is pinned on the browser side.
 */
export const PREFIG_VERSION = "0.7.9";
export const PREFIGURE_WHEELS = [
  `prefig-${PREFIG_VERSION}-py3-none-any.whl`,
  "segno-1.6.6-py3-none-any.whl",
] as const;

/**
 * Pyodide-distributed packages `prefig` imports. Loaded with `loadPackage`, not
 * micropip: no dependency resolution, no PyPI, and `prefig`'s `lxml>=6` pin is
 * unsatisfiable from PyPI on this Pyodide while its bundled lxml works fine.
 */
export const PYODIDE_PACKAGES = ["lxml", "numpy", "scipy", "shapely", "click", "networkx"] as const;

export type PrefigureWorkerRequest =
  | { type: "load"; token: number; pyodideIndexUrl: string; wheelUrls: string[] }
  | { type: "render"; token: number; source: string };

export type PrefigureWorkerResponse =
  | { type: "progress"; token: number; message: string }
  | { type: "loaded"; token: number }
  | { type: "rendered"; token: number; svg: string; annotations: string | null }
  | { type: "failed"; token: number; message: string };
