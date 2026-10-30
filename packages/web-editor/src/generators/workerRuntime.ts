/**
 * The main-thread side of a generator's engine, whatever the engine: a Web
 * Worker started on demand and shared by every asset of that generator on the
 * page (see `runtimeFor` in `./index.ts`).
 *
 * Renders are serialized — one in flight, the newest waiting request wins, the
 * rest resolve to it — because an author typing produces more requests than an
 * engine answers, and only the last one matters.
 */
import type {
  DocinfoInputs,
  GeneratorRuntime,
  GeneratorRuntimeStatus,
  RenderOptions,
  RenderResult,
} from "./types";
import type { GeneratorWorkerResponse } from "./workerProtocol";

/** A render the engine refused, with its transcript when it keeps one. */
export class GeneratorRenderError extends Error {
  readonly log: string | undefined;
  constructor(message: string, log?: string) {
    super(message);
    this.name = "GeneratorRenderError";
    this.log = log;
  }
}

/** The part of `Worker` this module uses, so a test can stand one in. */
export interface GeneratorWorkerLike<Request> {
  postMessage(message: Request): void;
  addEventListener(type: "message", listener: (event: { data: GeneratorWorkerResponse }) => void): void;
  addEventListener(type: "error", listener: (event: { message?: string }) => void): void;
  terminate(): void;
}

/** `Omit<…, "token">` over each member of the request union, not over the union. */
export type WithoutToken<T> = T extends { token: number } ? Omit<T, "token"> : never;

export interface WorkerRuntimeConfig<Request> {
  /** The engine's name in status and error messages: "PreFigure". */
  label: string;
  createWorker: () => GeneratorWorkerLike<Request>;
  /** The worker's `load` message. Throwing fails the load before any worker starts. */
  loadRequest: () => WithoutToken<Request>;
  renderRequest: (source: string, docinfo: DocinfoInputs) => WithoutToken<Request>;
  /** Applied to each picture here on the main thread, where there is a DOM. A throw fails the render. */
  finishSvg?: (svg: string) => string;
  /**
   * How long a render may go on, for an engine that can hang on its input: it is
   * stopped after `stallMs` with no message from the worker, and after `limitMs`
   * in any case. A stopped worker cannot be asked to stop, so it is terminated;
   * the next render starts a new one.
   */
  watchdog?: { stallMs: number; limitMs: number };
}

type Pending = {
  resolve: (value: GeneratorWorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (message: string) => void;
};

type Settle = { resolve: (value: RenderResult) => void; reject: (error: Error) => void };

export function createWorkerRuntime<Request>(config: WorkerRuntimeConfig<Request>): GeneratorRuntime {
  const { label, watchdog } = config;

  let worker: GeneratorWorkerLike<Request> | null = null;
  let status: GeneratorRuntimeStatus = "idle";
  let error: string | undefined;
  let progress: string | undefined;
  let loadPromise: Promise<void> | null = null;
  let nextToken = 1;
  // Restarts the stall timer while a render is on the worker.
  let heartbeat: (() => void) | null = null;
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
    request: WithoutToken<Request>,
    onProgress?: (message: string) => void,
  ): Promise<GeneratorWorkerResponse> =>
    new Promise((resolve, reject) => {
      if (!worker) {
        reject(new Error(`The ${label} engine is not running`));
        return;
      }
      const token = nextToken++;
      pending.set(token, { resolve, reject, onProgress });
      worker.postMessage({ ...request, token } as Request);
    });

  const handleMessage = ({ data }: { data: GeneratorWorkerResponse }) => {
    // Any message counts as life, even one that answers nothing here: the TeX
    // library posts its own while it fetches files in the middle of a run.
    heartbeat?.();
    const entry = pending.get(data.token);
    if (!entry) return;
    if (data.type === "progress") {
      entry.onProgress?.(data.message);
      return;
    }
    pending.delete(data.token);
    if (data.type === "failed") entry.reject(new GeneratorRenderError(data.message, data.log));
    else entry.resolve(data);
  };

  const stopWorker = (message: string) => {
    worker?.terminate();
    worker = null;
    loadPromise = null;
    failAll(message);
  };

  const dispose = () => {
    stopWorker(`The ${label} engine was shut down`);
    setStatus("idle");
  };

  const load = (): Promise<void> => {
    if (loadPromise) return loadPromise;
    setStatus("loading", `Starting the ${label} engine…`);
    let loadRequest: WithoutToken<Request>;
    try {
      loadRequest = config.loadRequest();
      worker = config.createWorker();
    } catch (cause) {
      setStatus("failed", cause instanceof Error ? cause.message : String(cause));
      return Promise.reject(new Error(error));
    }
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", (event) => {
      const message = event.message || `The ${label} worker failed to start`;
      failAll(message);
      setStatus("failed", message);
      loadPromise = null;
    });
    loadPromise = send(loadRequest, (message) => setStatus("loading", message)).then(
      () => setStatus("ready"),
      (cause: Error) => {
        setStatus("failed", cause.message);
        loadPromise = null;
        throw cause;
      },
    );
    return loadPromise;
  };

  /** Watch a render on the worker. Returns the call that stops watching. */
  const watchRender = (): (() => void) => {
    if (!watchdog) return () => {};
    // The status stays as it is. A change would make the pane render again, and
    // the same source would hang the same way; the next edit restarts the worker.
    const stop = (reason: string) =>
      stopWorker(`${reason}. Does the source loop forever? The next edit tries again.`);
    let stall: ReturnType<typeof setTimeout>;
    heartbeat = () => {
      clearTimeout(stall);
      stall = setTimeout(
        () => stop(`The ${label} engine stopped responding after ${watchdog.stallMs / 1000} seconds`),
        watchdog.stallMs,
      );
    };
    heartbeat();
    const limit = setTimeout(
      () => stop(`The ${label} engine was still running after ${watchdog.limitMs / 1000} seconds`),
      watchdog.limitMs,
    );
    return () => {
      clearTimeout(stall);
      clearTimeout(limit);
      heartbeat = null;
    };
  };

  // Latest-wins queue: at most one render on the worker, at most one waiting.
  let inFlight: Promise<void> | null = null;
  let waiting: { source: string; docinfo: DocinfoInputs; settle: Settle[] } | null = null;

  const renderNow = async (source: string, docinfo: DocinfoInputs): Promise<RenderResult> => {
    // The watchdog may have stopped the worker since this job was queued.
    await load();
    const unwatch = watchRender();
    try {
      const response = await send(config.renderRequest(source, docinfo));
      if (response.type !== "rendered") throw new Error("Unexpected worker response");
      const svg = config.finishSvg ? config.finishSvg(response.svg) : response.svg;
      return { svg, annotations: response.annotations, source };
    } finally {
      unwatch();
    }
  };

  const drain = async () => {
    while (waiting) {
      const job = waiting;
      waiting = null;
      try {
        const result = await renderNow(job.source, job.docinfo);
        job.settle.forEach((p) => p.resolve(result));
      } catch (cause) {
        job.settle.forEach((p) => p.reject(cause instanceof Error ? cause : new Error(String(cause))));
      }
    }
    inFlight = null;
  };

  const render = async (source: string, renderOptions: RenderOptions = {}): Promise<RenderResult> => {
    await load();
    const docinfo = renderOptions.docinfo ?? {};
    return new Promise<RenderResult>((resolve, reject) => {
      const settle = { resolve, reject };
      // A newer request supersedes the one waiting; both get the newer result.
      waiting = waiting
        ? { source, docinfo, settle: [...waiting.settle, settle] }
        : { source, docinfo, settle: [settle] };
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
