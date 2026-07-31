/**
 * Adding a division from the TOC: the new division has to be a type its parent
 * actually allows, both in the record that's created and in the `<plus:* ref/>`
 * placeholder written into the parent — otherwise dismissing the properties
 * form leaves an invalid structure behind.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import Editors from "../components/Editors";
import type { Division } from "../types/sections";
import type { EditorContentChange } from "../types/editor";

// Monaco loads itself from a CDN; the TOC is what's under test here.
vi.mock("@monaco-editor/react", () => ({
  default: () => <div data-testid="monaco-mock" />,
  Editor: () => <div data-testid="monaco-mock" />,
  loader: { config: () => {}, init: () => new Promise(() => {}) },
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);

const bookDivisions: Division[] = [
  {
    id: "1",
    xmlId: "bk",
    title: "Book",
    type: "book",
    sourceFormat: "pretext",
    source:
      '<book xml:id="bk">\n<title>Book</title>\n<plus:chapter ref="ch"/>\n</book>',
  },
  {
    id: "2",
    xmlId: "ch",
    title: "Chapter one",
    type: "chapter",
    sourceFormat: "pretext",
    source: '<chapter xml:id="ch">\n<title>Chapter one</title>\n</chapter>',
  },
];

function renderEditors(divisions: Division[]) {
  const added: Division[] = [];
  const changes: EditorContentChange[] = [];
  render(
    <Editors
      divisions={divisions}
      rootDivisionId={divisions[0].xmlId}
      projectType={divisions[0].type === "book" ? "book" : "article"}
      title="Doc"
      onContentChange={(c) => changes.push(c)}
      onDivisionAdd={(d) => {
        added.push(d);
      }}
    />,
  );
  return { added, changes };
}

/** Click "Add new division" in the menu of the TOC row titled `label`. */
function addDivisionUnder(label: string) {
  const row = [...document.querySelectorAll("li.pretext-plus-editor__toc-item")]
    .find(
      (li) =>
        li.querySelector(".pretext-plus-editor__toc-title")?.textContent ===
        label,
    ) as HTMLElement | undefined;
  if (!row) throw new Error(`no TOC row for "${label}"`);
  fireEvent.click(within(row).getByTitle("More options"));
  fireEvent.click(screen.getByText("Add new division"));
}

/** The Type dropdown of the open properties form. */
function openTypeSelect() {
  const label = screen.getByText("Type").parentElement!;
  return label.querySelector("select") as HTMLSelectElement;
}

describe("adding a division", () => {
  it("creates a chapter, not a section, under a book", () => {
    const { added, changes } = renderEditors(bookDivisions);
    addDivisionUnder("Book");

    expect(added).toHaveLength(1);
    expect(added[0].type).toBe("chapter");
    expect(added[0].source).toContain("<chapter ");

    // The placeholder written into the parent names the same type.
    const parentChange = changes.find((c) => c.xmlId === "bk");
    expect(parentChange?.source).toContain(
      `<plus:chapter ref="${added[0].xmlId}"/>`,
    );

    // …and the form that opens offers only what a book accepts.
    const select = openTypeSelect();
    expect(select.value).toBe("chapter");
    const options = [...select.options].map((o) => o.value);
    expect(options).toContain("part");
    expect(options).not.toContain("section");
  });

  it("creates a section under a chapter", () => {
    const { added } = renderEditors(bookDivisions);
    addDivisionUnder("Chapter one");

    expect(added[0].type).toBe("section");
    expect(added[0].source).toContain("<section ");
    expect(openTypeSelect().value).toBe("section");
  });

  it("restricts choices for divisions the host sent without a type", () => {
    // How a real host loads a project: only the root carries a type, because
    // every other division's type lives in its own source. `Editors` recovers
    // them on load — without that the TOC can't tell a chapter from a
    // subsection and offers every type everywhere.
    const untyped = bookDivisions.map((d, i) =>
      i === 0 ? d : { ...d, type: undefined as unknown as Division["type"] },
    );
    renderEditors(untyped);

    expect(screen.getByText("Chapter one")).toBeInTheDocument();
    addDivisionUnder("Chapter one");
    const options = [...openTypeSelect().options].map((o) => o.value);
    expect(options).toContain("section");
    expect(options).not.toContain("chapter");
    expect(options).not.toContain("part");
  });

  it("creates a section under an article root", () => {
    const { added } = renderEditors([
      {
        id: "1",
        xmlId: "doc",
        title: "Document",
        type: "article",
        sourceFormat: "pretext",
        source: '<article xml:id="doc">\n<title>Document</title>\n</article>',
      },
    ]);
    addDivisionUnder("Document");

    expect(added[0].type).toBe("section");
    const options = [...openTypeSelect().options].map((o) => o.value);
    expect(options).toContain("section");
    expect(options).not.toContain("chapter");
  });
});
