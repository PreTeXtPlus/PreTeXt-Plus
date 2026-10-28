/**
 * The tab strip above the editor's title bar: it appears once an author has
 * stepped aside from a division to a snippet or asset, and takes them back.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { forwardRef, useImperativeHandle } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import Editors from "../components/Editors";
import type { Division } from "../types/sections";
import type { Asset, Snippet } from "../types/editor";

const bufferKeys: (string | undefined)[] = [];

vi.mock("../components/CodeEditor", () => {
  const Mock = forwardRef(
    (
      props: {
        content: string;
        bufferKey?: string;
        onChange: (value: string | undefined) => void;
      },
      ref,
    ) => {
      useImperativeHandle(ref, () => ({
        focus: () => {},
        flushPendingChange: () => {},
      }));
      bufferKeys.push(props.bufferKey);
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

vi.mock("../components/LivePreview", () => {
  const Mock = forwardRef((props: { content: string; title?: string }) => (
    <div data-testid="live-preview" data-content={props.content} />
  ));
  return { __esModule: true, default: Mock };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  globalThis.ResizeObserver ?? (ResizeObserverStub as never);

const divisions: Division[] = [
  {
    id: "1",
    xmlId: "doc",
    title: "Main",
    type: "article",
    sourceFormat: "pretext",
    source:
      '<article xml:id="doc">\n<title>Main</title>\n<p><plus:snippet ref="greeting"/></p>\n<plus:image ref="fig"/>\n</article>',
  },
];
const snippet: Snippet = {
  id: "s1",
  ref: "greeting",
  source: "<p>Hello</p>",
  sourceFormat: "pretext",
};
const asset: Asset = {
  id: "a1",
  ref: "fig",
  title: "A figure",
  source: "<latex-image>x</latex-image>",
};

function renderEditors() {
  const selected: string[] = [];
  render(
    <Editors
      divisions={divisions}
      rootDivisionId="doc"
      projectType="article"
      title="Doc"
      topBar={{}}
      projectSnippets={[snippet]}
      projectAssets={[asset]}
      onContentChange={() => {}}
      onDivisionSelect={(id) => selected.push(id)}
      onPreviewRebuild={async () => ""}
    />,
  );
  return { selected };
}

const editor = () => screen.getByTestId("code-editor") as HTMLTextAreaElement;
const barTitle = () => screen.getByTestId("editor-target-title");
const tab = (kind: string, ref: string) => screen.getByTestId(`editor-tab-${kind}-${ref}`);

function openAssetRow(ref: string) {
  fireEvent.click(screen.getByTestId("explorer-tab-assets"));
  fireEvent.click(within(screen.getByTestId(`asset-row-${ref}`)).getByRole("button"));
}
function openSnippetRow(ref: string) {
  fireEvent.click(screen.getByTestId("explorer-tab-snippets"));
  fireEvent.click(within(screen.getByTestId(`snippet-row-${ref}`)).getByRole("button"));
}

beforeEach(() => {
  bufferKeys.length = 0;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the editor tab strip", () => {
  it("is not shown while only one item is open", () => {
    renderEditors();
    expect(screen.queryByTestId("editor-tabs")).toBeNull();
  });

  it("appears when an asset is opened beside the division, and switches between them", () => {
    const { selected } = renderEditors();
    openAssetRow("fig");

    const strip = screen.getByTestId("editor-tabs");
    const tabs = within(strip).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Main", "A figure"]);
    expect(tab("asset", "fig")).toHaveAttribute("aria-selected", "true");
    expect(editor().value).toBe(asset.source);

    fireEvent.click(tab("division", "doc"));
    expect(tab("division", "doc")).toHaveAttribute("aria-selected", "true");
    expect(barTitle()).toHaveTextContent("Main");
    expect(editor().value).toContain("<plus:image");
    // The host hears of the division as it would from the explorer.
    expect(selected).toEqual(["doc"]);
    // The strip stays: the asset is still open.
    expect(screen.getByTestId("editor-tabs")).toBeInTheDocument();
  });

  it("closes a tab from its ×, returning to the division, and goes away with the last extra tab", () => {
    const { selected } = renderEditors();
    openSnippetRow("greeting");
    expect(editor().value).toBe("<p>Hello</p>");

    fireEvent.click(screen.getByRole("button", { name: "Close greeting" }));
    expect(screen.queryByTestId("editor-tabs")).toBeNull();
    expect(barTitle()).toHaveTextContent("Main");
    expect(selected).toEqual(["doc"]);
  });

  it("closes a tab on middle-click", () => {
    renderEditors();
    openAssetRow("fig");
    fireEvent.mouseDown(tab("asset", "fig"), { button: 1 });
    expect(screen.queryByTestId("editor-tabs")).toBeNull();
    expect(barTitle()).toHaveTextContent("Main");
  });

  it("hands the code editor a key per buffer, so it can keep a cursor per tab", () => {
    renderEditors();
    openAssetRow("fig");
    fireEvent.click(tab("division", "doc"));
    const seen = [...new Set(bufferKeys)];
    expect(seen).toEqual(["doc", "asset:a1"]);
  });
});
