/**
 * @vitest-environment jsdom
 *
 * The TikZ runtime against a scripted worker: what it sends the engine, that a
 * picture is sanitized before anyone sees it, and that TeX, which can loop on
 * its input, is stopped without taking the runtime with it. The queue itself is
 * the shared runtime's, covered by `prefigureRuntime.test.ts`.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createTikzRuntime, TIKZ_RENDER_LIMIT_MS, TIKZ_STALL_MS, type TikzWorkerLike } from "../generators/tikz/runtime";
import type { TikzWorkerRequest, TikzWorkerResponse } from "../generators/tikz/worker/protocol";
import { GeneratorRenderError } from "../generators";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0"/></svg>';

class FakeWorker implements TikzWorkerLike {
  requests: TikzWorkerRequest[] = [];
  private listeners: ((event: { data: TikzWorkerResponse }) => void)[] = [];
  private errorListeners: ((event: { message?: string }) => void)[] = [];
  terminated = false;

  postMessage(message: TikzWorkerRequest): void {
    this.requests.push(message);
    if (message.type === "load") this.emit({ type: "loaded", token: message.token });
  }
  addEventListener(type: "message" | "error", listener: (event: never) => void): void {
    if (type === "message") this.listeners.push(listener as (event: { data: TikzWorkerResponse }) => void);
    else this.errorListeners.push(listener as (event: { message?: string }) => void);
  }
  /** An uncaught error in the worker, as the browser reports it. */
  crash(message: string) {
    queueMicrotask(() => this.errorListeners.forEach((listener) => listener({ message })));
  }
  terminate(): void {
    this.terminated = true;
  }
  get lastRender() {
    const renders = this.requests.filter((request) => request.type === "render");
    return renders[renders.length - 1] as Extract<TikzWorkerRequest, { type: "render" }>;
  }
  emit(data: TikzWorkerResponse) {
    queueMicrotask(() => this.listeners.forEach((listener) => listener({ data })));
  }
  answer(svg = SVG) {
    this.emit({ type: "rendered", token: this.lastRender.token, svg, annotations: null });
  }
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("createTikzRuntime", () => {
  let workers: FakeWorker[];
  const start = () =>
    createTikzRuntime(
      { workerUrl: "/w.js", baseUrl: "https://host.test/engines/mp-tikz-wasm-0.5.0" },
      {
        createWorker: () => {
          const worker = new FakeWorker();
          workers.push(worker);
          return worker;
        },
      },
    );

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
  });
  afterEach(() => vi.useRealTimers());

  it("fails to load, without starting a worker, when the host gave no engine URL", async () => {
    const createWorker = vi.fn(() => new FakeWorker());
    const runtime = createTikzRuntime({ workerUrl: "/w.js" }, { createWorker });
    await expect(runtime.load()).rejects.toThrow("no URL for the TikZ engine");
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("hands the worker the engine's directory, as a directory", async () => {
    const runtime = start();
    await runtime.load();
    expect(workers[0].requests[0]).toMatchObject({ baseUrl: "https://host.test/engines/mp-tikz-wasm-0.5.0/" });
    runtime.dispose();
  });

  it("sends the source with the docinfo's preamble and macros", async () => {
    const runtime = start();
    const result = runtime.render("\\tikz;", {
      docinfo: { macros: "\\def\\a{1}", "latex-image-preamble": "\\usepackage{tikz-cd}" },
    });
    await flush();
    expect(workers[0].lastRender).toMatchObject({
      source: "\\tikz;",
      macros: "\\def\\a{1}",
      preamble: "\\usepackage{tikz-cd}",
    });
    workers[0].answer();
    await result;
    runtime.dispose();
  });

  it("sanitizes the picture before anyone sees it", async () => {
    const runtime = start();
    const result = runtime.render("\\tikz;");
    await flush();
    workers[0].answer(SVG.replace("</svg>", "<script>alert(1)</script></svg>"));
    const { svg } = await result;
    expect(svg).not.toContain("script");
    expect(svg).toContain("<path");
    runtime.dispose();
  });

  it("rejects a failed run with its excerpt and transcript", async () => {
    const runtime = start();
    const result = runtime.render("\\tikz;");
    await flush();
    workers[0].emit({ type: "failed", token: workers[0].lastRender.token, message: "! Oops", log: "the whole log" });
    const error = await result.catch((cause) => cause);
    expect(error).toBeInstanceOf(GeneratorRenderError);
    expect(error).toMatchObject({ message: "! Oops", log: "the whole log" });
    expect(runtime.status).toBe("ready");
    runtime.dispose();
  });

  it("stops a run that has gone silent, and starts afresh on the next render", async () => {
    const runtime = start();
    const statuses: string[] = [];
    const hung = runtime.render("\\def\\a{\\a}\\a").catch((cause) => cause);
    await flush();
    runtime.subscribe(() => statuses.push(runtime.status));

    await vi.advanceTimersByTimeAsync(TIKZ_STALL_MS);
    expect((await hung).message).toContain("stopped responding");
    expect(workers[0].terminated).toBe(true);
    // No status change: the pane would render the same source again and hang again.
    expect(runtime.status).toBe("ready");
    expect(statuses).toEqual([]);

    const next = runtime.render("\\tikz;");
    await flush();
    expect(workers).toHaveLength(2);
    workers[1].answer();
    expect((await next).source).toBe("\\tikz;");
    // The restart was as quiet as the stop: a loading→ready round trip would
    // have the pane render the same source a second time.
    expect(statuses).toEqual([]);
    expect(runtime.status).toBe("ready");
    runtime.dispose();
  });

  it("reports a restart that fails, quiet or not", async () => {
    const runtime = start();
    const hung = runtime.render("hangs").catch((cause) => cause);
    await flush();
    await vi.advanceTimersByTimeAsync(TIKZ_STALL_MS);
    await hung;

    const next = runtime.render("\\tikz;").catch((cause) => cause);
    await flush();
    workers[1].crash("out of memory");
    expect((await next).message).toBe("out of memory");
    expect(runtime.status).toBe("failed");
    expect(runtime.error).toBe("out of memory");
    runtime.dispose();
  });

  it("stops a worker that crashes, and lets nothing it says afterwards reach the next one", async () => {
    const runtime = start();
    const crashed = runtime.render("\\tikz;").catch((cause) => cause);
    await flush();
    workers[0].crash("RuntimeError: unreachable");
    expect((await crashed).message).toBe("RuntimeError: unreachable");
    expect(workers[0].terminated).toBe(true);
    expect(runtime.status).toBe("failed");

    await runtime.load();
    expect(workers).toHaveLength(2);
    expect(runtime.status).toBe("ready");
    const next = runtime.render("\\tikz;");
    await flush();
    // The first worker's events must not fail the second worker's render.
    workers[0].crash("late");
    workers[0].emit({ type: "failed", token: workers[1].lastRender.token, message: "stale" });
    await flush();
    expect(runtime.status).toBe("ready");
    workers[1].answer();
    expect((await next).source).toBe("\\tikz;");
    runtime.dispose();
  });

  it("does not stop a run the worker is still reporting on", async () => {
    const runtime = start();
    const result = runtime.render("\\tikz;");
    await flush();
    for (let elapsed = 0; elapsed < 3 * TIKZ_STALL_MS; elapsed += TIKZ_STALL_MS / 2) {
      await vi.advanceTimersByTimeAsync(TIKZ_STALL_MS / 2);
      workers[0].emit({ type: "progress", token: workers[0].lastRender.token, message: "Typesetting…" });
      await flush();
    }
    expect(workers[0].terminated).toBe(false);
    workers[0].answer();
    await result;
    runtime.dispose();
  });

  it("counts the engine's own messages, which answer nothing, as life", async () => {
    const runtime = start();
    const result = runtime.render("\\tikz;");
    await flush();
    await vi.advanceTimersByTimeAsync(TIKZ_STALL_MS - 1);
    workers[0].emit({ event: "progress" } as unknown as TikzWorkerResponse);
    await flush();
    await vi.advanceTimersByTimeAsync(TIKZ_STALL_MS - 1);
    expect(workers[0].terminated).toBe(false);
    workers[0].answer();
    await result;
    runtime.dispose();
  });

  it("stops a run that prints forever", async () => {
    const runtime = start();
    const looping = runtime.render("\\loop\\message{x}\\iftrue\\repeat").catch((cause) => cause);
    await flush();
    for (let elapsed = 0; elapsed <= TIKZ_RENDER_LIMIT_MS; elapsed += TIKZ_STALL_MS / 2) {
      workers[0].emit({ type: "progress", token: workers[0].lastRender.token, message: "Typesetting…" });
      await vi.advanceTimersByTimeAsync(TIKZ_STALL_MS / 2);
    }
    expect((await looping).message).toContain("still running");
    expect(workers[0].terminated).toBe(true);
    runtime.dispose();
  });

  it("restarts for a render that was waiting when the watchdog fired", async () => {
    const runtime = start();
    const hung = runtime.render("hangs").catch((cause) => cause);
    await flush();
    const next = runtime.render("next");
    await flush();

    await vi.advanceTimersByTimeAsync(TIKZ_STALL_MS);
    await hung;
    await flush();
    expect(workers).toHaveLength(2);
    expect(workers[1].lastRender.source).toBe("next");
    workers[1].answer();
    expect((await next).source).toBe("next");
    runtime.dispose();
  });
});
