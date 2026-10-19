/**
 * The preview pane for a generated asset: what it says about the stored
 * picture, how the engine is offered and started, and that a finished render
 * reaches the host with the digest of the source it rendered.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import GeneratedAssetPreview from "../components/GeneratedAssetPreview";
import { renderInputFor, sha256Hex, generators, type GeneratorRuntime, type RenderResult } from "../generators";
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
    render: vi.fn(async (source: string, ref: string): Promise<RenderResult> => {
      rendered.push(source);
      return {
        outputs: [{ filename: `${ref}.svg`, blob: new Blob([SVG], { type: "image/svg+xml" }) }],
        svg: SVG,
        source,
      };
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
  generator: "prefigure",
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
    expect(screen.queryByTestId("load-generator-engine")).toBeNull();
  });

  it("reports whether the stored picture matches the current source", async () => {
    const docinfo = "<docinfo/>";
    const current = await sha256Hex(renderInputFor(generators.prefigure, "<diagram/>", docinfo));
    const { rerender } = render(
      <GeneratedAssetPreview
        asset={{ ...asset, url: "/graph.svg", outputSourceDigest: current }}
        docinfo={docinfo}
        runtime={fakeRuntime()}
      />,
    );
    expect(await screen.findByText(/matches the current source/)).toBeInTheDocument();

    rerender(
      <GeneratedAssetPreview
        asset={{ ...asset, url: "/graph.svg", outputSourceDigest: current, source: "<diagram>edited</diagram>" }}
        docinfo={docinfo}
        runtime={fakeRuntime()}
      />,
    );
    expect(await screen.findByText(/Source changed since the stored picture/)).toBeInTheDocument();
  });

  it("offers the engine and loads it only on request", async () => {
    const runtime = fakeRuntime();
    render(<GeneratedAssetPreview asset={asset} docinfo="" runtime={runtime} />);
    expect(screen.getByTestId("generated-asset-status")).toHaveTextContent("Not rendered yet");
    expect(runtime.load).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("load-generator-engine"));
    await waitFor(() => expect(screen.queryByTestId("load-generator-engine")).toBeNull());
    expect(runtime.load).toHaveBeenCalledTimes(1);
  });

  it("renders a second after the source settles and hands the host the output with its digest", async () => {
    const runtime = fakeRuntime("ready");
    const onOutput = vi.fn();
    render(
      <GeneratedAssetPreview asset={asset} docinfo="" runtime={runtime} onOutput={onOutput} debounceMs={0} />,
    );

    await waitFor(() => expect(onOutput).toHaveBeenCalledTimes(1));
    expect(runtime.render).toHaveBeenCalledWith("<diagram/>", "graph");
    const [, output] = onOutput.mock.calls[0];
    expect(output.outputs.map((o: { filename: string }) => o.filename)).toEqual(["graph.svg"]);
    expect(output.outputSourceDigest).toBe(
      await sha256Hex(renderInputFor(generators.prefigure, "<diagram/>", "")),
    );
    await waitFor(() =>
      expect(screen.getByTestId("generated-asset-status")).toHaveTextContent("Rendered from the current source"),
    );
  });

  it("shows the engine's error and keeps going", async () => {
    const runtime = fakeRuntime("ready");
    (runtime.render as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("ValueError: not well-formed"));
    render(<GeneratedAssetPreview asset={asset} docinfo="" runtime={runtime} debounceMs={0} />);
    expect(await screen.findByTestId("generated-asset-error")).toHaveTextContent("not well-formed");
  });
});
