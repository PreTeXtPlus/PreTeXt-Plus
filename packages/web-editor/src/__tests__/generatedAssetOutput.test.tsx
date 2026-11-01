/**
 * What `Editors` does with a generated asset's browser render: hands it to the
 * host, and lays only the stored picture's fields onto the asset once the host
 * has it — onto the asset as it is by then, not as it was when the render
 * began, since the author may have typed on. The preview pane is stood in for
 * by a button that finishes "a render" with the asset it first saw.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Editors from "../components/Editors";
import type { GeneratedAssetOutput } from "../components/GeneratedAssetPreview";
import type { Division } from "../types/sections";
import type { Asset } from "../types/editor";

const finished = vi.hoisted(() => ({ current: undefined as Promise<void> | void }));

vi.mock("../components/CodeEditor", () => {
  const Mock = forwardRef(
    (props: { content: string; onChange: (value: string | undefined) => void }, ref) => {
      useImperativeHandle(ref, () => ({ focus: () => {}, flushPendingChange: () => {} }));
      return (
        <textarea
          data-testid="code-editor"
          value={props.content}
          onChange={(e) => props.onChange(e.target.value)}
        />
      );
    },
  );
  return { __esModule: true, default: Mock };
});

vi.mock("../components/LivePreview", () => ({ __esModule: true, default: () => null }));

vi.mock("../components/GeneratedAssetPreview", () => ({
  __esModule: true,
  default: function GeneratedAssetPreviewStub(props: {
    asset: Asset;
    onOutput?: (asset: Asset, output: GeneratedAssetOutput) => Promise<void> | void;
  }) {
    // The asset as it was when "the render" started.
    const started = useRef(props.asset);
    return (
      <button
        data-testid="finish-render"
        data-source={props.asset.source}
        data-first-seen={started.current.ref}
        data-url={props.asset.url ?? ""}
        data-digest={props.asset.previewInputDigest ?? ""}
        onClick={() => {
          finished.current = props.onOutput?.(started.current, { svg: "<svg/>", previewInputDigest: "d1" });
        }}
      />
    );
  },
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);

const divisions: Division[] = [
  {
    id: "1",
    xmlId: "doc",
    title: "Main",
    type: "article",
    sourceFormat: "pretext",
    source: '<article xml:id="doc">\n<title>Main</title>\n<plus:image ref="fig"/>\n</article>',
  },
];
const asset: Asset = { id: "a1", ref: "fig", title: "Figure", sourceFormat: "prefigure", source: "<diagram/>" };

function renderWith(
  onAssetOutput: (asset: Asset, output: GeneratedAssetOutput) => Promise<Asset | void>,
  projectAssets: Asset[] = [asset],
) {
  render(
    <Editors
      divisions={divisions}
      rootDivisionId="doc"
      projectType="article"
      title="Doc"
      topBar={{}}
      projectAssets={projectAssets}
      onContentChange={() => {}}
      onPreviewRebuild={async () => ""}
      onAssetOutput={onAssetOutput}
    />,
  );
  fireEvent.click(screen.getByTestId("explorer-tab-assets"));
  fireEvent.click(within(screen.getByTestId("asset-row-fig")).getByRole("button"));
}

const editor = () => screen.getByTestId("code-editor") as HTMLTextAreaElement;
const preview = () => screen.getByTestId("finish-render");

describe("storing a generated asset's render", () => {
  // The pane holds a rendered picture: reused, it would show one asset's picture
  // under the next one's name, and download it as that.
  it("gives each generated asset its own pane", () => {
    const second: Asset = { ...asset, id: "a2", ref: "fig-two", title: "Second" };
    renderWith(vi.fn(), [asset, second]);
    expect(preview()).toHaveAttribute("data-first-seen", "fig");
    fireEvent.click(within(screen.getByTestId("asset-row-fig-two")).getByRole("button"));
    expect(preview()).toHaveAttribute("data-first-seen", "fig-two");
  });

  it("keeps what the author typed while it rendered and was stored, and takes the stored picture's fields", async () => {
    let answer!: (asset: Asset) => void;
    const onAssetOutput = vi.fn(() => new Promise<Asset>((resolve) => (answer = resolve)));
    renderWith(onAssetOutput);

    // Typing while the engine renders the source it started with…
    fireEvent.change(editor(), { target: { value: "<diagram>typed</diagram>" } });
    fireEvent.click(preview());
    expect(editor().value).toBe("<diagram>typed</diagram>");
    // …and while the host stores the result.
    fireEvent.change(editor(), { target: { value: "<diagram>typed on</diagram>" } });
    // The host's record predates the keystroke, as a real one would.
    await act(async () => {
      answer({ ...asset, title: "Stale title", url: "/fig.svg", contentType: "image/svg+xml", previewInputDigest: "d1" });
      await finished.current;
    });

    expect(onAssetOutput).toHaveBeenCalledWith(expect.objectContaining({ source: "<diagram/>" }), {
      svg: "<svg/>",
      previewInputDigest: "d1",
    });
    expect(editor().value).toBe("<diagram>typed on</diagram>");
    expect(preview().dataset.source).toBe("<diagram>typed on</diagram>");
    expect(preview().dataset.url).toBe("/fig.svg");
    expect(preview().dataset.digest).toBe("d1");
    expect(screen.getByTestId("editor-target-title")).toHaveTextContent("Figure");
  });

  it("records nothing when the host fails to store it, and passes the failure on", async () => {
    renderWith(vi.fn(async () => Promise.reject(new Error("Upload failed: 500"))));

    fireEvent.click(preview());
    await act(async () => {
      await expect(finished.current).rejects.toThrow("Upload failed: 500");
    });

    expect(preview().dataset.digest).toBe("");
    expect(preview().dataset.url).toBe("");
  });
});
