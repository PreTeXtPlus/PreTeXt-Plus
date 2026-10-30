/**
 * The main-thread side of the TikZ engine: a Web Worker running a TeX, through
 * the runtime every generator's worker shares. Unlike PreFigure's, this engine
 * can hang on its input (TeX is a programming language, and a collaborator's
 * source compiles here too), so its renders have a watchdog, and what comes back
 * is sanitized before anything shows or stores it.
 */
import type { GeneratorRuntime, GeneratorRuntimeOptions } from "../types";
import { createWorkerRuntime, type GeneratorWorkerLike } from "../workerRuntime";
import { sanitizeSvg } from "./sanitizeSvg";
import type { TikzWorkerRequest } from "./worker/protocol";

export type TikzWorkerLike = GeneratorWorkerLike<TikzWorkerRequest>;

export interface TikzRuntimeDeps {
  createWorker?: () => TikzWorkerLike;
}

/** TeX silent this long is taken to be looping. The engine's own default. */
export const TIKZ_STALL_MS = 20_000;
/** A run still printing after this long is taken to be looping too. */
export const TIKZ_RENDER_LIMIT_MS = 120_000;

export function createTikzRuntime(
  options: GeneratorRuntimeOptions,
  deps: TikzRuntimeDeps = {},
): GeneratorRuntime {
  return createWorkerRuntime<TikzWorkerRequest>({
    label: "TikZ",
    createWorker:
      deps.createWorker ??
      (() => new Worker(options.workerUrl, { type: "module", name: "tikz" }) as TikzWorkerLike),
    loadRequest: () => {
      if (!options.baseUrl) throw new Error("The host gave no URL for the TikZ engine");
      const directory = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
      return { type: "load", baseUrl: new URL(directory, globalThis.location?.href).toString() };
    },
    renderRequest: (source, docinfo) => ({
      type: "render",
      source,
      preamble: docinfo["latex-image-preamble"] ?? "",
      macros: docinfo.macros ?? "",
    }),
    finishSvg: sanitizeSvg,
    watchdog: { stallMs: TIKZ_STALL_MS, limitMs: TIKZ_RENDER_LIMIT_MS },
  });
}
