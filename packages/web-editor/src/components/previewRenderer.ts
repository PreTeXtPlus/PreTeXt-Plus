/**
 * Where a preview is rendered: on this thread, or in a Web Worker.
 *
 * The renderer runs the PreTeXt stylesheets through libxslt compiled to
 * WebAssembly, and a WASM transform does not yield — JSPI suspends it only
 * to fetch a stylesheet. On the main thread, every render therefore freezes
 * the editor for as long as the transform takes: tolerable for one section,
 * not for a chapter (seconds, on a large one). In a worker the same render
 * costs the editor nothing but the wait.
 *
 * The worker is the *host's* to bundle and serve, which is why this module
 * takes a URL rather than constructing one itself: this package is bundled
 * from source by its host, whose bundler decides where a second entry point
 * lands (the Rails app builds `preview-worker` as a second esbuild entry).
 * A host that serves none renders inline, exactly as before.
 *
 * Messages carry plain data only — the source and options in, the rendered
 * page and its source map out — so the worker side (previewWorkerHandler.ts)
 * is the same `renderPreviewHtml` behind a `postMessage`.
 */
import {
  renderPreviewHtml,
  type LocalRenderOptions,
  type PreviewRender,
} from "./wasmPreview";

/** Something that can turn PreTeXt into a preview page. */
export interface PreviewRenderer {
  render(source: string, options: LocalRenderOptions): Promise<PreviewRender>;
}

/** Main thread → worker. */
export type PreviewWorkerRequest = {
  type: "render";
  token: number;
  source: string;
  options: LocalRenderOptions;
};

/** Worker → main thread. */
export type PreviewWorkerResponse =
  | { type: "rendered"; token: number; result: PreviewRender }
  | { type: "failed"; token: number; message: string }
  /**
   * The worker cannot render at all — no JSPI in its engine. Sent once, in
   * answer to the first request; the main thread then renders inline.
   */
  | { type: "unavailable" };

/**
 * The part of `Worker` this module uses, so a test can stand one in without
 * a browser. `addEventListener("error")` covers a worker script that failed
 * to load or threw at the top level.
 */
export interface PreviewWorkerLike {
  postMessage(message: PreviewWorkerRequest): void;
  addEventListener(
    type: "message",
    listener: (event: { data: PreviewWorkerResponse }) => void,
  ): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  terminate(): void;
}

/** Renders on the calling thread. */
export const inlinePreviewRenderer: PreviewRenderer = {
  render: (source, options) => renderPreviewHtml(source, options),
};

/**
 * A renderer that hands each render to a worker and settles the matching
 * promise when the answer comes back. Requests are matched by token, since
 * the worker answers in the order it renders (one at a time) and the caller
 * may have given up on an earlier one.
 *
 * Falls back to {@link inlinePreviewRenderer} — for the requests in flight
 * and every one after — when the worker reports it cannot render or dies
 * before answering. The worker is made lazily, on the first render, so a
 * preview that is never opened costs no thread.
 */
export function createWorkerPreviewRenderer(
  makeWorker: () => PreviewWorkerLike,
): PreviewRenderer {
  let worker: PreviewWorkerLike | null | undefined;
  let fallback: PreviewRenderer | null = null;
  let nextToken = 0;
  const pending = new Map<
    number,
    {
      source: string;
      options: LocalRenderOptions;
      resolve: (result: PreviewRender) => void;
      reject: (error: Error) => void;
    }
  >();

  /** Give up on the worker: answer everything in flight inline, and the rest too. */
  const abandonWorker = () => {
    if (fallback) return;
    fallback = inlinePreviewRenderer;
    worker?.terminate();
    worker = null;
    const inFlight = [...pending.values()];
    pending.clear();
    for (const request of inFlight) {
      fallback.render(request.source, request.options).then(request.resolve, request.reject);
    }
  };

  const ensureWorker = (): PreviewWorkerLike | null => {
    if (worker !== undefined) return worker;
    try {
      worker = makeWorker();
    } catch (error) {
      console.warn("PreTeXt preview: could not start the render worker", error);
      worker = null;
      return null;
    }
    worker.addEventListener("message", ({ data }) => {
      if (data.type === "unavailable") {
        abandonWorker();
        return;
      }
      const request = pending.get(data.token);
      if (!request) return;
      pending.delete(data.token);
      if (data.type === "rendered") request.resolve(data.result);
      else request.reject(new Error(data.message));
    });
    worker.addEventListener("error", (event) => {
      console.warn("PreTeXt preview: the render worker failed", event);
      abandonWorker();
    });
    return worker;
  };

  return {
    render(source, options) {
      if (fallback) return fallback.render(source, options);
      const target = ensureWorker();
      if (!target) {
        abandonWorker();
        return inlinePreviewRenderer.render(source, options);
      }
      return new Promise<PreviewRender>((resolve, reject) => {
        const token = ++nextToken;
        pending.set(token, { source, options, resolve, reject });
        target.postMessage({ type: "render", token, source, options });
      });
    },
  };
}

// One renderer per worker URL for the life of the page. A worker's first
// render compiles the stylesheets (~400ms); remounting the preview — a tab
// switch on a narrow screen does that — must not pay it again.
const workerRenderers = new Map<string, PreviewRenderer>();

/**
 * The renderer for a host's worker URL: a worker-backed one when the host
 * gave a URL and this engine has workers, else inline.
 */
export function previewRendererFor(workerUrl: string | undefined): PreviewRenderer {
  if (!workerUrl || typeof Worker === "undefined") return inlinePreviewRenderer;
  let renderer = workerRenderers.get(workerUrl);
  if (!renderer) {
    renderer = createWorkerPreviewRenderer(
      () => new Worker(workerUrl, { type: "module", name: "pretext-preview" }),
    );
    workerRenderers.set(workerUrl, renderer);
  }
  return renderer;
}
