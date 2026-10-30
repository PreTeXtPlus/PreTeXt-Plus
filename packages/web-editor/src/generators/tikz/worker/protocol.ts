/**
 * Messages between the TikZ runtime (main thread, `../runtime.ts`) and its
 * worker (`./handler.ts`). Plain data only.
 */
import type { GeneratorWorkerResponse } from "../../workerProtocol";

/**
 * The engine's bundles the worker reads. They must be the ones
 * `script/fetch-tikz-engine.js` keeps, listed in `config/tikz_engine.json`;
 * `tikzGenerator.test.ts` holds the two together.
 */
export const TIKZ_BUNDLES = [
  "core",
  "cm-tfm",
  "cm-type1",
  "lm-fonts",
  "ps-fonts",
  "tex-plain",
  "latex-core",
  "latex-extra",
  "tikz-snapshot",
] as const;

export type TikzWorkerRequest =
  | { type: "load"; token: number; baseUrl: string }
  /** `preamble` and `macros` are the docinfo elements' raw inner text. */
  | { type: "render"; token: number; source: string; preamble: string; macros: string };

export type TikzWorkerResponse = GeneratorWorkerResponse;
