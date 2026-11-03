/**
 * A child division's type is written down twice: on the division's own record,
 * and in the `<plus:TYPE ref="…"/>` placeholder its parent uses to position it.
 * The record decides: retyping it from the TOC rewrites the placeholder, but
 * typing a different tag changes nothing about the division, and is left for the
 * placement lint to warn about.
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
import { openSettings } from "./tocTestUtils";
import { legacyDivisions } from "./legacyDivision";

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
  return legacyDivisions([
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
  ]);
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
      topBar={{}}
      onContentChange={(c) => changes.push(c)}
      onDivisionUpdate={(xmlId, c) => updates.push({ xmlId, changes: c })}
    />,
  );
  /** The last source emitted for `xmlId`, or undefined if it never changed. */
  const sourceOf = (xmlId: string) => {
    const forDivision = changes.filter((c) => "xmlId" in c && c.xmlId === xmlId);
    return forDivision[forDivision.length - 1]?.source;
  };
  /** The last type reported for `xmlId`'s record, if any. */
  const typeOf = (xmlId: string) => {
    const typed = updates.filter((u) => u.xmlId === xmlId && u.changes.type);
    return typed[typed.length - 1]?.changes.type;
  };
  return { changes, updates, sourceOf, typeOf };
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

/** Change the Type dropdown of `label`'s settings, which saves it at once. */
function retypeFromToc(label: string, type: string) {
  const drawer = openSettings(label);
  const select = within(drawer).getByText("Type").parentElement!
    .querySelector("select") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: type } });
}

/** Retype the active division's source in the (mocked) code editor. */
function typeIntoEditor(source: string) {
  fireEvent.change(screen.getByTestId("code-editor"), {
    target: { value: source },
  });
}

describe("retyping a division from the TOC", () => {
  it("retypes the child's record and rewrites the parent's include macro", () => {
    const { sourceOf, typeOf } = renderEditors(latexProject());
    retypeFromToc("Day 1", "worksheet");

    expect(typeOf("day-1")).toBe("worksheet");
    expect(sourceOf("doc")).toContain("\\plus{worksheet}{day-1}");
    expect(sourceOf("doc")).not.toContain("\\plus{handout}{day-1}");
  });

  // `\plus{handout}{day-1}` inside day-1's own body is malformed markup, not a
  // placement. It used to be found as day-1's own "parent", so the type change
  // rewrote *that* line and left the real parent's macro alone.
  //
  // Which one won was decided by pool order — the host lists divisions with no
  // ORDER BY at all — so both orders are checked: with the root first the old
  // code happened to pick the right division, and the bug only showed up for
  // projects whose rows came back the other way round.
  it.each([
    ["root first", (d: Division[]) => d],
    ["child first", (d: Division[]) => [...d].reverse()],
  ])("ignores a stray self-referencing include inside the child (%s)", (_, order) => {
    const { sourceOf, typeOf } = renderEditors(
      order(latexProject("\n\\plus{handout}{day-1}\n")),
    );
    retypeFromToc("Day 1", "worksheet");

    expect(sourceOf("doc")).toContain("\\plus{worksheet}{day-1}");
    expect(typeOf("day-1")).toBe("worksheet");
    // The stray line is left exactly as authored, to be fixed by its author.
    expect(sourceOf("day-1")).toBeUndefined();
  });

  it("ignores an include shown as an example in a verbatim block", () => {
    const divisions = latexProject();
    divisions.splice(1, 0, {
      id: "3",
      xmlId: "howto",
      title: "How to include",
      type: "section",
      sourceFormat: "latex",
      source: "\\begin{verbatim}\n\\plus{handout}{day-1}\n\\end{verbatim}\n",
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

describe("typing a different tag in a parent's include macro", () => {
  it("does not retype the child", () => {
    const { sourceOf, updates } = renderEditors(latexProject());
    typeIntoEditor("Some prose.\n\n\\plus{worksheet}{day-1}\n");

    expect(sourceOf("doc")).toContain("\\plus{worksheet}{day-1}");
    expect(sourceOf("day-1")).toBeUndefined();
    expect(updates.some((u) => u.xmlId === "day-1")).toBe(false);
    expect(tocRow("Day 1").querySelector("button[title]")).toHaveProperty(
      "title",
      "Handout",
    );
  });

  it("still creates a division for a ref nothing has", () => {
    renderEditors(latexProject());
    typeIntoEditor("\\plus{handout}{day-1}\n\\plus{worksheet}{day-2}\n");

    expect(tocRow("New Worksheet").querySelector("button[title]")).toHaveProperty(
      "title",
      "Worksheet",
    );
  });

  it("creates no division for a ref another kind of record holds", () => {
    const added: string[] = [];
    render(
      <Editors
        divisions={latexProject()}
        rootDivisionId="doc"
        projectType="article"
        title="Doc"
        topBar={{}}
        onContentChange={() => {}}
        projectSnippets={[{ ref: "fact", source: "<p/>", sourceFormat: "pretext" }]}
        projectExercises={[{ ref: "ex", source: "" }]}
        projectAssets={[{ ref: "graph", isFile: true }] as never}
        onDivisionAdd={(d) => {
          added.push(d.xmlId);
        }}
      />,
    );
    typeIntoEditor(
      "\\plus{handout}{day-1}\n\\plus{section}{fact}\n\\plus{section}{ex}\n\\plus{section}{graph}\n",
    );

    expect(added).toEqual([]);
    // Contents has no division to show for any of them, and doesn't invent one.
    expect(tocRow("Day 1")).toBeTruthy();
    expect(document.querySelectorAll('[data-testid^="toc-item-"]')).toHaveLength(2);
  });
});
