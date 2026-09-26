/**
 * Snippets and assets open in the same code editor as divisions: clicking one
 * in the explorer puts its source in the editor, the title bar names it, and
 * its settings live in the drawer that bar drops down. These drive `Editors`
 * end to end with the code editor and the preview stood in for.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { forwardRef, useImperativeHandle } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Editors from "../components/Editors";
import type { Division } from "../types/sections";
import type { Asset, EditorContentChange, Snippet } from "../types/editor";

// Monaco loads itself from a CDN; a textarea reporting every change at once
// stands in for it. `lockStructure` is surfaced so the buffer kind is visible.
vi.mock("../components/CodeEditor", () => {
  const Mock = forwardRef(
    (
      props: {
        content: string;
        sourceFormat: string;
        lockStructure?: boolean;
        onChange: (value: string | undefined) => void;
      },
      ref,
    ) => {
      useImperativeHandle(ref, () => ({
        focus: () => {},
        flushPendingChange: () => {},
      }));
      return (
        <textarea
          data-testid="code-editor"
          data-format={props.sourceFormat}
          data-locked={String(props.lockStructure ?? true)}
          value={props.content}
          onChange={(e) => props.onChange(e.target.value)}
        />
      );
    },
  );
  return { __esModule: true, default: Mock };
});

vi.mock("../components/LivePreview", () => {
  const Mock = forwardRef(() => <div data-testid="live-preview" />);
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

function renderEditors(overrides: Partial<Parameters<typeof Editors>[0]> = {}) {
  const changes: EditorContentChange[] = [];
  const snippetUpdates: Snippet[] = [];
  const assetUpdates: Asset[] = [];
  render(
    <Editors
      divisions={divisions}
      rootDivisionId="doc"
      projectType="article"
      title="Doc"
      topBar={{}}
      projectSnippets={[snippet]}
      projectAssets={[asset]}
      onContentChange={(c) => changes.push(c)}
      onSnippetUpdate={async (s) => {
        snippetUpdates.push(s);
      }}
      onAssetUpdate={async (a) => {
        assetUpdates.push(a);
      }}
      onPreviewRebuild={async () => ""}
      {...overrides}
    />,
  );
  return { changes, snippetUpdates, assetUpdates };
}

const editor = () => screen.getByTestId("code-editor") as HTMLTextAreaElement;
const barTitle = () => screen.getByTestId("editor-target-title");

function openSnippetRow(ref: string) {
  fireEvent.click(screen.getByTestId("explorer-tab-snippets"));
  fireEvent.click(within(screen.getByTestId(`snippet-row-${ref}`)).getByRole("button"));
}

function openAssetRow(ref: string) {
  fireEvent.click(screen.getByTestId("explorer-tab-assets"));
  fireEvent.click(within(screen.getByTestId(`asset-row-${ref}`)).getByRole("button"));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("opening a snippet", () => {
  it("shows its source in the code editor, unlocked, under a bar naming it", () => {
    renderEditors();
    expect(barTitle()).toHaveTextContent("Main");
    expect(editor().dataset.locked).toBe("true");

    openSnippetRow("greeting");

    expect(barTitle()).toHaveTextContent("greeting");
    expect(editor().value).toBe("<p>Hello</p>");
    expect(editor().dataset.locked).toBe("false");
    // Previewing snippets on their own isn't built yet.
    expect(screen.getByTestId("preview-coming-soon")).toBeInTheDocument();
    expect(screen.queryByTestId("live-preview")).toBeNull();
  });

  it("saves source edits to the snippet, not to any division", async () => {
    const { changes, snippetUpdates } = renderEditors();
    openSnippetRow("greeting");

    fireEvent.change(editor(), { target: { value: "<p>Hello there</p>" } });
    fireEvent.change(editor(), { target: { value: "<p>Hello there!</p>" } });
    expect(editor().value).toBe("<p>Hello there!</p>");
    // Host writes are coalesced: nothing yet…
    expect(snippetUpdates).toEqual([]);
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    // …then one write carrying the latest text.
    expect(snippetUpdates).toHaveLength(1);
    expect(snippetUpdates[0]).toMatchObject({ ref: "greeting", source: "<p>Hello there!</p>" });
    expect(changes).toEqual([]);
  });

  it("keeps unsaved typing when the host resets the pool mid-save", async () => {
    // The Rails host answers each write by re-fetching the project, which
    // hands the editor a new `projectSnippets` — a reset. One that lands while
    // a write is still pending must not take back what was typed.
    const props = {
      divisions,
      rootDivisionId: "doc",
      projectType: "article" as const,
      title: "Doc",
      topBar: {},
      projectAssets: [asset],
      onContentChange: () => {},
      onSnippetUpdate: async () => {},
    };
    const { rerender } = render(
      <Editors {...props} projectSnippets={[snippet]} />,
    );
    openSnippetRow("greeting");
    fireEvent.change(editor(), { target: { value: "<p>Typed.</p>" } });

    rerender(<Editors {...props} projectSnippets={[{ ...snippet }]} />);
    expect(editor().value).toBe("<p>Typed.</p>");

    // Once stored, a reset is authoritative again.
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    rerender(
      <Editors {...props} projectSnippets={[{ ...snippet, source: "<p>Server.</p>" }]} />,
    );
    expect(editor().value).toBe("<p>Server.</p>");
  });

  it("renames its id from the drawer, rewriting every embed of it", async () => {
    const { changes, snippetUpdates } = renderEditors();
    openSnippetRow("greeting");
    fireEvent.click(screen.getByTestId("settings-drawer-toggle"));

    const idField = screen.getByLabelText("Id") as HTMLInputElement;
    fireEvent.change(idField, { target: { value: "salutation" } });
    await act(async () => {
      fireEvent.keyDown(idField, { key: "Enter" });
    });

    // Persisted to the host first, then the placeholder follows.
    expect(snippetUpdates[0]).toMatchObject({ ref: "salutation" });
    const docChanges = changes.filter((c) => c.xmlId === "doc");
    const docSource = docChanges[docChanges.length - 1]?.source;
    expect(docSource).toContain('<plus:snippet ref="salutation"/>');
    // Still open, under its new name.
    expect(barTitle()).toHaveTextContent("salutation");
    expect(within(screen.getByTestId("settings-drawer")).getByTestId("settings-embed-code"))
      .toHaveTextContent('<plus:snippet ref="salutation"/>');
  });

  it("returns to a division, and its preview, when one is selected", () => {
    renderEditors();
    openSnippetRow("greeting");
    fireEvent.click(screen.getByTestId("explorer-tab-toc"));
    fireEvent.click(screen.getByText("Main", { selector: '[data-testid="toc-title"]' }));
    expect(barTitle()).toHaveTextContent("Main");
    expect(editor().value).toContain('<article xml:id="doc">');
    expect(screen.getByTestId("live-preview")).toBeInTheDocument();
  });
});

describe("opening an asset", () => {
  it("shows its PreTeXt source and flags a missing short description", async () => {
    const { assetUpdates } = renderEditors();
    openAssetRow("fig");
    expect(barTitle()).toHaveTextContent("A figure");
    expect(editor().value).toBe("<latex-image>x</latex-image>");
    expect(editor().dataset.format).toBe("pretext");
    expect(screen.getByText("missing short description")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-drawer-toggle"));
    const alt = screen.getByLabelText("Short description") as HTMLInputElement;
    fireEvent.change(alt, { target: { value: "A plot" } });
    await act(async () => {
      fireEvent.blur(alt);
    });
    expect(assetUpdates[assetUpdates.length - 1]).toMatchObject({ ref: "fig", shortDescription: "A plot" });
    expect(screen.queryByText("missing short description")).toBeNull();
  });
});

describe("the settings drawer", () => {
  it("toggles from the bar and closes on Escape", () => {
    renderEditors();
    expect(screen.queryByTestId("settings-drawer")).toBeNull();
    fireEvent.click(screen.getByTestId("settings-drawer-toggle"));
    // A division's drawer is its properties form.
    expect(
      within(screen.getByTestId("settings-drawer")).getByDisplayValue("Main"),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("settings-drawer")).toBeNull();
  });

  it("closes when another item opens", () => {
    renderEditors();
    fireEvent.click(screen.getByTestId("settings-drawer-toggle"));
    openSnippetRow("greeting");
    expect(screen.queryByTestId("settings-drawer")).toBeNull();
  });

  it("falls back to the root when the open snippet is removed", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      renderEditors({ onSnippetRemove: () => {} });
      openSnippetRow("greeting");
      fireEvent.click(screen.getByTestId("settings-drawer-toggle"));
      fireEvent.click(screen.getByText("Remove from project"));
      expect(barTitle()).toHaveTextContent("Main");
      expect(editor().value).not.toContain("plus:snippet");
    } finally {
      confirm.mockRestore();
    }
  });
});
