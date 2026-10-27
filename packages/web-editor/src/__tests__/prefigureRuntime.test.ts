/**
 * The PreFigure runtime against a scripted worker: loading narrates progress and
 * settles the status, a render comes back with the source it rendered, and
 * typing faster than the engine answers collapses onto the newest source.
 */
import { describe, it, expect, vi } from "vitest";
import { createPrefigureRuntime, type PrefigureWorkerLike } from "../generators/prefigure/runtime";
import type { PrefigureWorkerRequest, PrefigureWorkerResponse } from "../generators/prefigure/worker/protocol";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"></svg>';

class FakeWorker implements PrefigureWorkerLike {
  requests: PrefigureWorkerRequest[] = [];
  private listeners: ((event: { data: PrefigureWorkerResponse }) => void)[] = [];
  terminated = false;
  /** Renders are answered by hand (see `answerRender`), loads immediately. */
  pendingRenders: { token: number; source: string; macros: string }[] = [];

  postMessage(message: PrefigureWorkerRequest): void {
    this.requests.push(message);
    if (message.type === "load") {
      this.emit({ type: "progress", token: message.token, message: "Loading MathJax…" });
      this.emit({ type: "loaded", token: message.token });
    } else {
      this.pendingRenders.push({ token: message.token, source: message.source, macros: message.macros });
    }
  }
  addEventListener(type: "message" | "error", listener: (event: never) => void): void {
    if (type === "message") this.listeners.push(listener as (event: { data: PrefigureWorkerResponse }) => void);
  }
  terminate(): void {
    this.terminated = true;
  }
  answerRender(): void {
    const next = this.pendingRenders.shift();
    if (!next) throw new Error("no render pending");
    this.emit({ type: "rendered", token: next.token, svg: SVG, annotations: "<diagram><annotations/></diagram>" });
  }
  failRender(message: string): void {
    const next = this.pendingRenders.shift();
    if (!next) throw new Error("no render pending");
    this.emit({ type: "failed", token: next.token, message });
  }
  private emit(data: PrefigureWorkerResponse) {
    // Messages arrive asynchronously, as from a real worker.
    queueMicrotask(() => this.listeners.forEach((l) => l({ data })));
  }
}

const options = { workerUrl: "/w.js", assetBaseUrl: "https://host.test/assets/prefigure/" };

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createPrefigureRuntime", () => {
  it("loads once, reporting progress, and names the engine's files under the host's base URL", async () => {
    const worker = new FakeWorker();
    const runtime = createPrefigureRuntime(options, { createWorker: () => worker });
    const seen: string[] = [];
    runtime.subscribe(() => seen.push(`${runtime.status}:${runtime.progress ?? ""}`));
    expect(runtime.status).toBe("idle");

    await Promise.all([runtime.load(), runtime.load()]);

    expect(runtime.status).toBe("ready");
    expect(worker.requests.filter((r) => r.type === "load")).toHaveLength(1);
    const load = worker.requests[0] as Extract<PrefigureWorkerRequest, { type: "load" }>;
    expect(load.glueUrl).toBe("https://host.test/assets/prefigure/prefig_wasm.js");
    expect(load.wasmUrl).toBe("https://host.test/assets/prefigure/prefig_wasm_bg.wasm");
    expect(seen).toContain("loading:Loading MathJax…");
    runtime.dispose();
  });

  it("renders to the SVG and annotations, forwarding the macros, and reports the source rendered", async () => {
    const worker = new FakeWorker();
    const runtime = createPrefigureRuntime(options, { createWorker: () => worker });

    const result = runtime.render("<diagram/>", { macros: "\\newcommand{\\R}{\\mathbb{R}}" });
    await flush();
    expect(worker.pendingRenders[0].macros).toBe("\\newcommand{\\R}{\\mathbb{R}}");
    worker.answerRender();
    expect(await result).toEqual({ svg: SVG, annotations: "<diagram><annotations/></diagram>", source: "<diagram/>" });

    const bare = runtime.render("<diagram/>");
    await flush();
    expect(worker.pendingRenders[0].macros).toBe("");
    worker.answerRender();
    await bare;
    runtime.dispose();
  });

  it("collapses requests made while one is in flight onto the newest source", async () => {
    const worker = new FakeWorker();
    const runtime = createPrefigureRuntime(options, { createWorker: () => worker });

    const first = runtime.render("<diagram>1</diagram>");
    await flush();
    const second = runtime.render("<diagram>2</diagram>");
    const third = runtime.render("<diagram>3</diagram>");
    await flush();
    // One render on the worker; answering it starts exactly one more, for "3".
    expect(worker.pendingRenders.map((r) => r.source)).toEqual(["<diagram>1</diagram>"]);
    worker.answerRender();
    await first;
    await flush();
    expect(worker.pendingRenders.map((r) => r.source)).toEqual(["<diagram>3</diagram>"]);
    worker.answerRender();
    const [r2, r3] = await Promise.all([second, third]);
    expect(r2.source).toBe("<diagram>3</diagram>");
    expect(r3).toBe(r2);
    runtime.dispose();
  });

  it("rejects a render with the engine's message and stays ready", async () => {
    const worker = new FakeWorker();
    const runtime = createPrefigureRuntime(options, { createWorker: () => worker });
    const render = runtime.render("<diagram");
    await flush();
    worker.failRender("PreFigure source is not well-formed XML");
    await expect(render).rejects.toThrow(/not well-formed/);
    expect(runtime.status).toBe("ready");
    runtime.dispose();
  });

  it("dispose terminates the worker and returns to idle", async () => {
    const worker = new FakeWorker();
    const runtime = createPrefigureRuntime(options, { createWorker: () => worker });
    await runtime.load();
    runtime.dispose();
    expect(worker.terminated).toBe(true);
    expect(runtime.status).toBe("idle");
  });

  it("a worker that cannot be created fails the load", async () => {
    const runtime = createPrefigureRuntime(options, {
      createWorker: () => {
        throw new Error("blocked");
      },
    });
    await expect(runtime.load()).rejects.toThrow("blocked");
    expect(runtime.status).toBe("failed");
    expect(runtime.error).toBe("blocked");
  });

  vi.useRealTimers();
});
