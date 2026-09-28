/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import ProjectExplorer, {
  type ProjectExplorerProps,
} from "../components/ProjectExplorer";
import type { Division } from "../types/sections";
import {
  divisions,
  renderWithStore,
  toggleRow,
  visibleTitles,
} from "./tocTestUtils";

const withOrphan: Division[] = [
  ...divisions,
  {
    id: "3",
    xmlId: "orph",
    title: "Unplaced thing",
    type: "section",
    sourceFormat: "pretext",
    source: '<section xml:id="orph"><title>Unplaced thing</title></section>',
  },
];

function renderExplorer(props: Partial<ProjectExplorerProps> = {}) {
  return renderWithStore(
    <ProjectExplorer
      onJumpToMatch={vi.fn()}
      onReplaceMatches={vi.fn()}
      {...props}
    />,
    withOrphan,
    // Start expanded regardless of what an earlier test left in storage.
    (store) => store.getState().setIsTocCollapsed(false),
  );
}

const tab = (view: string) => screen.getByTestId(`explorer-tab-${view}`);

describe("ProjectExplorer", () => {
  beforeEach(() => localStorage.clear());

  it("opens on the Contents view, with unplaced divisions below the tree", () => {
    renderExplorer();
    expect(tab("toc")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("A section")).toBeInTheDocument();
    expect(screen.getByText("Unplaced divisions")).toBeInTheDocument();
    expect(screen.getByText("Unplaced thing")).toBeInTheDocument();
  });

  it("switches views from the rail", () => {
    renderExplorer();
    fireEvent.click(tab("assets"));
    expect(tab("assets")).toHaveAttribute("aria-pressed", "true");
    expect(tab("toc")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("A section")).toBeNull();
  });

  it("collapses to the rail when the open view's icon is clicked", () => {
    const { store } = renderExplorer();
    fireEvent.click(tab("toc"));
    expect(store.getState().isTocCollapsed).toBe(true);
    expect(screen.queryByText("A section")).toBeNull();
    // The rail stays, and any icon brings the panel back.
    expect(tab("toc")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(tab("snippets"));
    expect(store.getState().isTocCollapsed).toBe(false);
    expect(screen.getByText("No snippets in this project yet.")).toBeInTheDocument();
  });

  it("keeps the Contents tree's shape across view switches", () => {
    // Switching views unmounts the tree, so its shape has to live in the store.
    const nested: Division[] = [
      {
        ...withOrphan[0],
        source:
          '<article xml:id="doc"><title>Document</title><plus:section ref="sec"/><plus:section ref="sec2"/></article>',
      },
      {
        ...withOrphan[1],
        source:
          '<section xml:id="sec"><title>A section</title><plus:subsection ref="sub"/></section>',
      },
      {
        id: "4",
        xmlId: "sec2",
        title: "Another section",
        type: "section",
        sourceFormat: "pretext",
        source:
          '<section xml:id="sec2"><title>Another section</title><plus:subsection ref="sub2"/></section>',
      },
      {
        id: "5",
        xmlId: "sub",
        title: "A subsection",
        type: "subsection",
        sourceFormat: "pretext",
        source: '<subsection xml:id="sub"><title>A subsection</title></subsection>',
      },
      {
        id: "6",
        xmlId: "sub2",
        title: "Another subsection",
        type: "subsection",
        sourceFormat: "pretext",
        source:
          '<subsection xml:id="sub2"><title>Another subsection</title></subsection>',
      },
      withOrphan[2],
    ];
    renderWithStore(
      <ProjectExplorer onJumpToMatch={vi.fn()} onReplaceMatches={vi.fn()} />,
      nested,
      (store) => {
        store.getState().setIsTocCollapsed(false);
        store.getState().setActiveDivisionId("sub");
      },
    );
    // Opened on load to show the active subsection; the author then shuts
    // that branch, opens the other one and folds the unplaced block.
    expect(visibleTitles()).toContain("A subsection");
    toggleRow("A section");
    toggleRow("Another section");
    fireEvent.click(screen.getByText("Unplaced divisions"));
    const shape = [
      "Document",
      "A section",
      "Another section",
      "Another subsection",
    ];
    expect(visibleTitles()).toEqual(shape);

    fireEvent.click(tab("snippets"));
    fireEvent.click(tab("toc"));
    expect(visibleTitles()).toEqual(shape);
    expect(
      screen.getByText("Unplaced divisions").closest("button"),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("omits the icons for hidden snippets and assets", () => {
    renderExplorer({ hideSnippets: true, hideAssets: true });
    expect(screen.queryByTestId("explorer-tab-snippets")).toBeNull();
    expect(screen.queryByTestId("explorer-tab-assets")).toBeNull();
    expect(tab("find")).toBeInTheDocument();
  });

  it("falls back to Contents when the stored view is hidden", () => {
    renderWithStore(
      <ProjectExplorer
        hideAssets
        onJumpToMatch={vi.fn()}
        onReplaceMatches={vi.fn()}
      />,
      withOrphan,
      (store) => store.getState().showExplorerView("assets"),
    );
    expect(tab("toc")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("A section")).toBeInTheDocument();
  });

  it("shows the find panel, and Escape collapses it", () => {
    const { store } = renderExplorer();
    fireEvent.click(tab("find"));
    expect(screen.getByText("Find in Project")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(store.getState().isTocCollapsed).toBe(true);
  });

  it("ignores Escape when the find view isn't open", () => {
    const { store } = renderExplorer();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(store.getState().isTocCollapsed).toBe(false);
  });
});
