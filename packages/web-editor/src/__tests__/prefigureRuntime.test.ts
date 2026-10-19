/**
 * The PreFigure runtime against a scripted worker: loading narrates progress and
 * settles the status, a render becomes the files a build would name, and typing
 * faster than the engine answers collapses onto the newest source.
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
  pendingRenders: { token: number; source: string }[] = [];
  annotated = false;

  postMessage(message: PrefigureWorkerRequest): void {
    this.requests.push(message);
    if (message.type === "load") {
      this.emit({ type: "progress", token: message.token, message: "Loading scipy…" });
      this.emit({ type: "loaded", token: message.token });
    } else {
      this.pendingRenders.push({ token: message.token, source: message.source });
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
    this.emit({
      type: "rendered",
      token: next.token,
      svg: SVG,
      annotations: this.annotated ? "<diagram><annotations/></diagram>" : null,
    });
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
  it("loads once, reporting progress, and asks for the wheels under the host's base URL", async () => {
    const worker = new FakeWorker();
    const runtime = createPrefigureRuntime(options, { createWorker: () => worker });
    const seen: string[] = [];
    runtime.subscribe(() => seen.push(`${runtime.status}:${runtime.progress ?? ""}`));
    expect(runtime.status).toBe("idle");

    await Promise.all([runtime.load(), runtime.load()]);

    expect(runtime.status).toBe("ready");
    expect(worker.requests.filter((r) => r.type === "load")).toHaveLength(1);
    const load = worker.requests[0] as Extract<PrefigureWorkerRequest, { type: "load" }>;
    expect(load.wheelUrls).toEqual([
      "https://host.test/assets/prefigure/prefig-0.7.9-py3-none-any.whl",
      "https://host.test/assets/prefigure/segno-1.6.6-py3-none-any.whl",
    ]);
    expect(load.pyodideIndexUrl).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/pyodide\/v0\.26\.4\//);
    expect(seen).toContain("loading:Loading scipy…");
    runtime.dispose();
  });

  it("renders to the files a build names, with companions only for an annotated diagram", async () => {
    const worker = new FakeWorker();
    const runtime = createPrefigureRuntime(options, { createWorker: () => worker });

    const plain = runtime.render("<diagram/>", "fig");
    await flush();
    worker.answerRender();
    const result = await plain;
    expect(result.outputs.map((o) => o.filename)).toEqual(["fig.svg"]);
    expect(result.svg).toBe(SVG);
    expect(result.source).toBe("<diagram/>");
    expect(await result.outputs[0].blob.text()).toBe(SVG);
    expect(result.outputs[0].blob.type).toBe("image/svg+xml");

    // The engine volunteers annotations for every diagram; only an authored
    // <annotations> makes them part of the output set.
    worker.annotated = true;
    const unauthored = runtime.render("<diagram/>", "fig");
    await flush();
    worker.answerRender();
    expect((await unauthored).outputs.map((o) => o.filename)).toEqual(["fig.svg"]);

    const annotated = runtime.render("<diagram><annotations/></diagram>", "fig");
    await flush();
    worker.answerRender();
    const outputs = (await annotated).outputs;
    expect(outputs.map((o) => o.filename)).toEqual(["fig.svg", "fig-annotations.xml", "fig-diagcess.svg"]);
    expect(await outputs[2].blob.text()).toContain('style="aspect-ratio: 10 / 20;"');
    runtime.dispose();
  });

  it("collapses requests made while one is in flight onto the newest source", async () => {
    const worker = new FakeWorker();
    const runtime = createPrefigureRuntime(options, { createWorker: () => worker });

    const first = runtime.render("<diagram>1</diagram>", "fig");
    await flush();
    const second = runtime.render("<diagram>2</diagram>", "fig");
    const third = runtime.render("<diagram>3</diagram>", "fig");
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
    const render = runtime.render("<diagram", "fig");
    await flush();
    worker.failRender("ValueError: PreFigure source is not well-formed XML");
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
