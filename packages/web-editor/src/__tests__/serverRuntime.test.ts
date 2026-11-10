/**
 * The runtime for a generator rendered on the host's build server: ready at
 * once, one host call per render, the picture sanitized, and a failure's log
 * carried through.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { createServerRuntime } from "../generators/serverRuntime";
import { GeneratorRenderError, generators, type ServerRenderRequest } from "../generators";
import { createRenderQueue } from "../generators/renderQueue";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>';

describe("createServerRuntime", () => {
  it("is ready without loading anything", async () => {
    const runtime = createServerRuntime({ generator: "sageplot", label: "Sage" }, { render: vi.fn() });
    expect(runtime.status).toBe("ready");
    await runtime.load();
    expect(runtime.status).toBe("ready");
  });

  it("asks the host to render the source under the asset's ref, with the docinfo pieces, and reports progress", async () => {
    const requests: ServerRenderRequest[] = [];
    const render = vi.fn(async (request: ServerRenderRequest) => {
      requests.push(request);
      request.onProgress?.("queued");
      return { svg: "<svg/>" };
    });
    const runtime = createServerRuntime({ generator: "asymptote", label: "Asymptote" }, { render });
    const progress: string[] = [];

    const result = await runtime.render("draw(unitcircle);", {
      ref: "circle",
      docinfo: { macros: "\\R", "asymptote-preamble": "import graph;" },
      onProgress: (message) => progress.push(message),
    });

    expect(requests).toEqual([
      expect.objectContaining({
        generator: "asymptote",
        ref: "circle",
        source: "draw(unitcircle);",
        docinfo: { macros: "\\R", "asymptote-preamble": "import graph;" },
      }),
    ]);
    expect(progress).toEqual(["queued"]);
    expect(result).toEqual({ svg: "<svg/>", annotations: null, source: "draw(unitcircle);" });
  });

  it("sanitizes the picture before anyone sees it", async () => {
    const runtime = generators.asymptote.createRuntime!({ render: async () => ({ svg: SVG }) });
    const result = await runtime.render("draw(unitcircle);", { ref: "circle" });
    expect(result.svg).not.toContain("<script");
    expect(result.svg).toContain("<rect");
  });

  it("refuses a render with no ref, and one with no host render", async () => {
    const runtime = createServerRuntime({ generator: "sageplot", label: "Sage" }, { render: async () => ({ svg: "" }) });
    await expect(runtime.render("plot(x)")).rejects.toThrow(/ref/);
    const none = createServerRuntime({ generator: "sageplot", label: "Sage" }, {});
    await expect(none.render("plot(x)", { ref: "p" })).rejects.toThrow(/no server render/);
  });

  it("passes the host's failure through, log and all", async () => {
    const runtime = createServerRuntime(
      { generator: "sageplot", label: "Sage" },
      { render: async () => Promise.reject(new GeneratorRenderError("The build server could not make the picture.", "the log")) },
    );
    const failure = await runtime.render("plot(x)", { ref: "p" }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(GeneratorRenderError);
    expect((failure as GeneratorRenderError).log).toBe("the log");
  });
});

describe("createRenderQueue", () => {
  it("runs one job at a time, and a newer waiting job supersedes the one before it, both getting its result", async () => {
    const ran: string[] = [];
    let release: (() => void) | undefined;
    const enqueue = createRenderQueue(async (source: string) => {
      ran.push(source);
      if (source === "first") await new Promise<void>((resolve) => (release = resolve));
      return { svg: `<svg data-source="${source}"/>`, annotations: null, source };
    });

    const first = enqueue("first");
    const second = enqueue("second");
    const third = enqueue("third");
    release!();

    expect((await first).source).toBe("first");
    expect((await second).source).toBe("third");
    expect((await third).source).toBe("third");
    expect(ran).toEqual(["first", "third"]);
  });

  it("rejects everyone waiting on a job that fails, and goes on with the next", async () => {
    const enqueue = createRenderQueue(async (source: string) => {
      if (source === "bad") throw new Error("boom");
      return { svg: "<svg/>", annotations: null, source };
    });
    await expect(enqueue("bad")).rejects.toThrow("boom");
    expect((await enqueue("good")).source).toBe("good");
  });
});
