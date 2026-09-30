/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import type { Division } from "../types/sections";
import {
  divisions,
  expandAll,
  openSettings,
  renderWithStore,
  tocRow,
  toggleRow,
  typeChoices,
  visibleTitles,
  type TestStore,
} from "./tocTestUtils";
import TocWithSettings from "./TocWithSettings";

function renderToc(
  readOnly?: boolean,
  docDivisions: Division[] = divisions,
  configure?: (store: TestStore) => void,
) {
  return renderWithStore(
    <TocWithSettings readOnly={readOnly} />,
    docDivisions,
    configure,
  );
}

// book › chapter › (introduction, section › exercises)
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

describe("ArticleToc", () => {
  it("has no per-row menus: a row only opens its division", () => {
    const { store } = renderToc(false);
    expect(screen.queryAllByTitle("More options")).toHaveLength(0);
    fireEvent.click(within(tocRow("A section")).getByTestId("toc-title"));
    expect(store.getState().openItem).toEqual({ kind: "division", ref: "sec" });
    expect(screen.getByTestId("editor-target-title")).toHaveTextContent(
      "A section",
    );
    expect(
      within(tocRow("A section")).getByRole("button", { current: true }),
    ).toBeInTheDocument();
  });

  it("offers no division settings when readOnly", () => {
    renderToc(true);
    expect(tocRow("Document")).toBeInTheDocument();
    expect(tocRow("A section")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-drawer-toggle")).toBeNull();
  });
});

describe("ArticleToc properties form", () => {
  it("opens with the title focused and selected", () => {
    renderToc(false);
    const drawer = openSettings("A section");
    const title = within(drawer).getByDisplayValue("A section") as HTMLInputElement;
    expect(document.activeElement).toBe(title);
    expect(title.selectionStart).toBe(0);
    expect(title.selectionEnd).toBe("A section".length);
  });
});

// The Type dropdown is what Save persists, so anything it offers is a
// structure the author can produce with one click. These pin down that it only
// ever offers types valid where the division sits.
describe("ArticleToc division type choices", () => {
  const renderToc = (readOnly?: boolean, docDivisions?: Division[]) =>
    renderWithStore(
      <TocWithSettings readOnly={readOnly} />,
      docDivisions,
      expandAll,
    );


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
    let drawer = openSettings("Exercises");
    expect(within(drawer).getByText("Type")).toBeInTheDocument();
    expect(within(drawer).queryByText("Add new division")).toBeNull();
    drawer = openSettings("A section");
    expect(within(drawer).getByText("Add new division")).toBeInTheDocument();
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

describe("ArticleToc expand/collapse", () => {
  // Two unplaced divisions: a chapter heading its own two-deep subtree, and a
  // lone section.
  const withOrphans: Division[] = [
    ...bookDivisions,
    {
      id: "6",
      xmlId: "loose",
      title: "Loose chapter",
      type: "chapter",
      sourceFormat: "pretext",
      source:
        '<chapter xml:id="loose"><title>Loose chapter</title><plus:section ref="loose-sec"/></chapter>',
    },
    {
      id: "7",
      xmlId: "loose-sec",
      title: "Loose section",
      type: "section",
      sourceFormat: "pretext",
      source:
        '<section xml:id="loose-sec"><title>Loose section</title><plus:subsection ref="loose-sub"/></section>',
    },
    {
      id: "8",
      xmlId: "loose-sub",
      title: "Loose subsection",
      type: "subsection",
      sourceFormat: "pretext",
      source:
        '<subsection xml:id="loose-sub"><title>Loose subsection</title></subsection>',
    },
    {
      id: "9",
      xmlId: "stray",
      title: "Stray section",
      type: "section",
      sourceFormat: "pretext",
      source: '<section xml:id="stray"><title>Stray section</title></section>',
    },
  ];

  const unplacedHeader = () =>
    screen.getByText("Unplaced divisions").closest("button")!;

  it("opens showing only the root's children", () => {
    renderToc(false, bookDivisions);
    expect(visibleTitles()).toEqual(["Book", "Chapter one"]);
  });

  it("opens and shuts a row from its chevron", () => {
    renderToc(false, bookDivisions);
    toggleRow("Chapter one");
    expect(visibleTitles()).toEqual([
      "Book",
      "Chapter one",
      "Introduction",
      "A section",
    ]);
    toggleRow("Chapter one");
    expect(visibleTitles()).toEqual(["Book", "Chapter one"]);
  });

  it("shuts the whole tree from the root's chevron", () => {
    renderToc(false, bookDivisions);
    toggleRow("Book");
    expect(visibleTitles()).toEqual(["Book"]);
  });

  it("opens the rows above the division that is active on load", () => {
    renderToc(false, bookDivisions, (store) =>
      store.getState().openDivision("ex"),
    );
    expect(visibleTitles()).toEqual([
      "Book",
      "Chapter one",
      "Introduction",
      "A section",
      "Exercises",
    ]);
  });

  it("opens the rows above a division that becomes active", () => {
    const { store } = renderToc(false, bookDivisions);
    act(() => store.getState().openDivision("sec"));
    expect(visibleTitles()).toContain("A section");
  });

  it("opens a division that becomes active one level deep", () => {
    const { store } = renderToc(false, bookDivisions);
    act(() => store.getState().openDivision("ch"));
    // The chapter's children show, but the section below it stays shut.
    expect(visibleTitles()).toEqual([
      "Book",
      "Chapter one",
      "Introduction",
      "A section",
    ]);
  });

  it("opens a division when the author selects it in the TOC", () => {
    renderToc(false, bookDivisions);
    fireEvent.click(within(tocRow("Chapter one")).getByTestId("toc-title"));
    expect(visibleTitles()).toContain("A section");
  });

  it("leaves shut an active division the author has since shut", () => {
    const { store } = renderToc(false, bookDivisions);
    act(() => store.getState().openDivision("ch"));
    toggleRow("Chapter one");
    expect(visibleTitles()).toEqual(["Book", "Chapter one"]);
  });

  it("opens a shut row that a new division is being added to", () => {
    const { store } = renderToc(false, bookDivisions);
    const drawer = openSettings("Chapter one");
    // Opening the chapter reveals it; shut it again so adding has to reopen it.
    toggleRow("Chapter one");
    expect(store.getState().tocExpansion.ch).toBe(false);
    fireEvent.click(within(drawer).getByText("Add new division"));
    expect(store.getState().tocExpansion.ch).toBe(true);
    expect(visibleTitles()).toContain("A section");
  });

  it("keeps a renamed row open", () => {
    const { store } = renderToc(false, bookDivisions);
    toggleRow("Chapter one");
    act(() => store.getState().patchDivision("ch", { xmlId: "ch-renamed" }));
    const { tocExpansion } = store.getState();
    expect(tocExpansion["ch-renamed"]).toBe(true);
    expect(tocExpansion).not.toHaveProperty("ch");
  });

  it("lists unplaced divisions shut, one row per dangling subtree", () => {
    renderToc(false, withOrphans);
    expect(visibleTitles()).toEqual([
      "Book",
      "Chapter one",
      "Loose chapter",
      "Stray section",
    ]);
    expect(unplacedHeader()).toHaveTextContent("2");
  });

  it("opens an unplaced subtree one level at a time", () => {
    renderToc(false, withOrphans);
    toggleRow("Loose chapter");
    expect(visibleTitles()).toContain("Loose section");
    expect(visibleTitles()).not.toContain("Loose subsection");
    toggleRow("Loose section");
    expect(visibleTitles()).toContain("Loose subsection");
  });

  it("folds the unplaced block down to its header", () => {
    const { store } = renderToc(false, withOrphans);
    expect(unplacedHeader()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(unplacedHeader());
    expect(unplacedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(visibleTitles()).toEqual(["Book", "Chapter one"]);
    expect(store.getState().isTocOrphansCollapsed).toBe(true);
    fireEvent.click(unplacedHeader());
    expect(visibleTitles()).toContain("Stray section");
  });

  it("unfolds the unplaced block to show an active division inside it", () => {
    renderToc(false, withOrphans, (store) => {
      store.getState().toggleTocOrphansCollapsed();
      store.getState().openDivision("loose-sub");
    });
    expect(unplacedHeader()).toHaveAttribute("aria-expanded", "true");
    expect(visibleTitles()).toContain("Loose subsection");
  });
});
