/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
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

function renderToc(readOnly?: boolean, docDivisions: Division[] = divisions) {
  const { store } = createEditorStore({
    source: docDivisions[0].source,
    sourceFormat: "pretext",
    title: "Document",
    docinfo: "",
    commonDocinfo: "",
    useCommonDocinfo: false,
    language: "en-US",
    divisions: docDivisions,
    activeDivisionId: docDivisions[0].xmlId,
    projectAssets: undefined,
  });
  return render(
    <EditorStoreProvider store={store}>
      <ArticleToc readOnly={readOnly} />
    </EditorStoreProvider>,
  );
}

/** Open the "⋮" menu of the TOC row whose title is `label`. */
function openMenu(label: string) {
  // Matched on the row's own title element: once an edit form is open the
  // label also appears as an <option>, which a plain text query would hit.
  const row = [...document.querySelectorAll('[data-testid^="toc-item-"]')]
    .find(
      (li) =>
        li.querySelector('[data-testid="toc-title"]')?.textContent ===
        label,
    ) as HTMLElement | undefined;
  if (!row) throw new Error(`no TOC row for "${label}"`);
  fireEvent.click(within(row).getByTitle("More options"));
  return row;
}

/** Open "Edit properties" for the row titled `label` and read its Type dropdown. */
function typeChoices(label: string) {
  const row = openMenu(label);
  fireEvent.click(screen.getByText("Edit properties"));
  const select = within(row).getByText("Type").parentElement!
    .querySelector("select") as HTMLSelectElement;
  const choices = {
    options: [...select.options].map((o) => o.value),
    value: select.value,
    disabled: select.disabled,
  };
  fireEvent.click(within(row).getByText("Cancel"));
  return choices;
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

// The Type dropdown is what Save persists, so anything it offers is a
// structure the author can produce with one click. These pin down that it only
// ever offers types valid where the division sits.
describe("ArticleToc division type choices", () => {
  const bookDivisions: Division[] = [
    {
      id: "1",
      xmlId: "bk",
      title: "Book",
      type: "book",
      sourceFormat: "pretext",
      source:
        '<book xml:id="bk"><title>Book</title><plus:chapter ref="ch"/></book>',
    },
    {
      id: "2",
      xmlId: "ch",
      title: "Chapter one",
      type: "chapter",
      sourceFormat: "pretext",
      source:
        '<chapter xml:id="ch"><title>Chapter one</title><plus:introduction ref="intro"/><plus:section ref="sec"/></chapter>',
    },
    {
      id: "3",
      xmlId: "intro",
      title: "",
      type: "introduction",
      sourceFormat: "pretext",
      source: '<introduction xml:id="intro"><p>Hello.</p></introduction>',
    },
    {
      id: "4",
      xmlId: "sec",
      title: "A section",
      type: "section",
      sourceFormat: "pretext",
      source:
        '<section xml:id="sec"><title>A section</title><plus:exercises ref="ex"/></section>',
    },
    {
      id: "5",
      xmlId: "ex",
      title: "Exercises",
      type: "exercises",
      sourceFormat: "pretext",
      source: '<exercises xml:id="ex"><title>Exercises</title></exercises>',
    },
  ];

  it("offers the root only the root document types", () => {
    renderToc(false, bookDivisions);
    expect(typeChoices("Book")).toEqual({
      options: ["article", "book"],
      value: "book",
      disabled: false,
    });
  });

  it("offers a book's child no section-level types", () => {
    renderToc(false, bookDivisions);
    const { options, value } = typeChoices("Chapter one");
    expect(value).toBe("chapter");
    expect(options.slice(0, 2)).toEqual(["chapter", "part"]);
    expect(options).not.toContain("section");
    expect(options).not.toContain("subsection");
  });

  it("offers a chapter's child sections, not chapters or subsections", () => {
    renderToc(false, bookDivisions);
    const { options, value } = typeChoices("A section");
    expect(value).toBe("section");
    expect(options).toContain("section");
    expect(options).toContain("worksheet");
    expect(options).not.toContain("chapter");
    expect(options).not.toContain("part");
    expect(options).not.toContain("subsection");
  });

  it("keeps an introduction an introduction instead of silently retyping it", () => {
    renderToc(false, bookDivisions);
    const { options, value } = typeChoices("Introduction");
    expect(value).toBe("introduction");
    expect(options[0]).toBe("introduction");
  });

  it("offers no way to nest a division under a leaf type", () => {
    renderToc(false, bookDivisions);
    // <exercises> holds exercises, not divisions — there is no valid child
    // type for one, so it offers no "Add new division" at all.
    openMenu("Exercises");
    expect(screen.getByText("Edit properties")).toBeInTheDocument();
    expect(screen.queryByText("Add new division")).toBeNull();
    openMenu("A section");
    expect(screen.getByText("Add new division")).toBeInTheDocument();
  });

  it("offers a section's child subsections", () => {
    const nested: Division[] = [
      ...divisions.slice(0, 1),
      {
        ...divisions[1],
        source:
          '<section xml:id="sec"><title>A section</title><plus:subsection ref="sub"/></section>',
      },
      {
        id: "3",
        xmlId: "sub",
        title: "A subsection",
        type: "subsection",
        sourceFormat: "pretext",
        source:
          '<subsection xml:id="sub"><title>A subsection</title></subsection>',
      },
    ];
    renderToc(false, nested);
    // The subsection sits under a section, so it's the *section*'s rules that
    // apply to it: subsection, yes; another section or a subsubsection, no.
    const { options, value } = typeChoices("A subsection");
    expect(value).toBe("subsection");
    expect(options).toContain("subsection");
    expect(options).not.toContain("section");
    expect(options).not.toContain("subsubsection");
  });

  it("restricts an unplaced division to what the root would accept", () => {
    // An orphan is placed under the root by "Place in document", so the root's
    // rules are the ones that apply — an article project must never offer
    // Part or Chapter.
    const withOrphan: Division[] = [
      ...divisions,
      {
        id: "3",
        xmlId: "orph",
        title: "Unplaced thing",
        type: "section",
        sourceFormat: "pretext",
        source:
          '<section xml:id="orph"><title>Unplaced thing</title></section>',
      },
    ];
    renderToc(false, withOrphan);
    const { options, value } = typeChoices("Unplaced thing");
    expect(value).toBe("section");
    expect(options).toContain("section");
    expect(options).not.toContain("chapter");
    expect(options).not.toContain("part");
  });

  it("lets an article root switch to a book", () => {
    // Article and book hold the same children, so swapping the root tag leaves
    // a valid document — this is the one root conversion that is offered.
    renderToc(false, divisions);
    const { options, value, disabled } = typeChoices("Document");
    expect(value).toBe("article");
    expect(options).toEqual(["article", "book"]);
    expect(disabled).toBe(false);
  });

  // A one-line regression waiting to happen: the dropdown used to be built as
  // `[draft.type, ...SWITCHABLE_ROOT_TYPES]` for any root outside the
  // switchable set, which silently offered Article and Book to a slideshow.
  // Taking either would strand <slide> elements in a root that cannot hold
  // them and invalidate every reveal.js/Beamer target on the project.
  it("offers a slideshow root no conversion target at all", () => {
    const deck: Division[] = [
      {
        id: "1",
        xmlId: "deck",
        title: "My Deck",
        type: "slideshow",
        sourceFormat: "pretext",
        source:
          '<slideshow xml:id="deck"><title>My Deck</title><plus:section ref="sec"/></slideshow>',
      },
      divisions[1],
    ];
    renderToc(false, deck);
    const { options, value, disabled } = typeChoices("My Deck");
    expect(value).toBe("slideshow");
    expect(options).toEqual(["slideshow"]);
    expect(disabled).toBe(true);
  });

  it("renders divisions that arrive with no type at all", () => {
    // The host derives a division's type from its source and generally sends
    // one only for the root (the Rails app does exactly this), so the TOC has
    // to survive typeless records — `Editors` backfills them on load, but
    // nothing may throw before that happens.
    const typeless = [
      { ...divisions[0] },
      { ...divisions[1], type: undefined as unknown as Division["type"] },
    ];
    expect(() => renderToc(false, typeless)).not.toThrow();
    expect(screen.getByText("A section")).toBeInTheDocument();
    const { options } = typeChoices("A section");
    expect(options).toContain("section");
  });

  it("shows the type the division actually has as the selected option", () => {
    // A <select> whose value isn't among its options silently displays the
    // first one, so every row's displayed type must be its real type.
    renderToc(false, bookDivisions);
    for (const [label, type] of [
      ["Book", "book"],
      ["Chapter one", "chapter"],
      ["Introduction", "introduction"],
      ["A section", "section"],
      ["Exercises", "exercises"],
    ] as const) {
      const { options, value } = typeChoices(label);
      expect(value, label).toBe(type);
      expect(options, label).toContain(type);
    }
  });
});
