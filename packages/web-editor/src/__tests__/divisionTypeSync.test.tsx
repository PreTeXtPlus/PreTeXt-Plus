/**
 * A child division's type is written down twice: in the division's own source
 * header, and in the `<plus:TYPE ref="…"/>` placeholder its parent uses to
 * position it. The assembled document reads only the former — the placeholder's
 * tag is a mirror — so the two have to be kept equal from whichever side the
 * author edits, or the TOC and the source start disagreeing about what a
 * division is.
 *
 * These exercise both directions end to end, and the malformed case that made
 * the TOC direction land on the wrong line: a stray copy of the include pasted
 * *inside* the division it points at.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import Editors from "../components/Editors";
import type { Division } from "../types/sections";
import type { EditorContentChange } from "../types/editor";
import type { DivisionChanges } from "../store/editorStore";

// Monaco loads itself from a CDN. Standing in a plain textarea keeps the real
// `onChange` wiring (which is what's under test for the source direction) while
// skipping the editor's own debounce.
vi.mock("../components/CodeEditor", () => ({
  __esModule: true,
  default: (props: {
    content: string;
    onChange: (value: string | undefined) => void;
  }) => (
    <textarea
      data-testid="code-editor"
      value={props.content}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  globalThis.ResizeObserver ?? (ResizeObserverStub as never);

/** An article that includes one handout, both authored in LaTeX. */
function latexProject(handoutBody = ""): Division[] {
  return [
    {
      id: "1",
      xmlId: "doc",
      title: "Main",
      type: "article",
      sourceFormat: "latex",
      source: "\\article{Main}\\label{doc}\n\nSome prose.\n\n\\plus{handout}{day-1}\n",
    },
    {
      id: "2",
      xmlId: "day-1",
      title: "Day 1",
      type: "handout",
      sourceFormat: "latex",
      source: `\\handout{Day 1}\\label{day-1}\n\nActivities.\n${handoutBody}`,
    },
  ];
}

function renderEditors(divisions: Division[]) {
  const changes: EditorContentChange[] = [];
  const updates: { xmlId: string; changes: DivisionChanges }[] = [];
  render(
    <Editors
      divisions={divisions}
      rootDivisionId="doc"
      projectType="article"
      title="Doc"
      onContentChange={(c) => changes.push(c)}
      onDivisionUpdate={(xmlId, c) => updates.push({ xmlId, changes: c })}
    />,
  );
  /** The last source emitted for `xmlId`, or undefined if it never changed. */
  const sourceOf = (xmlId: string) => {
    const forDivision = changes.filter((c) => c.xmlId === xmlId);
    return forDivision[forDivision.length - 1]?.source;
  };
  return { changes, updates, sourceOf };
}

/** The TOC row whose title is `label`. */
function tocRow(label: string): HTMLElement {
  const row = [...document.querySelectorAll('[data-testid^="toc-item-"]')].find(
    (li) =>
      li.querySelector('[data-testid="toc-title"]')?.textContent === label,
  ) as HTMLElement | undefined;
  if (!row) throw new Error(`no TOC row for "${label}"`);
  return row;
}

/** Change the Type dropdown of `label`'s "Edit properties" form and save. */
function retypeFromToc(label: string, type: string) {
  const row = tocRow(label);
  fireEvent.click(within(row).getByTitle("More options"));
  fireEvent.click(screen.getByText("Edit properties"));
  const select = within(row).getByText("Type").parentElement!
    .querySelector("select") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: type } });
  fireEvent.click(within(row).getByText("Save"));
}

/** Retype the active division's source in the (mocked) code editor. */
function typeIntoEditor(source: string) {
  fireEvent.change(screen.getByTestId("code-editor"), {
    target: { value: source },
  });
}

describe("retyping a division from the TOC", () => {
  it("rewrites the child's own header and the parent's include macro", () => {
    const { sourceOf } = renderEditors(latexProject());
    retypeFromToc("Day 1", "worksheet");

    expect(sourceOf("day-1")).toContain("\\worksheet{Day 1}\\label{day-1}");
    expect(sourceOf("doc")).toContain("\\plus{worksheet}{day-1}");
    expect(sourceOf("doc")).not.toContain("\\plus{handout}{day-1}");
  });

  // `\plus{handout}{day-1}` inside day-1's own body is malformed markup, not a
  // placement. It used to be found as day-1's own "parent", so the type change
  // rewrote *that* line, left the real parent's macro alone, and clobbered the
  // header rewrite that had just been emitted for the same division.
  //
  // Which one won was decided by pool order — the host lists divisions with no
  // ORDER BY at all — so both orders are checked: with the root first the old
  // code happened to pick the right division, and the bug only showed up for
  // projects whose rows came back the other way round.
  it.each([
    ["root first", (d: Division[]) => d],
    ["child first", (d: Division[]) => [...d].reverse()],
  ])("ignores a stray self-referencing include inside the child (%s)", (_, order) => {
    const { sourceOf } = renderEditors(
      order(latexProject("\n\\plus{handout}{day-1}\n")),
    );
    retypeFromToc("Day 1", "worksheet");

    expect(sourceOf("doc")).toContain("\\plus{worksheet}{day-1}");
    expect(sourceOf("day-1")).toContain("\\worksheet{Day 1}\\label{day-1}");
    // The stray line is left exactly as authored, to be fixed by its author.
    expect(sourceOf("day-1")).toContain("\\plus{handout}{day-1}");
  });

  it("ignores an include shown as an example in a verbatim block", () => {
    const divisions = latexProject();
    divisions.splice(1, 0, {
      id: "3",
      xmlId: "howto",
      title: "How to include",
      type: "section",
      sourceFormat: "latex",
      source:
        "\\section{How to include}\\label{howto}\n\n\\begin{verbatim}\n\\plus{handout}{day-1}\n\\end{verbatim}\n",
    });
    divisions[0].source = divisions[0].source.replace(
      "\\plus{handout}{day-1}",
      "\\plus{section}{howto}\n\\plus{handout}{day-1}",
    );
    const { sourceOf } = renderEditors(divisions);
    retypeFromToc("Day 1", "worksheet");

    expect(sourceOf("doc")).toContain("\\plus{worksheet}{day-1}");
    expect(sourceOf("howto")).toBeUndefined();
  });
});

describe("retyping a division from its parent's include macro", () => {
  it("rewrites the child's own header and record type", () => {
    const { sourceOf, updates } = renderEditors(latexProject());
    typeIntoEditor(
      "\\article{Main}\\label{doc}\n\nSome prose.\n\n\\plus{worksheet}{day-1}\n",
    );

    expect(sourceOf("day-1")).toContain("\\worksheet{Day 1}\\label{day-1}");
    expect(
      updates.find((u) => u.xmlId === "day-1")?.changes.type,
    ).toBe("worksheet");
  });

  it("shows the new type in the TOC", () => {
    renderEditors(latexProject());
    expect(tocRow("Day 1").querySelector("button[title]")).toHaveProperty(
      "title",
      "Handout",
    );

    typeIntoEditor(
      "\\article{Main}\\label{doc}\n\nSome prose.\n\n\\plus{worksheet}{day-1}\n",
    );

    // The TOC labels a row with its division's type, so this is the same fact
    // the properties form would show — read where a user would see it.
    expect(tocRow("Day 1").querySelector("button[title]")).toHaveProperty(
      "title",
      "Worksheet",
    );
  });

  it("does not retype from the generic division alias", () => {
    // `<plus:division ref="…"/>` names no type, so its "section" reading is a
    // default rather than a choice — acting on it would silently demote a
    // worksheet the author picked in the TOC.
    const divisions: Division[] = [
      {
        id: "1",
        xmlId: "doc",
        title: "Main",
        type: "article",
        sourceFormat: "pretext",
        source:
          '<article xml:id="doc"><title>Main</title><plus:worksheet ref="ws"/></article>',
      },
      {
        id: "2",
        xmlId: "ws",
        title: "Worksheet",
        type: "worksheet",
        sourceFormat: "pretext",
        source: '<worksheet xml:id="ws"><title>Worksheet</title></worksheet>',
      },
    ];
    const { sourceOf, updates } = renderEditors(divisions);
    typeIntoEditor(
      '<article xml:id="doc"><title>Main</title><plus:division ref="ws"/></article>',
    );

    expect(sourceOf("ws")).toBeUndefined();
    expect(updates.some((u) => u.xmlId === "ws")).toBe(false);
  });

  it("does not retype the division that holds the stray include", () => {
    // Same malformed markup as above, seen from the other side: typing
    // `\plus{worksheet}{day-1}` into day-1's own body must not retype day-1.
    const divisions = latexProject("\n\\plus{handout}{day-1}\n");
    const { sourceOf, updates } = renderEditors(divisions);
    // Select the handout so its source is what the code editor edits.
    fireEvent.click(screen.getByText("Day 1"));
    typeIntoEditor(
      "\\handout{Day 1}\\label{day-1}\n\nActivities.\n\\plus{worksheet}{day-1}\n",
    );

    expect(sourceOf("day-1")).toContain("\\handout{Day 1}");
    expect(
      updates.some((u) => u.xmlId === "day-1" && u.changes.type === "worksheet"),
    ).toBe(false);
  });
});
