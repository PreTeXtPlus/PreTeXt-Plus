/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import DivisionList from "../components/toc/DivisionList";
import type { Division } from "../types/sections";
import {
  divisions,
  openMenu,
  renderWithStore,
  typeChoices,
} from "./tocTestUtils";

const withOrphan: Division[] = [
  ...divisions,
  {
    id: "3",
    xmlId: "orph",
    title: "Unplaced thing",
    type: "section",
    sourceFormat: "pretext",
    source:
      '<section xml:id="orph"><title>Unplaced thing</title><plus:subsection ref="orphchild"/></section>',
  },
  {
    id: "4",
    xmlId: "orphchild",
    title: "Unplaced child",
    type: "subsection",
    sourceFormat: "pretext",
    source:
      '<subsection xml:id="orphchild"><title>Unplaced child</title></subsection>',
  },
];

const rowTitles = () =>
  [...document.querySelectorAll('[data-testid="toc-title"]')].map(
    (el) => el.textContent,
  );

describe("DivisionList", () => {
  it("lists the root, placed divisions, then unplaced ones", () => {
    renderWithStore(<DivisionList />, withOrphan);
    expect(rowTitles()).toEqual([
      "Document",
      "A section",
      "Unplaced thing",
      "Unplaced child",
    ]);
  });

  it("marks only unplaced divisions as not placed", () => {
    renderWithStore(<DivisionList />, withOrphan);
    const row = (xmlId: string) => screen.getByTestId(`toc-item-${xmlId}`);
    expect(within(row("sec")).queryByText(/not placed/)).toBeNull();
    expect(within(row("orph")).getByText(/not placed/)).toBeInTheDocument();
    expect(within(row("orphchild")).getByText(/not placed/)).toBeInTheDocument();
  });

  it("hides every division menu trigger when readOnly", () => {
    renderWithStore(<DivisionList readOnly />, withOrphan);
    expect(screen.queryAllByTitle("More options")).toHaveLength(0);
  });

  it("offers placement only for the head of an unplaced subtree", () => {
    // One render per menu: an open menu stays open when another is opened.
    const menuFor = (label: string) => {
      const { unmount } = renderWithStore(<DivisionList />, withOrphan);
      openMenu(label);
      const labels = new Set(
        [
          "Place in document",
          "Insert at cursor",
          "Remove from document",
        ].filter((l) => screen.queryByText(l)),
      );
      unmount();
      return labels;
    };
    expect(menuFor("Unplaced thing")).toEqual(
      new Set(["Place in document", "Insert at cursor"]),
    );
    expect(menuFor("Unplaced child")).toEqual(new Set(["Insert at cursor"]));
    expect(menuFor("A section")).toEqual(new Set(["Remove from document"]));
  });

  it("restricts an unplaced division to what the root would accept", () => {
    // An orphan is placed under the root by "Place in document", so the root's
    // rules are the ones that apply — an article project must never offer
    // Part or Chapter.
    renderWithStore(<DivisionList />, withOrphan);
    const { options, value } = typeChoices("Unplaced thing");
    expect(value).toBe("section");
    expect(options).toContain("section");
    expect(options).not.toContain("chapter");
    expect(options).not.toContain("part");
  });
});
