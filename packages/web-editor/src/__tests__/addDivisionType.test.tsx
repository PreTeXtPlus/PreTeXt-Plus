/**
 * Adding a division from the TOC: the type offered by default has to be one the
 * parent actually allows — a `<section>` under a `<book>` is not a valid thing
 * to be proposing — and that type has to survive into both the record created
 * on save and the `<plus:* ref/>` placeholder written into the parent.
 *
 * Nothing is created until the draft is saved, so every assertion about the
 * record or the parent's source comes after `saveDraft`.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import Editors from "../components/Editors";
import type { Division } from "../types/sections";
import type { EditorContentChange } from "../types/editor";
import { tocRow } from "./tocTestUtils";
import { legacyDivisions } from "./legacyDivision";
import { wrapDivisionSource } from "../sectionUtils";

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

const bookDivisions: Division[] = legacyDivisions([
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
]);

function renderEditors(divisions: Division[]) {
  const added: Division[] = [];
  const changes: EditorContentChange[] = [];
  render(
    <Editors
      divisions={divisions}
      rootDivisionId={divisions[0].xmlId}
      projectType={divisions[0].type === "book" ? "book" : "article"}
      title="Doc"
      topBar={{}}
      onContentChange={(c) => changes.push(c)}
      onDivisionAdd={(d) => {
        added.push(d);
      }}
    />,
  );
  return { added, changes };
}

/** Start a new sub-division from the [+] on `label`'s Contents row. */
function addDivisionUnder(label: string) {
  fireEvent.click(within(tocRow(label)).getByTestId("toc-add-child"));
}

/** Save the open draft, creating the division. */
function saveDraft() {
  const form = screen.getByTestId("new-item-pane");
  fireEvent.click(within(form).getByText("Create"));
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

    // The form that opens offers only what a book accepts…
    const select = openTypeSelect();
    expect(select.value).toBe("chapter");
    const options = [...select.options].map((o) => o.value);
    expect(options).toContain("part");
    expect(options).not.toContain("section");

    // …and nothing exists yet.
    expect(added).toHaveLength(0);

    saveDraft();
    expect(added).toHaveLength(1);
    expect(added[0].type).toBe("chapter");
    expect(wrapDivisionSource(added[0])).toContain("<chapter ");

    // The placeholder written into the parent names the same type.
    const parentChange = changes.find((c) => "xmlId" in c && c.xmlId === "bk");
    expect(parentChange?.source).toContain(
      `<plus:chapter ref="${added[0].xmlId}"/>`,
    );
  });

  it("creates a section under a chapter", () => {
    const { added } = renderEditors(bookDivisions);
    addDivisionUnder("Chapter one");
    expect(openTypeSelect().value).toBe("section");

    saveDraft();
    expect(added[0].type).toBe("section");
    expect(wrapDivisionSource(added[0])).toContain("<section ");
  });

  it("creates a section under an article root", () => {
    const { added } = renderEditors([
      {
        id: "1",
        xmlId: "doc",
        title: "Document",
        type: "article",
        sourceFormat: "pretext",
        source: "",
      },
    ]);
    addDivisionUnder("Document");

    const options = [...openTypeSelect().options].map((o) => o.value);
    expect(options).toContain("section");
    expect(options).not.toContain("chapter");

    saveDraft();
    expect(added[0].type).toBe("section");
  });
});
