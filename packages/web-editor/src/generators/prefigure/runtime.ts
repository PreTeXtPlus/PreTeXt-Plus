/**
 * The main-thread side of the PreFigure engine: a Web Worker running `prefig`
 * under Pyodide, started on demand and shared by every PreFigure asset on the
 * page (see `runtimeFor` in `../index.ts`).
 *
 * Renders are serialized — one in flight, the newest waiting request wins, the
 * rest resolve to it — because an author typing produces far more requests than
 * a Python engine can answer, and only the last one matters.
 */
import type { GeneratorRuntime, GeneratorRuntimeOptions, GeneratorRuntimeStatus, RenderResult } from "../types";
import { diagcessSvg, hasAnnotations } from "./outputs";
import {
  DEFAULT_PYODIDE_INDEX_URL,
  PREFIGURE_WHEELS,
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

/** Idle this long after the last render and the engine is torn down (memory). */
export const IDLE_DISPOSE_MS = 10 * 60 * 1000;

/** `Omit<…, "token">` over each member of the request union, not over the union. */
type WithoutToken<T> = T extends { token: number } ? Omit<T, "token"> : never;

type Pending = {
  resolve: (value: PrefigureWorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (message: string) => void;
};

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
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

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
    clearTimeout(idleTimer);
    worker?.terminate();
    worker = null;
    loadPromise = null;
    failAll("The PreFigure engine was shut down");
    setStatus("idle");
  };

  const touchIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(dispose, IDLE_DISPOSE_MS);
  };

  const load = (): Promise<void> => {
    if (loadPromise) return loadPromise;
    setStatus("loading", "Starting the PreFigure engine…");
    try {
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
    // The host may give a path ("/assets/prefigure/"); the worker needs absolute
    // URLs, since its own location is wherever the bundle was served from.
    const base = new URL(options.assetBaseUrl, globalThis.location?.href);
    const wheelUrls = PREFIGURE_WHEELS.map((name) => new URL(name, base).toString());
    loadPromise = send(
      { type: "load", pyodideIndexUrl: options.pyodideIndexUrl ?? DEFAULT_PYODIDE_INDEX_URL, wheelUrls },
      (message) => setStatus("loading", message),
    ).then(
      () => {
        setStatus("ready");
        touchIdle();
      },
      (cause: Error) => {
        setStatus("failed", cause.message);
        loadPromise = null;
        throw cause;
      },
    );
    return loadPromise;
  };

  // Latest-wins queue: at most one render on the worker, at most one waiting.
  let inFlight: Promise<unknown> | null = null;
  let waiting: { source: string; ref: string; settle: Pending[] } | null = null;

  const renderNow = async (source: string, ref: string): Promise<RenderResult> => {
    const response = await send({ type: "render", source });
    if (response.type !== "rendered") throw new Error("Unexpected worker response");
    const outputs = [{ filename: `${ref}.svg`, blob: new Blob([response.svg], { type: "image/svg+xml" }) }];
    // In the browser PreFigure invents annotations for a diagram that has none;
    // a build writes the companion files only for authored ones, so only those
    // are stored -- the stored set must be the set a build would have made.
    if (response.annotations && hasAnnotations(source)) {
      outputs.push(
        { filename: `${ref}-annotations.xml`, blob: new Blob([response.annotations], { type: "application/xml" }) },
        { filename: `${ref}-diagcess.svg`, blob: new Blob([diagcessSvg(response.svg)], { type: "image/svg+xml" }) },
      );
    }
    return { outputs, svg: response.svg, source };
  };

  const drain = async () => {
    while (waiting) {
      const job = waiting;
      waiting = null;
      try {
        const result = await renderNow(job.source, job.ref);
        job.settle.forEach((p) => p.resolve(result as unknown as PrefigureWorkerResponse));
      } catch (cause) {
        job.settle.forEach((p) => p.reject(cause instanceof Error ? cause : new Error(String(cause))));
      }
    }
    inFlight = null;
  };

  const render = async (source: string, ref: string): Promise<RenderResult> => {
    await load();
    touchIdle();
    const result = new Promise<RenderResult>((resolve, reject) => {
      const settle = {
        resolve: resolve as unknown as Pending["resolve"],
        reject,
      };
      if (waiting) {
        // A newer request supersedes the one waiting; both get the newer result.
        waiting = { source, ref, settle: [...waiting.settle, settle] };
      } else {
        waiting = { source, ref, settle: [settle] };
      }
      inFlight ??= drain();
    });
    return result;
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
