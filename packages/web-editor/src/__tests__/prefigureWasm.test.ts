/**
 * The real PreFigure engine (vendor/prefigure in the Rails app, the wasm build
 * this worker loads in the browser) driven through the worker handler with a
 * stub host, so a vendored build that no longer matches the handler's
 * expectations — a renamed export, a changed result shape, a different
 * version — fails here rather than in an author's browser. Skipped when the
 * engine is not vendored.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import {
  handlePrefigureWorkerRequest,
  resetPrefigureEngineForTests,
  type PrefigHostApi,
  type PrefigWasmModule,
} from "../generators/prefigure/worker/handler";
import { PREFIG_WASM_BINARY, PREFIG_WASM_GLUE, PREFIG_WASM_VERSION, type PrefigureWorkerResponse } from "../generators/prefigure/worker/protocol";
import { PREFIGURE_STARTER_SOURCE } from "../generators/prefigure/definition";

const vendor = resolve(__dirname, "../../../../vendor/prefigure");
const glue = resolve(vendor, PREFIG_WASM_GLUE);
const binary = resolve(vendor, PREFIG_WASM_BINARY);

/** What the engine asks for, answered with made-up but well-formed values. */
const stubHost: PrefigHostApi & { math: string[] } = {
  math: [],
  measure_text: (text) => [6 * text.length, 8, 2],
  translate_text: (text) => text,
  processMath(expression) {
    this.math.push(expression);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><text>m</text></svg>';
  },
  processBraille: () => "",
  setMacros() {},
};

const run = async (request: Parameters<typeof handlePrefigureWorkerRequest>[0]) => {
  const responses: PrefigureWorkerResponse[] = [];
  await handlePrefigureWorkerRequest(request, (r) => responses.push(r), {
    importGlue: async () => {
      const mod = (await import(/* @vite-ignore */ pathToFileURL(glue).href)) as PrefigWasmModule;
      // Node has no fetch for file URLs: hand the glue the bytes instead of the URL.
      return { ...mod, default: () => mod.default({ module_or_path: readFileSync(binary) }) };
    },
    createHostApi: async () => stubHost,
  });
  return responses;
};

describe.skipIf(!existsSync(binary))("the vendored PreFigure engine", () => {
  beforeAll(async () => {
    resetPrefigureEngineForTests();
    const responses = await run({ type: "load", token: 1, glueUrl: glue, wasmUrl: binary });
    expect(responses[responses.length - 1]).toEqual({ type: "loaded", token: 1 });
  });

  it("is the version the worker expects", async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(glue).href)) as PrefigWasmModule;
    expect(mod.version()).toBe(PREFIG_WASM_VERSION);
  });

  it("renders the starter diagram, asking the host to typeset its label", async () => {
    const [response] = await run({ type: "render", token: 2, source: PREFIGURE_STARTER_SOURCE, macros: "" });
    expect(response.type).toBe("rendered");
    if (response.type !== "rendered") return;
    expect(response.svg).toMatch(/^<svg/);
    expect(response.svg).toContain("<path");
    expect(stubHost.math).toContain("(1, f(1))");
  });

  it("reports a malformed diagram as the engine's own message", async () => {
    const [response] = await run({ type: "render", token: 3, source: "<diagram", macros: "" });
    expect(response.type).toBe("failed");
    if (response.type === "failed") expect(response.message).not.toBe("");
  });
});
