/**
 * The preview pane for a generated asset: what it says about the stored
 * picture, that the engine starts on its own, and that a finished render
 * reaches the host with the digest of the source it rendered.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import GeneratedAssetPreview from "../components/GeneratedAssetPreview";
import {
  GeneratorRenderError,
  renderInputFor,
  sha256Hex,
  generators,
  type GeneratorRuntime,
  type RenderResult,
} from "../generators";
import type { Asset } from "../types/editor";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

/** A runtime whose status the test drives and whose renders it scripts. */
function fakeRuntime(initial: GeneratorRuntime["status"] = "idle") {
  let status = initial;
  const listeners = new Set<() => void>();
  const rendered: string[] = [];
  const runtime: GeneratorRuntime & { set(status: GeneratorRuntime["status"]): void; rendered: string[] } = {
    get status() {
      return status;
    },
    error: undefined,
    progress: undefined,
    load: vi.fn(async () => {
      runtime.set("ready");
    }),
    render: vi.fn(async (source: string): Promise<RenderResult> => {
      rendered.push(source);
      return { svg: SVG, annotations: null, source };
    }),
    dispose: vi.fn(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      status = next;
      listeners.forEach((l) => l());
    },
    rendered,
  };
  return runtime;
}

const asset: Asset = {
  id: "a1",
  ref: "graph",
  title: "Graph",
  sourceFormat: "prefigure",
  source: "<diagram/>",
  shortDescription: "A graph",
};

// Real timers throughout: the digest resolves on a Web Crypto callback that
// fake timers would hold, so the render debounce is shortened by prop instead.
describe("GeneratedAssetPreview", () => {
  beforeEach(() => {
    globalThis.URL.createObjectURL ??= vi.fn(() => "blob:fake");
    globalThis.URL.revokeObjectURL ??= vi.fn();
  });

  it("with no engine configured, shows the stored picture and says so", () => {
    render(<GeneratedAssetPreview asset={{ ...asset, url: "/graph.svg" }} docinfo="" runtime={undefined} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "/graph.svg");
    expect(screen.getByTestId("asset-preview")).toHaveTextContent("Live rendering isn't available here");
  });

  it("reports whether the stored picture matches the current source", async () => {
    const docinfo = "<docinfo/>";
    const current = await sha256Hex(renderInputFor(generators.prefigure, "<diagram/>", docinfo));
    const { rerender } = render(
      <GeneratedAssetPreview
        asset={{ ...asset, url: "/graph.svg", previewInputDigest: current }}
        docinfo={docinfo}
        runtime={fakeRuntime()}
      />,
    );
    expect(await screen.findByText(/matches the current source/)).toBeInTheDocument();

    rerender(
      <GeneratedAssetPreview
        asset={{ ...asset, url: "/graph.svg", previewInputDigest: current, source: "<diagram>edited</diagram>" }}
        docinfo={docinfo}
        runtime={fakeRuntime()}
      />,
    );
    expect(await screen.findByText(/Source changed since the stored picture/)).toBeInTheDocument();
  });

  it("starts the engine on its own, but not for a read-only view", async () => {
    const runtime = fakeRuntime();
    render(<GeneratedAssetPreview asset={asset} docinfo="" runtime={runtime} />);
    expect(screen.getByTestId("generated-asset-status")).toHaveTextContent("Not rendered yet");
    await waitFor(() => expect(runtime.load).toHaveBeenCalledTimes(1));

    const idle = fakeRuntime();
    render(<GeneratedAssetPreview asset={asset} docinfo="" runtime={idle} readOnly />);
    await new Promise((r) => setTimeout(r, 10));
    expect(idle.load).not.toHaveBeenCalled();
  });

  it("says when the engine could not be loaded and offers a retry", async () => {
    const runtime = fakeRuntime("failed");
    render(<GeneratedAssetPreview asset={asset} docinfo="" runtime={runtime} />);
    expect(screen.getByTestId("generated-asset-load-error")).toHaveTextContent("couldn't be loaded");
    fireEvent.click(screen.getByTestId("retry-generator-engine"));
    expect(runtime.load).toHaveBeenCalledTimes(1);
  });

  it("renders a second after the source settles, with the docinfo macros, and hands the host the picture with its digest", async () => {
    const runtime = fakeRuntime("ready");
    const onOutput = vi.fn();
    const docinfo = "<docinfo><macros>\\newcommand{\\R}{\\mathbb{R}}</macros></docinfo>";
    render(
      <GeneratedAssetPreview asset={asset} docinfo={docinfo} runtime={runtime} onOutput={onOutput} debounceMs={0} />,
    );

    await waitFor(() => expect(onOutput).toHaveBeenCalledTimes(1));
    expect(runtime.render).toHaveBeenCalledWith("<diagram/>", {
      docinfo: { macros: "\\newcommand{\\R}{\\mathbb{R}}", "prefigure-preamble": "" },
    });
    const [, output] = onOutput.mock.calls[0];
    expect(output.svg).toBe(SVG);
    expect(output.previewInputDigest).toBe(
      await sha256Hex(renderInputFor(generators.prefigure, "<diagram/>", docinfo)),
    );
    await waitFor(() =>
      expect(screen.getByTestId("generated-asset-status")).toHaveTextContent("Rendered from the current source"),
    );
  });

  it("gives a render each docinfo element its generator reads", async () => {
    const runtime = fakeRuntime("ready");
    const docinfo =
      "<docinfo><macros>\\def\\a{1}</macros><latex-image-preamble>\\usepackage{tikz-cd}</latex-image-preamble></docinfo>";
    const tikz: Asset = { ...asset, sourceFormat: "tikz", source: "\\tikz\\draw (0,0);" };
    render(<GeneratedAssetPreview asset={tikz} docinfo={docinfo} runtime={runtime} debounceMs={0} />);

    await waitFor(() => expect(runtime.render).toHaveBeenCalledTimes(1));
    expect(runtime.render).toHaveBeenCalledWith("\\tikz\\draw (0,0);", {
      docinfo: { macros: "\\def\\a{1}", "latex-image-preamble": "\\usepackage{tikz-cd}" },
    });
  });

  it("shows the excerpt of a failed render, with the whole transcript folded under it", async () => {
    const runtime = fakeRuntime("ready");
    vi.mocked(runtime.render).mockRejectedValue(
      new GeneratorRenderError("! Undefined control sequence.", "This is pdfTeX\n! Undefined control sequence."),
    );
    render(<GeneratedAssetPreview asset={asset} docinfo="" runtime={runtime} debounceMs={0} />);

    await waitFor(() =>
      expect(screen.getByTestId("generated-asset-error")).toHaveTextContent("! Undefined control sequence."),
    );
    expect(screen.getByTestId("generated-asset-log")).toHaveTextContent("This is pdfTeX");
    expect(screen.getByTestId("generated-asset-log")).not.toHaveAttribute("open");
  });

  it("has no transcript to show for an engine that keeps none", async () => {
    const runtime = fakeRuntime("ready");
    vi.mocked(runtime.render).mockRejectedValue(new Error("no <diagram>"));
    render(<GeneratedAssetPreview asset={asset} docinfo="" runtime={runtime} debounceMs={0} />);

    await waitFor(() => expect(screen.getByTestId("generated-asset-error")).toHaveTextContent("no <diagram>"));
    expect(screen.queryByTestId("generated-asset-log")).toBeNull();
  });

  it("does not hand the host a render that typing overtook, but does the next one", async () => {
    const runtime = fakeRuntime("ready");
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    (runtime.render as ReturnType<typeof vi.fn>).mockImplementationOnce(async (source: string) => {
      await held;
      return { svg: SVG, annotations: null, source };
    });
    const onOutput = vi.fn();
    const { rerender } = render(
      <GeneratedAssetPreview asset={asset} docinfo="" runtime={runtime} onOutput={onOutput} debounceMs={0} />,
    );
    await waitFor(() => expect(runtime.render).toHaveBeenCalledTimes(1));

    const typed = { ...asset, source: "<diagram>typed</diagram>" };
    rerender(<GeneratedAssetPreview asset={typed} docinfo="" runtime={runtime} onOutput={onOutput} debounceMs={0} />);
    release();

    await waitFor(() => expect(onOutput).toHaveBeenCalledTimes(1));
    const [sent, output] = onOutput.mock.calls[0];
    expect(sent.source).toBe("<diagram>typed</diagram>");
    expect(output.previewInputDigest).toBe(await sha256Hex(renderInputFor(generators.prefigure, typed.source!, "")));
  });

  it("says when the host could not store the picture, and stores it on a retry", async () => {
    const runtime = fakeRuntime("ready");
    const onOutput = vi.fn().mockRejectedValueOnce(new Error("Upload failed: 500")).mockResolvedValueOnce(undefined);
    render(<GeneratedAssetPreview asset={asset} docinfo="" runtime={runtime} onOutput={onOutput} debounceMs={0} />);

    expect(await screen.findByTestId("generated-asset-save-error")).toHaveTextContent("Upload failed: 500");
    fireEvent.click(screen.getByTestId("retry-generated-asset-save"));

    await waitFor(() => expect(onOutput).toHaveBeenCalledTimes(2));
    expect(onOutput.mock.calls[1][1]).toEqual(onOutput.mock.calls[0][1]);
    await waitFor(() => expect(screen.queryByTestId("generated-asset-save-error")).not.toBeInTheDocument());
  });

  it("shows the engine's error and keeps going", async () => {
    const runtime = fakeRuntime("ready");
    (runtime.render as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("ValueError: not well-formed"));
    render(<GeneratedAssetPreview asset={asset} docinfo="" runtime={runtime} debounceMs={0} />);
    expect(await screen.findByTestId("generated-asset-error")).toHaveTextContent("not well-formed");
  });
});
