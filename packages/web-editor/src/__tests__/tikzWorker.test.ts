/**
 * The TikZ worker's handler with a stub engine: what it asks of the library and
 * how it reads the answer. The real engine is `tikzEngine.test.ts`'s.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  handleTikzWorkerRequest,
  resetTikzEngineForTests,
  type TikzEngine,
  type TikzLatexResult,
} from "../generators/tikz/worker/handler";
import type { TikzWorkerResponse } from "../generators/tikz/worker/protocol";

const SVG = "<svg xmlns='http://www.w3.org/2000/svg'/>";
const last = <T,>(items: T[]) => items[items.length - 1];
const ok: TikzLatexResult = { status: "ok", pages: [SVG], texLog: "This is pdfTeX", log: "" };

function stubEngine(result: TikzLatexResult | (() => Promise<TikzLatexResult>)) {
  const output: ((line: string) => void)[] = [];
  const engine = {
    latex: vi.fn(async () => (typeof result === "function" ? result() : result)),
    on: vi.fn((_event: "log", listener: (line: string) => void) => {
      output.push(listener);
      return () => {};
    }),
    print: (line: string) => output.forEach((listener) => listener(line)),
  };
  return engine as typeof engine & TikzEngine;
}

const drive = async (
  engine: TikzEngine,
  render: { source: string; preamble?: string; macros?: string } = { source: "\\tikz;" },
) => {
  const posted: TikzWorkerResponse[] = [];
  const post = (response: TikzWorkerResponse) => posted.push(response);
  const deps = { createEngine: async () => engine };
  await handleTikzWorkerRequest({ type: "load", token: 1, baseUrl: "https://host.test/e/" }, post, deps);
  await handleTikzWorkerRequest({ type: "render", token: 2, preamble: "", macros: "", ...render }, post, deps);
  return posted;
};

describe("handleTikzWorkerRequest", () => {
  afterEach(() => resetTikzEngineForTests());

  it("starts the engine once and narrates the first load", async () => {
    const createEngine = vi.fn(async () => stubEngine(ok));
    const posted: TikzWorkerResponse[] = [];
    const post = (response: TikzWorkerResponse) => posted.push(response);
    await handleTikzWorkerRequest({ type: "load", token: 1, baseUrl: "https://host.test/e/" }, post, { createEngine });
    await handleTikzWorkerRequest({ type: "load", token: 2, baseUrl: "https://host.test/e/" }, post, { createEngine });

    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(createEngine).toHaveBeenCalledWith("https://host.test/e/");
    expect(posted[0]).toMatchObject({ type: "progress", message: expect.stringContaining("few megabytes") });
    expect(posted.filter((response) => response.type === "loaded")).toHaveLength(2);
  });

  it("reports an engine that would not start, and lets a later load try again", async () => {
    const posted: TikzWorkerResponse[] = [];
    const post = (response: TikzWorkerResponse) => posted.push(response);
    const load = { type: "load", token: 1, baseUrl: "https://host.test/e/" } as const;
    await handleTikzWorkerRequest(load, post, {
      createEngine: async () => {
        throw new Error("404");
      },
    });
    expect(last(posted)).toMatchObject({ type: "failed", message: "404" });

    await handleTikzWorkerRequest(load, post, { createEngine: async () => stubEngine(ok) });
    expect(last(posted)).toMatchObject({ type: "loaded" });
  });

  it("refuses a render before the engine is up", async () => {
    const posted: TikzWorkerResponse[] = [];
    await handleTikzWorkerRequest(
      { type: "render", token: 1, source: "", preamble: "", macros: "" },
      (response) => posted.push(response),
    );
    expect(posted[0]).toMatchObject({ type: "failed", message: "The TikZ engine is not loaded" });
  });

  it("compiles the whole document with pdfTeX, glyphs as paths, and answers with the page", async () => {
    const engine = stubEngine(ok);
    const posted = await drive(engine, { source: "\\tikz\\draw (0,0);", preamble: "\\usepackage{tikz-cd}" });

    const [document, options] = engine.latex.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(document).toContain("\\usepackage{tikz-cd}");
    expect(document).toContain("\\tikz\\draw (0,0);");
    expect(options).toEqual({ engine: "latex", fonts: "paths", bbox: "papersize" });
    expect(last(posted)).toEqual({ type: "rendered", token: 2, svg: SVG, annotations: null });
  });

  it("fails a run TeX reported errors in, even if a page came out of it", async () => {
    const log = "! Undefined control sequence.\nl.9 \\oops\n";
    const posted = await drive(stubEngine({ status: "error", pages: [SVG], texLog: log, log: "" }));
    const response = last(posted);
    expect(response).toMatchObject({ type: "failed", token: 2, log });
    expect(response).toMatchObject({ message: expect.stringContaining("! Undefined control sequence.") });
  });

  it("falls back to what TeX printed when it wrote no transcript", async () => {
    const posted = await drive(stubEngine({ status: "fatal", pages: [], texLog: "", log: "! I can't find the format file" }));
    expect(last(posted)).toMatchObject({ type: "failed", log: "! I can't find the format file" });
  });

  it("reports an engine that threw", async () => {
    const engine = stubEngine(async () => {
      throw new Error("memory access out of bounds");
    });
    expect(last(await drive(engine))).toMatchObject({ type: "failed", message: "memory access out of bounds" });
  });

  // The runtime's stall timer hears from the worker this way; the engine's
  // output between files would otherwise leave it silent.
  it("says it is alive while TeX prints, at most about once a second", async () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    const engine = stubEngine(ok);
    engine.latex.mockImplementation(async () => {
      engine.print("(a.sty");
      engine.print("(b.sty");
      return ok;
    });
    const posted = await drive(engine);
    expect(posted.filter((response) => response.type === "progress" && response.token === 2)).toHaveLength(1);
    vi.restoreAllMocks();
  });
});
