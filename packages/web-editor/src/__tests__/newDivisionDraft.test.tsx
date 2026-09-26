/**
 * A new division is a *draft* until its properties form is saved: no record, no
 * `<plus:* ref/>` in the parent, nothing sent to the host.
 *
 * That is what makes Cancel mean cancel — it used to leave a real "New Section"
 * behind, placed in the parent and already persisted under a generated id — and
 * it is why creating a division no longer involves a rename: the record is born
 * with the id the author chose, so the parent's placeholder is written once and
 * never has to be rewritten.
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
globalThis.ResizeObserver =
  globalThis.ResizeObserver ?? (ResizeObserverStub as never);

const divisions: Division[] = [
  {
    id: "1",
    xmlId: "doc",
    title: "Main",
    type: "article",
    sourceFormat: "pretext",
    source:
      '<article xml:id="doc">\n<title>Main</title>\n<plus:section ref="one"/>\n</article>',
  },
  {
    id: "2",
    xmlId: "one",
    title: "One",
    type: "section",
    sourceFormat: "pretext",
    source: '<section xml:id="one">\n<title>One</title>\n</section>',
  },
];

function renderEditors() {
  const added: Division[] = [];
  const changes: EditorContentChange[] = [];
  const updates: { xmlId: string; changes: DivisionChanges }[] = [];
  render(
    <Editors
      divisions={structuredClone(divisions)}
      rootDivisionId="doc"
      projectType="article"
      title="Doc"
      topBar={{}}
      onContentChange={(c) => changes.push(c)}
      onDivisionAdd={(d) => {
        added.push(d);
      }}
      onDivisionUpdate={(xmlId, c) => updates.push({ xmlId, changes: c })}
    />,
  );
  const sourceOf = (xmlId: string) => {
    const forDivision = changes.filter((c) => c.xmlId === xmlId);
    return forDivision[forDivision.length - 1]?.source;
  };
  return { added, changes, updates, sourceOf };
}

/** "Add new division" from `label`'s settings drawer. */
function addUnder(label: string) {
  fireEvent.click(within(openSettings(label)).getByText("Add new division"));
}

/** The draft's properties form (in the drawer), and the fields/buttons inside it. */
const draftRow = () => screen.getByTestId("settings-new-division");
const titleField = () =>
  within(draftRow()).getByText("Title").parentElement!
    .querySelector("input") as HTMLInputElement;
const idField = () =>
  within(draftRow()).getByPlaceholderText(
    "unique identifier",
  ) as HTMLInputElement;

describe("a new division is a draft until it is saved", () => {
  it("cancelling leaves the project untouched", () => {
    const { added, changes } = renderEditors();
    addUnder("Main");

    // The draft is on screen, under the parent it will be placed in…
    expect(draftRow()).toBeInTheDocument();
    expect(screen.getByTestId("toc-new-division")).toBeInTheDocument();
    // …but nothing has been created, placed or persisted.
    expect(added).toEqual([]);
    expect(changes).toEqual([]);

    fireEvent.click(within(draftRow()).getByText("Cancel"));

    expect(screen.queryByTestId("toc-new-division")).toBeNull();
    expect(added).toEqual([]);
    expect(changes).toEqual([]);
    // No stray "New Section" row left behind in the TOC.
    expect(
      [...document.querySelectorAll('[data-testid="toc-title"]')].map(
        (n) => n.textContent,
      ),
    ).toEqual(["Main", "One"]);
  });

  it("saving creates the division under the chosen id, with no rename", () => {
    const { added, updates, sourceOf } = renderEditors();
    addUnder("Main");

    // The id follows the title from the first keystroke — there is no
    // generated id to replace.
    fireEvent.change(titleField(), { target: { value: "My New Bit" } });
    expect(idField().value).toBe("sec-my-new-bit");

    fireEvent.click(within(draftRow()).getByText("Save"));

    expect(added).toHaveLength(1);
    expect(added[0].xmlId).toBe("sec-my-new-bit");
    expect(added[0].title).toBe("My New Bit");
    expect(added[0].source).toContain('<section xml:id="sec-my-new-bit">');
    // Placed once, already naming the right id.
    expect(sourceOf("doc")).toContain('<plus:section ref="sec-my-new-bit"/>');
    // The host is never told to rename anything: the old flow created the
    // division under a generated id and renamed it here.
    expect(updates).toEqual([]);
  });

  it("keeps the draft open and creates nothing when the id collides", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    try {
      const { added, changes } = renderEditors();
      addUnder("Main");
      fireEvent.change(idField(), { target: { value: "one" } });
      fireEvent.click(within(draftRow()).getByText("Save"));

      expect(alert).toHaveBeenCalledOnce();
      expect(draftRow()).toBeInTheDocument();
      expect(added).toEqual([]);
      expect(changes).toEqual([]);
    } finally {
      alert.mockRestore();
    }
  });

  it("places the draft under a nested parent, not the root", () => {
    const { added, sourceOf } = renderEditors();
    addUnder("One");
    fireEvent.change(titleField(), { target: { value: "Deeper" } });
    fireEvent.click(within(draftRow()).getByText("Save"));

    expect(added[0].type).toBe("subsection");
    expect(sourceOf("one")).toContain(
      '<plus:subsection ref="subsec-deeper"/>',
    );
    expect(sourceOf("doc")).toBeUndefined();
  });
});
