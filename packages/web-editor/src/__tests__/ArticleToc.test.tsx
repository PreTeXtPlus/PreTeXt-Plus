/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ArticleToc from "../components/toc/ArticleToc";
import { createEditorStore } from "../store/editorStore";
import { EditorStoreProvider } from "../store/EditorStoreProvider";
import type { Division } from "../types/sections";

const divisions: Division[] = [
  {
    id: "1",
    xmlId: "doc",
    title: "Document",
    type: "article",
    sourceFormat: "pretext",
    source: '<article xml:id="doc"><title>Document</title><plus:section ref="sec"/></article>',
  },
  {
    id: "2",
    xmlId: "sec",
    title: "A section",
    type: "section",
    sourceFormat: "pretext",
    source: '<section xml:id="sec"><title>A section</title></section>',
  },
];

function renderToc(readOnly?: boolean) {
  const { store } = createEditorStore({
    source: divisions[0].source,
    sourceFormat: "pretext",
    title: "Document",
    docinfo: "",
    commonDocinfo: "",
    useCommonDocinfo: false,
    projectType: "article",
    divisions,
    activeDivisionId: "doc",
    projectAssets: undefined,
  });
  return render(
    <EditorStoreProvider store={store}>
      <ArticleToc readOnly={readOnly} />
    </EditorStoreProvider>,
  );
}

describe("ArticleToc", () => {
  it("hides every division menu trigger when readOnly", () => {
    renderToc(true);
    expect(screen.getByText("Document")).toBeInTheDocument();
    expect(screen.getByText("A section")).toBeInTheDocument();
    expect(screen.queryAllByTitle("More options")).toHaveLength(0);
  });

  it("shows division menu triggers by default", () => {
    renderToc(false);
    expect(screen.queryAllByTitle("More options").length).toBeGreaterThan(0);
  });
});
