/**
 * @vitest-environment jsdom
 *
 * A click in the preview reports a line of the text the renderer was handed —
 * for a division in context, the bare fragment. The editor must translate it
 * against that same text: translating against the wrapped document instead
 * put every click as many lines out as the `<pretext>`, docinfo and
 * `<article>` lines in front of the fragment.
 */
import { describe, it, expect, vi } from "vitest";
import { forwardRef, useImperativeHandle } from "react";
import { render, act } from "@testing-library/react";
import Editors from "../components/Editors";
import type { Division } from "../types/sections";

const revealed: number[] = [];
vi.mock("../components/CodeEditor", () => {
  const Mock = forwardRef((props: { content: string }, ref) => {
    useImperativeHandle(ref, () => ({
      focus: () => {},
      flushPendingChange: () => {},
      revealLine: (line: number) => revealed.push(line),
    }));
    return <textarea data-testid="code-editor" value={props.content} readOnly />;
  });
  return { __esModule: true, default: Mock };
});

type SyncClick = { assembledLine: number; elementId: string };
let latestPreview: { content: string; onSyncToSource?: (click: SyncClick) => void } | null = null;
vi.mock("../components/LivePreview", () => ({
  __esModule: true,
  default: forwardRef((props: { content: string; onSyncToSource?: (click: SyncClick) => void }, ref) => {
    useImperativeHandle(ref, () => ({ rebuild: () => {}, scrollToAssembledLine: () => {} }));
    latestPreview = props;
    return <div data-testid="live-preview" />;
  }),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);

const SECTION = [
  '<section xml:id="one">', // 1
  "<title>One</title>", // 2
  "<p>First.</p>", // 3
  "<p>Second.</p>", // 4
  "<p>Third.</p>", // 5
  "</section>", // 6
].join("\n");

const divisions: Division[] = [
  {
    id: "1",
    xmlId: "doc",
    title: "Main",
    type: "article",
    sourceFormat: "pretext",
    source: '<article xml:id="doc">\n<title>Main</title>\n<plus:section ref="one"/>\n</article>',
  },
  { id: "2", xmlId: "one", title: "One", type: "section", sourceFormat: "pretext", source: SECTION },
];

describe("preview → source sync", () => {
  it("lands on the clicked line of a division previewed in context", () => {
    render(
      <Editors
        divisions={divisions}
        rootDivisionId="doc"
        projectType="article"
        title="Doc"
        // Several docinfo lines, so the wrapped document and the fragment
        // disagree about where the section starts.
        docinfo="<docinfo>\n<macros>\n\\newcommand{\\R}{\\mathbb R}\n</macros>\n</docinfo>"
        activeDivisionId="one"
        topBar={{}}
        onContentChange={() => {}}
        onPreviewRebuild={() => {}}
      />,
    );
    expect(latestPreview?.content).toBe(SECTION);

    // The third paragraph, as the renderer's source map reports it: line 5
    // of the fragment, under an id that names the section as its author.
    act(() => latestPreview?.onSyncToSource?.({ assembledLine: 5, elementId: "one-4" }));
    expect(revealed).toEqual([5]);
  });
});
