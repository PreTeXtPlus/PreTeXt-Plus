/**
 * Creating a snippet or an asset — like creating a division — replaces the
 * editor pane with a form for the new item. Nothing exists until the form is
 * submitted; then the new item opens in the editor. These drive `Editors` end
 * to end with the code editor and the preview stood in for.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { forwardRef, useImperativeHandle } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Editors from "../components/Editors";
import type { Division } from "../types/sections";
import type { Asset, EditorContentChange, Snippet, SourceFormat } from "../types/editor";

vi.mock("../components/CodeEditor", () => {
  const Mock = forwardRef(
    (
      props: { content: string; onChange: (value: string | undefined) => void },
      ref,
    ) => {
      useImperativeHandle(ref, () => ({
        focus: () => {},
        flushPendingChange: () => {},
      }));
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

vi.mock("../components/LivePreview", () => ({
  __esModule: true,
  default: () => <div data-testid="live-preview" />,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  globalThis.ResizeObserver ?? (ResizeObserverStub as never);

// The document refers to a snippet and an image that don't exist yet.
const divisions: Division[] = [
  {
    id: "1",
    xmlId: "doc",
    title: "Main",
    type: "article",
    sourceFormat: "pretext",
    source:
      '<article xml:id="doc">\n<title>Main</title>\n<p><plus:snippet ref="missing"/></p>\n<plus:image ref="nofig"/>\n<plus:image ref="fig"/>\n</article>',
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
  url: "https://example.com/fig.png",
};

function renderEditors(overrides: Partial<Parameters<typeof Editors>[0]> = {}) {
  const changes: EditorContentChange[] = [];
  const createdSnippets: { ref: string; sourceFormat?: SourceFormat }[] = [];
  const authored: string[] = [];
  render(
    <Editors
      divisions={structuredClone(divisions)}
      rootDivisionId="doc"
      projectType="article"
      title="Doc"
      topBar={{}}
      projectSnippets={[snippet]}
      projectAssets={[asset]}
      onContentChange={(c) => changes.push(c)}
      onCreateSnippet={async (ref, sourceFormat) => {
        createdSnippets.push({ ref, sourceFormat });
        return { id: `s-${ref}`, ref, source: "", sourceFormat: sourceFormat ?? "pretext" };
      }}
      onCreateAuthored={async (title) => {
        authored.push(title);
        const ref = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return { id: `a-${ref}`, ref, title };
      }}
      onSnippetUpdate={async () => {}}
      onAssetUpdate={async () => {}}
      {...overrides}
    />,
  );
  const sourceOf = (xmlId: string) => {
    const forDivision = changes.filter((c) => "xmlId" in c && c.xmlId === xmlId);
    return forDivision[forDivision.length - 1]?.source;
  };
  return { changes, createdSnippets, authored, sourceOf };
}

const pane = () => screen.getByTestId("new-item-pane");
const editorHidden = () =>
  screen.getByTestId("editor-pane-main").classList.contains("hidden");
const barTitle = () => screen.getByTestId("editor-target-title");

function showSnippets() {
  fireEvent.click(screen.getByTestId("explorer-tab-snippets"));
}
function showAssets() {
  fireEvent.click(screen.getByTestId("explorer-tab-assets"));
}

describe("creating a snippet", () => {
  it("replaces the editor with the form, and Cancel brings it back", () => {
    const { createdSnippets } = renderEditors();
    showSnippets();
    fireEvent.click(screen.getByTestId("toc-new-snippet-btn"));

    expect(screen.getByTestId("new-item-heading")).toHaveTextContent("New snippet");
    expect(editorHidden()).toBe(true);

    fireEvent.click(within(pane()).getByText("Cancel"));
    expect(screen.queryByTestId("new-item-pane")).toBeNull();
    expect(editorHidden()).toBe(false);
    expect(createdSnippets).toEqual([]);
  });

  it("refuses an empty or taken reference inline", async () => {
    const { createdSnippets } = renderEditors();
    showSnippets();
    fireEvent.click(screen.getByTestId("toc-new-snippet-btn"));

    await act(async () => {
      fireEvent.click(within(pane()).getByText("Create"));
    });
    expect(within(pane()).getByRole("alert")).toHaveTextContent("can't be empty");

    fireEvent.change(within(pane()).getByLabelText("Reference id"), {
      target: { value: "greeting" },
    });
    await act(async () => {
      fireEvent.click(within(pane()).getByText("Create"));
    });
    expect(within(pane()).getByRole("alert")).toHaveTextContent("already in use");
    expect(createdSnippets).toEqual([]);
  });

  it("creates it in the chosen format and opens it", async () => {
    const { createdSnippets } = renderEditors();
    showSnippets();
    fireEvent.click(screen.getByTestId("toc-new-snippet-btn"));

    fireEvent.change(within(pane()).getByLabelText("Reference id"), {
      target: { value: "theorem-note" },
    });
    fireEvent.change(within(pane()).getByLabelText("Source format"), {
      target: { value: "latex" },
    });
    await act(async () => {
      fireEvent.click(within(pane()).getByText("Create"));
    });

    expect(createdSnippets).toEqual([{ ref: "theorem-note", sourceFormat: "latex" }]);
    expect(screen.queryByTestId("new-item-pane")).toBeNull();
    expect(barTitle()).toHaveTextContent("theorem-note");
  });

  it("links an unlinked placeholder, renaming it if the author changes the ref", async () => {
    const { createdSnippets, sourceOf } = renderEditors();
    showSnippets();
    fireEvent.click(
      within(screen.getByTestId("snippet-row-missing")).getByRole("button"),
    );

    expect(screen.getByTestId("new-item-heading")).toHaveTextContent("Link snippet");
    const refField = within(pane()).getByLabelText("Reference id") as HTMLInputElement;
    expect(refField.value).toBe("missing");

    fireEvent.change(refField, { target: { value: "found" } });
    await act(async () => {
      fireEvent.click(within(pane()).getByText("Create"));
    });

    expect(createdSnippets).toEqual([{ ref: "found", sourceFormat: "pretext" }]);
    expect(sourceOf("doc")).toContain('<plus:snippet ref="found"/>');
    expect(sourceOf("doc")).not.toContain('ref="missing"');
    expect(barTitle()).toHaveTextContent("found");
  });
});

describe("creating an asset", () => {
  it("creates a custom asset from its title and opens it", async () => {
    const { authored } = renderEditors();
    showAssets();
    fireEvent.click(screen.getByTestId("toc-new-asset-btn"));

    expect(screen.getByTestId("new-item-heading")).toHaveTextContent("New asset");
    fireEvent.click(within(pane()).getByText("Custom"));
    fireEvent.change(within(pane()).getByLabelText("Title"), {
      target: { value: "My Diagram" },
    });
    await act(async () => {
      fireEvent.click(within(pane()).getByText("Create"));
    });

    expect(authored).toEqual(["My Diagram"]);
    expect(screen.queryByTestId("new-item-pane")).toBeNull();
    expect(barTitle()).toHaveTextContent("My Diagram");
  });

  it("links an unlinked image placeholder to the asset it creates", async () => {
    const { sourceOf } = renderEditors();
    showAssets();
    fireEvent.click(
      within(screen.getByTestId("asset-row-nofig")).getByRole("button"),
    );

    expect(screen.getByTestId("new-item-heading")).toHaveTextContent("Link asset");
    fireEvent.click(within(pane()).getByText("Custom"));
    // Prefilled from the placeholder's ref.
    const title = within(pane()).getByLabelText("Title") as HTMLInputElement;
    expect(title.value).toBe("nofig");
    fireEvent.change(title, { target: { value: "New figure" } });
    await act(async () => {
      fireEvent.click(within(pane()).getByText("Create"));
    });

    expect(sourceOf("doc")).toContain('<plus:image ref="new-figure"/>');
    expect(sourceOf("doc")).not.toContain('ref="nofig"');
  });

  it("offers only image sources when replacing", () => {
    renderEditors({
      onAssetUpload: async (file) => ({ id: "up", ref: "up", title: file.name }),
      onAssetRemove: async () => {},
    });
    showAssets();
    fireEvent.click(within(screen.getByTestId("asset-row-fig")).getByRole("button"));
    fireEvent.click(screen.getByText("Replace image…"));

    expect(screen.getByTestId("new-item-heading")).toHaveTextContent("Replace asset");
    expect(within(pane()).getByText("Upload")).toBeInTheDocument();
    expect(within(pane()).queryByText("Custom")).toBeNull();
    // The asset's always-open settings go with the editor pane the form hides.
    expect(screen.getByTestId("editor-pane-main")).toHaveClass("hidden");
  });
});

describe("leaving the form", () => {
  it("abandons it when the author opens an item from the explorer", () => {
    renderEditors();
    showSnippets();
    fireEvent.click(screen.getByTestId("toc-new-snippet-btn"));
    fireEvent.click(within(screen.getByTestId("snippet-row-greeting")).getByRole("button"));

    expect(screen.queryByTestId("new-item-pane")).toBeNull();
    expect(barTitle()).toHaveTextContent("greeting");
  });

  it("abandons it on Escape", () => {
    renderEditors();
    showAssets();
    fireEvent.click(screen.getByTestId("toc-new-asset-btn"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("new-item-pane")).toBeNull();
  });
});
