/**
 * Duplicating a division, snippet, exercise or asset from its settings drawer:
 * a form for the copy's title and ID takes the editor pane, and on submit the
 * copy is made through the kind's ordinary creation hook, given the
 * original's source, and opened. Drives `Editors` end to end with the code
 * editor and the preview stood in for, as `createItems.test.tsx` does.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { forwardRef, useImperativeHandle } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Editors from "../components/Editors";
import type { Division } from "../types/sections";
import type { Asset, EditorContentChange, Exercise, Snippet } from "../types/editor";

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

vi.mock("../components/LivePreview", () => ({
  __esModule: true,
  default: () => <div data-testid="live-preview" />,
}));

vi.mock("../components/GeneratedAssetPreview", () => ({
  __esModule: true,
  default: () => <div data-testid="generated-preview" />,
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
    source: '<plus:section ref="exam-a"/>\n<plus:section ref="parent"/>\n<plus:section ref="last"/>',
  },
  {
    id: "2",
    xmlId: "exam-a",
    title: "Exam, version A",
    type: "worksheet",
    sourceFormat: "pretext",
    attrs: { component: "exams" },
    source: '<p>See <xref ref="q1"/>.</p>\n<exercise xml:id="q1"><statement><p>2+2</p></statement></exercise>',
  },
  {
    id: "3",
    xmlId: "parent",
    title: "Parent",
    type: "section",
    sourceFormat: "pretext",
    source: '<plus:subsection ref="child"/>',
  },
  { id: "4", xmlId: "child", title: "Child", type: "subsection", sourceFormat: "pretext", source: "<p/>" },
  { id: "5", xmlId: "last", title: "Last", type: "section", sourceFormat: "pretext", source: "<p/>" },
];
const snippet: Snippet = {
  id: "s1",
  ref: "greeting",
  title: "Greeting",
  source: "<p>Hello</p>",
  sourceFormat: "pretext",
};
const graph: Asset = {
  id: "a1",
  ref: "graph",
  title: "Graph",
  sourceFormat: "prefigure",
  source: '<diagram dimensions="(300,300)"><graph function="f"/></diagram>',
  shortDescription: "A parabola",
};
const exercise: Exercise = {
  id: "e1",
  ref: "q-mc",
  title: "Pick one",
  source: "<statement><p>Which?</p></statement>",
  attrs: { "data-x": "1" },
};

function renderEditors(overrides: Partial<Parameters<typeof Editors>[0]> = {}) {
  const changes: EditorContentChange[] = [];
  const calls: unknown[][] = [];
  const addedDivisions: Division[] = [];
  render(
    <Editors
      divisions={structuredClone(divisions)}
      rootDivisionId="doc"
      projectType="article"
      title="Doc"
      topBar={{}}
      projectSnippets={[snippet]}
      projectAssets={[graph]}
      projectExercises={[exercise]}
      onContentChange={(c) => changes.push(c)}
      onDivisionAdd={(d) => {
        addedDivisions.push(d);
      }}
      onCreateSnippet={async (ref, sourceFormat, title) => {
        calls.push(["createSnippet", ref, sourceFormat, title]);
        return { id: `s-${ref}`, ref, title, source: "", sourceFormat: sourceFormat ?? "pretext" };
      }}
      onSnippetUpdate={async (s) => {
        calls.push(["updateSnippet", s.ref, s.source]);
      }}
      onCreateGenerated={async (generator, title, ref) => {
        calls.push(["createGenerated", generator, title, ref]);
        return { id: `a-${ref}`, ref, title, sourceFormat: generator, source: "<starter/>" };
      }}
      onAssetUpdate={async (a) => {
        calls.push(["updateAsset", a.ref, a.title, a.source, a.shortDescription]);
      }}
      onCreateExercise={async (e) => {
        calls.push(["createExercise", e]);
        return { ...e, id: `e-${e.ref}` };
      }}
      {...overrides}
    />,
  );
  const lastSourceOf = (xmlId: string) => {
    const forDivision = changes.filter((c) => "xmlId" in c && c.xmlId === xmlId);
    return forDivision[forDivision.length - 1]?.source;
  };
  return { calls, addedDivisions, lastSourceOf };
}

const pane = () => screen.getByTestId("new-item-pane");
const drawer = () => screen.getByTestId("settings-drawer");
const barTitle = () => screen.getByTestId("editor-target-title");

/** Open a snippet's, asset's or exercise's row, which opens its drawer too. */
function openRow(kind: "snippet" | "asset" | "exercise", ref: string) {
  fireEvent.click(within(screen.getByTestId(`${kind}-row-${ref}`)).getByRole("button"));
}

function openDivisionDrawer(xmlId: string) {
  fireEvent.click(within(screen.getByTestId(`toc-item-${xmlId}`)).getByTestId("toc-title"));
  fireEvent.click(screen.getByTestId("settings-drawer-toggle"));
}

async function submit() {
  await act(async () => {
    fireEvent.click(within(pane()).getByRole("button", { name: "Duplicate" }));
  });
}

describe("duplicating a snippet", () => {
  it("suggests a title and ID, follows the title once edited, and opens the copy", async () => {
    const { calls } = renderEditors();
    fireEvent.click(screen.getByTestId("explorer-tab-snippets"));
    openRow("snippet", "greeting");
    fireEvent.click(within(drawer()).getByText("Duplicate…"));

    expect(screen.getByTestId("new-item-heading")).toHaveTextContent("Duplicate snippet");
    expect(within(pane()).getByLabelText("Title")).toHaveValue("Greeting (copy)");
    expect(within(pane()).getByLabelText("ID")).toHaveValue("greeting-2");

    fireEvent.change(within(pane()).getByLabelText("Title"), { target: { value: "Greeting B" } });
    expect(within(pane()).getByLabelText("ID")).toHaveValue("greeting-b");

    await submit();
    expect(calls).toEqual([
      ["createSnippet", "greeting-b", "pretext", "Greeting B"],
      ["updateSnippet", "greeting-b", "<p>Hello</p>"],
    ]);
    expect(screen.queryByTestId("new-item-pane")).toBeNull();
    expect(barTitle()).toHaveTextContent("Greeting B");
  });

  it("makes nothing on Cancel", () => {
    const { calls } = renderEditors();
    fireEvent.click(screen.getByTestId("explorer-tab-snippets"));
    openRow("snippet", "greeting");
    fireEvent.click(within(drawer()).getByText("Duplicate…"));
    fireEvent.click(within(pane()).getByText("Cancel"));
    expect(screen.queryByTestId("new-item-pane")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("refuses an ID the project already uses, without calling the host", async () => {
    const { calls } = renderEditors();
    fireEvent.click(screen.getByTestId("explorer-tab-snippets"));
    openRow("snippet", "greeting");
    fireEvent.click(within(drawer()).getByText("Duplicate…"));
    fireEvent.change(within(pane()).getByLabelText("ID"), { target: { value: "exam-a" } });
    await submit();
    expect(within(pane()).getByRole("alert")).toHaveTextContent('"exam-a" is already used');
    expect(calls).toEqual([]);
  });
});

describe("duplicating a generated asset", () => {
  it("creates one of the same generator and gives it the original's source", async () => {
    const { calls } = renderEditors();
    fireEvent.click(screen.getByTestId("explorer-tab-assets"));
    openRow("asset", "graph");
    fireEvent.click(screen.getByTestId("settings-drawer-toggle")); // shut for an authored image
    fireEvent.click(within(drawer()).getByText("Duplicate…"));

    expect(screen.getByTestId("new-item-heading")).toHaveTextContent("Duplicate image");
    fireEvent.change(within(pane()).getByLabelText("Title"), { target: { value: "Graph, version B" } });
    await submit();

    expect(calls).toEqual([
      ["createGenerated", "prefigure", "Graph, version B", "graph-version-b"],
      ["updateAsset", "graph-version-b", "Graph, version B", graph.source, "A parabola"],
    ]);
    expect(barTitle()).toHaveTextContent("Graph, version B");
    // A new copy shows its settings, for its embed code.
    expect(drawer()).toBeInTheDocument();
  });

  it("is not offered when the host can't create generated assets", () => {
    renderEditors({ onCreateGenerated: undefined });
    fireEvent.click(screen.getByTestId("explorer-tab-assets"));
    openRow("asset", "graph");
    fireEvent.click(screen.getByTestId("settings-drawer-toggle"));
    expect(within(drawer()).queryByText("Duplicate…")).toBeNull();
  });
});

describe("duplicating an exercise", () => {
  it("hands the host the whole copy in one request", async () => {
    const { calls } = renderEditors();
    fireEvent.click(screen.getByTestId("explorer-tab-exercises"));
    openRow("exercise", "q-mc");
    fireEvent.click(within(drawer()).getByText("Duplicate…"));
    await submit();

    expect(calls).toEqual([
      [
        "createExercise",
        {
          ref: "q-mc-2",
          title: "Pick one (copy)",
          source: exercise.source,
          attrs: { "data-x": "1" },
        },
      ],
    ]);
  });
});

describe("duplicating a division", () => {
  it("places the copy right after the original, its inner ids made unique", async () => {
    const { addedDivisions, lastSourceOf } = renderEditors();
    openDivisionDrawer("exam-a");
    fireEvent.click(within(drawer()).getByText("Duplicate…"));

    expect(within(pane()).getByText(/will be renamed/)).toHaveTextContent("q1 → q1-2");
    fireEvent.change(within(pane()).getByLabelText("Title"), { target: { value: "Exam, version B" } });
    await submit();

    expect(addedDivisions).toHaveLength(1);
    expect(addedDivisions[0]).toMatchObject({
      xmlId: "exam-version-b",
      title: "Exam, version B",
      type: "worksheet",
      attrs: { component: "exams" },
      source: '<p>See <xref ref="q1-2"/>.</p>\n<exercise xml:id="q1-2"><statement><p>2+2</p></statement></exercise>',
    });
    expect(lastSourceOf("doc")).toBe(
      '<plus:section ref="exam-a"/>\n<plus:worksheet ref="exam-version-b"/>\n<plus:section ref="parent"/>\n<plus:section ref="last"/>',
    );
    expect(barTitle()).toHaveTextContent("Exam, version B");
  });

  it("requires a title", async () => {
    const { addedDivisions } = renderEditors();
    openDivisionDrawer("last");
    fireEvent.click(within(drawer()).getByText("Duplicate…"));
    fireEvent.change(within(pane()).getByLabelText("Title"), { target: { value: " " } });
    await submit();
    expect(within(pane()).getByRole("alert")).toHaveTextContent("Enter a title");
    expect(addedDivisions).toEqual([]);
  });

  it("is not offered for a division that holds others, nor for the root", () => {
    renderEditors();
    openDivisionDrawer("parent");
    expect(within(drawer()).queryByText("Duplicate…")).toBeNull();
    openDivisionDrawer("doc");
    expect(within(drawer()).queryByText("Duplicate…")).toBeNull();
  });
});
