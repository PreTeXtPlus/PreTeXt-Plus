/**
 * The main-thread side of the PreFigure engine: a Web Worker running the wasm
 * build of PreFigure, through the runtime every generator's worker shares.
 */
import type { GeneratorRuntime, GeneratorRuntimeOptions } from "../types";
import { createWorkerRuntime, type GeneratorWorkerLike } from "../workerRuntime";
import { PREFIG_WASM_BINARY, PREFIG_WASM_GLUE, type PrefigureWorkerRequest } from "./worker/protocol";

export type PrefigureWorkerLike = GeneratorWorkerLike<PrefigureWorkerRequest>;

export interface PrefigureRuntimeDeps {
  createWorker?: () => PrefigureWorkerLike;
}

export function createPrefigureRuntime(
  options: GeneratorRuntimeOptions,
  deps: PrefigureRuntimeDeps = {},
): GeneratorRuntime {
  // The host may give paths ("/assets/prefigure/prefig_wasm-1a2b.js"); the
  // worker needs absolute URLs, since its own location is wherever the bundle
  // was served from.
  const urlOf = (name: string) => {
    const url = options.assetUrls?.[name];
    if (!url) throw new Error(`The host gave no URL for the PreFigure engine's ${name}`);
    return new URL(url, globalThis.location?.href).toString();
  };

  return createWorkerRuntime<PrefigureWorkerRequest>({
    label: "PreFigure",
    createWorker:
      deps.createWorker ??
      (() => new Worker(options.workerUrl, { type: "module", name: "prefigure" }) as PrefigureWorkerLike),
    loadRequest: () => ({ type: "load", glueUrl: urlOf(PREFIG_WASM_GLUE), wasmUrl: urlOf(PREFIG_WASM_BINARY) }),
    renderRequest: (source, docinfo) => ({ type: "render", source, macros: docinfo.macros ?? "" }),
  });
}
