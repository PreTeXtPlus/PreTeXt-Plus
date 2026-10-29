/**
 * The main-thread side of the PreFigure engine: a Web Worker running the wasm
 * build of PreFigure, started on demand and shared by every PreFigure asset on
 * the page (see `runtimeFor` in `../index.ts`).
 *
 * Renders are serialized — one in flight, the newest waiting request wins, the
 * rest resolve to it — because an author typing produces more requests than
 * the engine answers, and only the last one matters.
 */
import type {
  GeneratorRuntime,
  GeneratorRuntimeOptions,
  GeneratorRuntimeStatus,
  RenderOptions,
  RenderResult,
} from "../types";
import {
  PREFIG_WASM_BINARY,
  PREFIG_WASM_GLUE,
  type PrefigureWorkerRequest,
  type PrefigureWorkerResponse,
} from "./worker/protocol";

/** The part of `Worker` this module uses, so a test can stand one in. */
export interface PrefigureWorkerLike {
  postMessage(message: PrefigureWorkerRequest): void;
  addEventListener(type: "message", listener: (event: { data: PrefigureWorkerResponse }) => void): void;
  addEventListener(type: "error", listener: (event: { message?: string }) => void): void;
  terminate(): void;
}

export interface PrefigureRuntimeDeps {
  createWorker?: () => PrefigureWorkerLike;
}

/** `Omit<…, "token">` over each member of the request union, not over the union. */
type WithoutToken<T> = T extends { token: number } ? Omit<T, "token"> : never;

type Pending = {
  resolve: (value: PrefigureWorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (message: string) => void;
};

type Settle = { resolve: (value: RenderResult) => void; reject: (error: Error) => void };

export function createPrefigureRuntime(
  options: GeneratorRuntimeOptions,
  deps: PrefigureRuntimeDeps = {},
): GeneratorRuntime {
  const createWorker =
    deps.createWorker ??
    (() => new Worker(options.workerUrl, { type: "module", name: "prefigure" }) as PrefigureWorkerLike);

  let worker: PrefigureWorkerLike | null = null;
  let status: GeneratorRuntimeStatus = "idle";
  let error: string | undefined;
  let progress: string | undefined;
  let loadPromise: Promise<void> | null = null;
  let nextToken = 1;
  const pending = new Map<number, Pending>();
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach((listener) => listener());
  const setStatus = (next: GeneratorRuntimeStatus, message?: string) => {
    status = next;
    error = next === "failed" ? message : undefined;
    progress = next === "loading" ? (message ?? progress) : undefined;
    notify();
  };

  const failAll = (message: string) => {
    for (const { reject } of pending.values()) reject(new Error(message));
    pending.clear();
  };

  const send = (
    request: WithoutToken<PrefigureWorkerRequest>,
    onProgress?: (message: string) => void,
  ): Promise<PrefigureWorkerResponse> =>
    new Promise((resolve, reject) => {
      if (!worker) {
        reject(new Error("The PreFigure engine is not running"));
        return;
      }
      const token = nextToken++;
      pending.set(token, { resolve, reject, onProgress });
      worker.postMessage({ ...request, token } as PrefigureWorkerRequest);
    });

  const handleMessage = ({ data }: { data: PrefigureWorkerResponse }) => {
    const entry = pending.get(data.token);
    if (!entry) return;
    if (data.type === "progress") {
      entry.onProgress?.(data.message);
      return;
    }
    pending.delete(data.token);
    if (data.type === "failed") entry.reject(new Error(data.message));
    else entry.resolve(data);
  };

  const dispose = () => {
    worker?.terminate();
    worker = null;
    loadPromise = null;
    failAll("The PreFigure engine was shut down");
    setStatus("idle");
  };

  const load = (): Promise<void> => {
    if (loadPromise) return loadPromise;
    setStatus("loading", "Starting the PreFigure engine…");
    // The host may give paths ("/assets/prefigure/prefig_wasm-1a2b.js"); the
    // worker needs absolute URLs, since its own location is wherever the bundle
    // was served from.
    const urlOf = (name: string) => {
      const url = options.assetUrls[name];
      if (!url) throw new Error(`The host gave no URL for the PreFigure engine's ${name}`);
      return new URL(url, globalThis.location?.href).toString();
    };
    let glueUrl: string, wasmUrl: string;
    try {
      glueUrl = urlOf(PREFIG_WASM_GLUE);
      wasmUrl = urlOf(PREFIG_WASM_BINARY);
      worker = createWorker();
    } catch (cause) {
      setStatus("failed", cause instanceof Error ? cause.message : String(cause));
      return Promise.reject(new Error(error));
    }
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", (event) => {
      const message = event.message || "The PreFigure worker failed to start";
      failAll(message);
      setStatus("failed", message);
      loadPromise = null;
    });
    loadPromise = send(
      { type: "load", glueUrl, wasmUrl },
      (message) => setStatus("loading", message),
    ).then(
      () => setStatus("ready"),
      (cause: Error) => {
        setStatus("failed", cause.message);
        loadPromise = null;
        throw cause;
      },
    );
    return loadPromise;
  };

  // Latest-wins queue: at most one render on the worker, at most one waiting.
  let inFlight: Promise<void> | null = null;
  let waiting: { source: string; macros: string; settle: Settle[] } | null = null;

  const renderNow = async (source: string, macros: string): Promise<RenderResult> => {
    const response = await send({ type: "render", source, macros });
    if (response.type !== "rendered") throw new Error("Unexpected worker response");
    return { svg: response.svg, annotations: response.annotations, source };
  };

  const drain = async () => {
    while (waiting) {
      const job = waiting;
      waiting = null;
      try {
        const result = await renderNow(job.source, job.macros);
        job.settle.forEach((p) => p.resolve(result));
      } catch (cause) {
        job.settle.forEach((p) => p.reject(cause instanceof Error ? cause : new Error(String(cause))));
      }
    }
    inFlight = null;
  };

  const render = async (source: string, renderOptions: RenderOptions = {}): Promise<RenderResult> => {
    await load();
    const macros = renderOptions.macros ?? "";
    return new Promise<RenderResult>((resolve, reject) => {
      const settle = { resolve, reject };
      // A newer request supersedes the one waiting; both get the newer result.
      waiting = waiting
        ? { source, macros, settle: [...waiting.settle, settle] }
        : { source, macros, settle: [settle] };
      inFlight ??= drain();
    });
  };

  return {
    get status() {
      return status;
    },
    get error() {
      return error;
    },
    get progress() {
      return progress;
    },
    load,
    render,
    dispose,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
