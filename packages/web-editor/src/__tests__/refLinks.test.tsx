/**
 * Ctrl/Cmd+click on a `<plus:* ref/>` placeholder opens what it names. Monaco
 * draws the links; these pin down which placeholders are links, what each
 * names, and that `Editors` opens the record a click names.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { forwardRef, useImperativeHandle } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import Editors from "../components/Editors";
import { findRefLinks, refLinkUrl } from "../components/editorConfigs/refLinks";
import type { Division } from "../types/sections";
import type { Asset, Snippet } from "../types/editor";

describe("findRefLinks", () => {
  it("links every kind of placeholder, over the whole placeholder", () => {
    const text = [
      '<plus:section ref="intro"/>',
      '<plus:division ref="any"/>',
      '<p><plus:snippet ref="greeting"/></p>',
      '<plus:image ref="fig" width="50%"/>',
      '<plus:project ref="proj"/>',
    ].join("\n");
    const links = findRefLinks(text, "pretext");
    expect(links.map(({ kind, ref, tooltip }) => ({ kind, ref, tooltip }))).toEqual([
      { kind: "division", ref: "intro", tooltip: 'Open section "intro"' },
      { kind: "division", ref: "any", tooltip: 'Open division "any"' },
      { kind: "snippet", ref: "greeting", tooltip: 'Open snippet "greeting"' },
      { kind: "asset", ref: "fig", tooltip: 'Open asset "fig"' },
      { kind: "exercise", ref: "proj", tooltip: 'Open project "proj"' },
    ]);
    const fig = links[3];
    expect(text.slice(fig.index, fig.index + fig.length)).toBe('<plus:image ref="fig" width="50%"/>');
  });

  it("reads each format's own syntax", () => {
    expect(findRefLinks("\\plus{worksheet}{w}\n\\plus[instance=b]{image}{g}", "latex")).toMatchObject([
      { kind: "division", ref: "w" },
      { kind: "asset", ref: "g" },
    ]);
    expect(findRefLinks('::chapter{ref="c"}\n::snippet{ref="s"}', "markdown")).toMatchObject([
      { kind: "division", ref: "c" },
      { kind: "snippet", ref: "s" },
    ]);
  });

  it("skips commented-out placeholders", () => {
    expect(findRefLinks('<!-- <plus:section ref="later"/> -->', "pretext")).toEqual([]);
    expect(findRefLinks("% \\plus{section}{later}", "latex")).toEqual([]);
  });

  it("writes a command URI carrying what the link names", () => {
    const url = refLinkUrl("DYNAMIC_7", { kind: "snippet", ref: "a-b" });
    expect(url.startsWith("command:DYNAMIC_7?")).toBe(true);
    expect(JSON.parse(decodeURIComponent(url.split("?")[1]))).toEqual(["snippet", "a-b"]);
  });
});

// Monaco loads from a CDN; a textarea shows the open buffer, and buttons stand
// in for Ctrl+clicking a placeholder.
vi.mock("../components/CodeEditor", () => {
  const Mock = forwardRef(
    (props: { content: string; onChange: (value: string | undefined) => void; onOpenRef?: (kind: string, ref: string) => void }, ref) => {
      useImperativeHandle(ref, () => ({ focus: () => {}, flushPendingChange: () => {} }));
      return (
        <>
          <textarea data-testid="code-editor" value={props.content} onChange={(e) => props.onChange(e.target.value)} />
          <button type="button" data-testid="open-intro" onClick={() => props.onOpenRef?.("division", "intro")} />
          <button type="button" data-testid="open-greeting" onClick={() => props.onOpenRef?.("snippet", "greeting")} />
          <button type="button" data-testid="open-fig" onClick={() => props.onOpenRef?.("asset", "fig")} />
          <button type="button" data-testid="open-missing" onClick={() => props.onOpenRef?.("division", "later")} />
        </>
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
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);

const divisions: Division[] = [
  {
    id: "1",
    xmlId: "doc",
    title: "Main",
    type: "article",
    sourceFormat: "pretext",
    source: '<p><plus:snippet ref="greeting"/></p>\n<plus:image ref="fig"/>\n<plus:section ref="intro"/>\n<plus:section ref="later"/>',
  },
  { id: "2", xmlId: "intro", title: "Intro", type: "section", sourceFormat: "pretext", source: "<p>Intro body</p>" },
];
const snippet: Snippet = { id: "s1", ref: "greeting", source: "<p>Hello</p>", sourceFormat: "pretext" };
const asset: Asset = { id: "a1", ref: "fig", title: "A figure", source: "<latex-image>x</latex-image>" };

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
    />,
  );
  return { selected };
}

const buffer = () => (screen.getByTestId("code-editor") as HTMLTextAreaElement).value;

describe("Ctrl+clicking a placeholder", () => {
  it("opens the division it names, telling the host", () => {
    const { selected } = renderEditors();
    fireEvent.click(screen.getByTestId("open-intro"));
    expect(buffer()).toBe("<p>Intro body</p>");
    expect(selected).toEqual(["intro"]);
  });

  it("opens a snippet or asset", () => {
    renderEditors();
    fireEvent.click(screen.getByTestId("open-greeting"));
    expect(buffer()).toBe("<p>Hello</p>");
    fireEvent.click(screen.getByTestId("open-fig"));
    expect(buffer()).toBe("<latex-image>x</latex-image>");
  });

  it("opens nothing for a ref naming nothing", () => {
    const { selected } = renderEditors();
    const before = buffer();
    fireEvent.click(screen.getByTestId("open-missing"));
    expect(buffer()).toBe(before);
    expect(selected).toEqual([]);
  });
});
