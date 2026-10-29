/**
 * The worker's half of the PreFigure runtime: load the wasm engine once, then
 * render diagrams on request. Pure in the sense of the preview worker's handler
 * — it takes a request and a `post`, so the entry (`src/prefigureWorker.ts`) is
 * one line and a test can drive it directly, with the real engine and a stub
 * host (see `__tests__/prefigureWasm.test.ts`).
 *
 * The engine is PreFigure's Rust port compiled to WebAssembly (the prefigure
 * repo's `packages/prefig-wasm`, MathJax variant): the glue is imported from the
 * URL the host serves it at with a dynamic `import()` of a computed string,
 * which no bundler follows, and the binary's URL is handed to the glue's `init`.
 * What the engine cannot do itself — typeset TeX labels, measure text — it asks
 * the host object for (`./compat-api.ts`).
 */
import type { PrefigureWorkerRequest, PrefigureWorkerResponse } from "./protocol";
import { PREFIG_WASM_VERSION } from "./protocol";

/**
 * The surface of the wasm-pack module this worker uses
 * (`packages/prefig-wasm/src/lib.rs` in the prefigure repo).
 */
export interface PrefigWasmModule {
  /** wasm-pack's `--target web` initializer: fetches (or takes) the binary and instantiates it. */
  default(options: { module_or_path: string | URL | BufferSource }): Promise<unknown>;
  set_host_api(api: unknown): void;
  version(): string;
  build_from_string(format: "svg" | "tactile", source: string): { svg: string; annotations: string | null };
}

/** What the engine calls back into (`packages/prefig-wasm/src/host.rs`). */
export interface PrefigHostApi {
  measure_text(text: string, fontString: string): [number, number, number];
  translate_text(text: string, typeform: number[]): string;
  processMath(expression: string): string;
  processBraille(expression: string): string;
  /** TeX macro definitions to put in scope for every label of the next render. */
  setMacros(macros: string): void;
}

/** The pieces a test replaces: how the glue is imported and what host it gets. */
export interface PrefigureWorkerDeps {
  importGlue?: (glueUrl: string) => Promise<PrefigWasmModule>;
  createHostApi?: () => Promise<PrefigHostApi>;
}

interface Engine {
  wasm: PrefigWasmModule;
  host: PrefigHostApi;
}

let engine: Engine | null = null;
let loading: Promise<Engine> | null = null;

const defaultDeps: Required<PrefigureWorkerDeps> = {
  importGlue: (glueUrl) => import(/* @vite-ignore */ glueUrl) as Promise<PrefigWasmModule>,
  // Imported here rather than at the top so a worker that never gets its engine
  // never pays for MathJax.
  createHostApi: async () => new (await import("./compat-api")).PrefigBrowserApi(),
};

async function loadEngine(
  glueUrl: string,
  wasmUrl: string,
  progress: (message: string) => void,
  deps: Required<PrefigureWorkerDeps>,
): Promise<Engine> {
  progress("Loading the PreFigure engine…");
  const wasm = await deps.importGlue(glueUrl);
  await wasm.default({ module_or_path: wasmUrl });
  const version = wasm.version();
  if (version !== PREFIG_WASM_VERSION) {
    // Not fatal -- the engine that loaded is the one that renders -- but the pin
    // in protocol.ts is what the docs and the vendored build are expected to agree on.
    console.warn(`PreFigure engine is ${version}; the editor expects ${PREFIG_WASM_VERSION}`);
  }
  progress("Loading MathJax…");
  const host = await deps.createHostApi();
  wasm.set_host_api(host);
  return { wasm, host };
}

export async function handlePrefigureWorkerRequest(
  request: PrefigureWorkerRequest,
  post: (response: PrefigureWorkerResponse) => void,
  deps: PrefigureWorkerDeps = {},
): Promise<void> {
  const { token } = request;
  const fail = (error: unknown) =>
    post({ type: "failed", token, message: error instanceof Error ? error.message : String(error) });

  if (request.type === "load") {
    try {
      loading ??= loadEngine(
        request.glueUrl,
        request.wasmUrl,
        (message) => post({ type: "progress", token, message }),
        { ...defaultDeps, ...deps },
      );
      engine = await loading;
      post({ type: "loaded", token });
    } catch (error) {
      loading = null;
      fail(error);
    }
    return;
  }

  if (!engine) {
    fail("The PreFigure engine is not loaded");
    return;
  }
  try {
    engine.host.setMacros(request.macros);
    const result = engine.wasm.build_from_string("svg", request.source);
    // An empty string means it found no <diagram>.
    if (!result.svg) {
      fail("PreFigure produced no diagram. Is there a <diagram> element?");
      return;
    }
    post({ type: "rendered", token, svg: result.svg, annotations: result.annotations ?? null });
  } catch (error) {
    fail(error);
  }
}

/** Tests only: forget the loaded engine so the next load starts afresh. */
export function resetPrefigureEngineForTests(): void {
  engine = null;
  loading = null;
}
