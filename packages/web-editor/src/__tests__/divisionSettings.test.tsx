/**
 * An existing division's settings save field by field, like a snippet's or an
 * asset's: a text field on Enter or blur (Escape reverts it), a select on
 * change. The drawer stays open, and an invalid id is refused inline. Only a
 * new division's draft keeps Save/Cancel — see newDivisionDraft.test.tsx.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import Editors from "../components/Editors";
import type { Division } from "../types/sections";
import type { EditorContentChange } from "../types/editor";
import { openSettings } from "./tocTestUtils";

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

const divisions: Division[] = [
  {
    id: "1",
    xmlId: "doc",
    title: "Main",
    type: "article",
    sourceFormat: "pretext",
    source:
      '<article xml:id="doc">\n<title>Main</title>\n<plus:section ref="intro-sec"/>\n<plus:section ref="other"/>\n</article>',
  },
  {
    id: "2",
    xmlId: "intro-sec",
    title: "Getting started",
    type: "section",
    sourceFormat: "pretext",
    source:
      '<section xml:id="intro-sec">\n<title>Getting started</title>\n<p>Hi.</p>\n</section>',
  },
  {
    id: "3",
    xmlId: "other",
    title: "Other",
    type: "section",
    sourceFormat: "pretext",
    source: '<section xml:id="other">\n<title>Other</title>\n<p>x</p>\n</section>',
  },
];

function renderEditors() {
  const changes: EditorContentChange[] = [];
  render(
    <Editors
      divisions={divisions}
      rootDivisionId="doc"
      projectType="article"
      title="Doc"
      topBar={{}}
      onContentChange={(c) => changes.push(c)}
    />,
  );
  /** The last source emitted for `xmlId`, or undefined if it never changed. */
  const sourceOf = (xmlId: string) => {
    const forDivision = changes.filter((c) => c.xmlId === xmlId);
    return forDivision[forDivision.length - 1]?.source;
  };
  return { sourceOf };
}

const field = (drawer: HTMLElement, label: string) =>
  within(drawer).getByLabelText(label) as HTMLInputElement | HTMLSelectElement;

describe("an existing division's settings", () => {
  it("has no Save or Cancel buttons", () => {
    renderEditors();
    const drawer = openSettings("Getting started");
    expect(within(drawer).queryByText("Save")).toBeNull();
    expect(within(drawer).queryByText("Cancel")).toBeNull();
  });

  it("saves a new title on blur and keeps the drawer open", () => {
    const { sourceOf } = renderEditors();
    const drawer = openSettings("Getting started");
    const title = field(drawer, "Title");
    fireEvent.change(title, { target: { value: "Welcome" } });
    fireEvent.blur(title);
    expect(sourceOf("intro-sec")).toContain("<title>Welcome</title>");
    expect(screen.getByTestId("settings-drawer")).toBeInTheDocument();
  });

  it("reverts a half-typed title on Escape without saving it", () => {
    const { sourceOf } = renderEditors();
    const drawer = openSettings("Getting started");
    const title = field(drawer, "Title");
    fireEvent.change(title, { target: { value: "Oops" } });
    fireEvent.keyDown(title, { key: "Escape" });
    expect(title.value).toBe("Getting started");
    fireEvent.blur(title);
    expect(sourceOf("intro-sec")).toBeUndefined();
    // The first Escape only reverted the field; the drawer is still open…
    expect(screen.getByTestId("settings-drawer")).toBeInTheDocument();
    // …and with nothing left to revert, the next one closes it.
    fireEvent.keyDown(title, { key: "Escape" });
    expect(screen.queryByTestId("settings-drawer")).toBeNull();
  });

  it("refuses an empty title inline", async () => {
    const { sourceOf } = renderEditors();
    const drawer = openSettings("Getting started");
    const title = field(drawer, "Title");
    fireEvent.change(title, { target: { value: "  " } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(
      await within(drawer).findByText(/Enter a title, or press Escape/),
    ).toBeInTheDocument();
    expect(sourceOf("intro-sec")).toBeUndefined();
  });

  it("refuses an id another division already uses, and saves nothing", async () => {
    const { sourceOf } = renderEditors();
    const drawer = openSettings("Getting started");
    const id = field(drawer, "Id");
    fireEvent.change(id, { target: { value: "other" } });
    fireEvent.blur(id);
    expect(
      await within(drawer).findByText(/already used by another division/),
    ).toBeInTheDocument();
    expect(sourceOf("intro-sec")).toBeUndefined();
    expect(sourceOf("doc")).toBeUndefined();
  });

  it("renames the id everywhere on Enter", () => {
    const { sourceOf } = renderEditors();
    const drawer = openSettings("Getting started");
    const id = field(drawer, "Id");
    fireEvent.change(id, { target: { value: "welcome" } });
    fireEvent.keyDown(id, { key: "Enter" });
    expect(sourceOf("intro-sec")).toContain('xml:id="welcome"');
    expect(sourceOf("doc")).toContain('<plus:section ref="welcome"/>');
  });

  it("saves a type change as soon as it is picked", () => {
    const { sourceOf } = renderEditors();
    const drawer = openSettings("Getting started");
    fireEvent.change(field(drawer, "Type"), { target: { value: "worksheet" } });
    expect(sourceOf("intro-sec")).toMatch(/^<worksheet xml:id="intro-sec">/);
    expect(sourceOf("doc")).toContain('<plus:worksheet ref="intro-sec"/>');
  });
});
