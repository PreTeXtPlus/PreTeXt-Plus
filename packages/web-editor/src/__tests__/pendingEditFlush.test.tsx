/**
 * The code editor reports typing on a 500 ms debounce, so for that window the
 * Monaco buffer is ahead of the division pool. A structural action taken from
 * the TOC in that window rewrites a division's source *from the pool* — and
 * unless the pending keystroke is settled first, two things go wrong at once:
 * the rewrite is computed from text the author has already replaced, and the
 * late delivery then lands on top and reinstates the pre-action source.
 *
 * Creating a division is where that showed up: the `<plus:* ref/>` placeholder
 * written into the parent was taken straight back out, leaving the new division
 * orphaned and the parent naming an xml:id no division has — which the host
 * then refuses to save.
 *
 * The parent is exactly the division that stays open in the editor while the
 * new division's form is filled in, so "type in it, then save the form" is an
 * ordinary sequence rather than a fluke. `settledDivisions` in Editors flushes
 * the buffer before either source is rewritten; these pin that down from both
 * sides of the draft.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import Editors from "../components/Editors";
import type { Division } from "../types/sections";
import type { EditorContentChange } from "../types/editor";

// Monaco loads itself from a CDN, so stand in a textarea — but one that keeps
// the two parts of the real editor this test is about: the 500 ms debounce
// whose timer closes over the render that produced it (so a late delivery
// carries that render's division and text), and `flushPendingChange`.
vi.mock("../components/CodeEditor", () => {
  const Mock = forwardRef(
    (
      props: {
        content: string;
        onChange: (value: string | undefined) => void;
      },
      ref,
    ) => {
      const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
      const pending = useRef<(() => void) | null>(null);
      useImperativeHandle(ref, () => ({
        focus: () => {},
        flushPendingChange: () => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          const deliver = pending.current;
          pending.current = null;
          deliver?.();
        },
      }));
      const onChange = props.onChange;
      return (
        <textarea
          data-testid="code-editor"
          value={props.content}
          onChange={(e) => {
            const value = e.target.value;
            if (timer.current) clearTimeout(timer.current);
            const deliver = () => {
              timer.current = null;
              pending.current = null;
              onChange(value);
            };
            pending.current = deliver;
            timer.current = setTimeout(deliver, 500);
          }}
        />
      );
    },
  );
  return { __esModule: true, default: Mock };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  globalThis.ResizeObserver ?? (ResizeObserverStub as never);

/** An article holding one section, so the root is a parent with a ref in it. */
function project(): Division[] {
  return [
    {
      id: "1",
      xmlId: "doc",
      title: "Main",
      type: "article",
      sourceFormat: "pretext",
      source:
        '<article xml:id="doc">\n<title>Main</title>\n<p>Intro.</p>\n<plus:section ref="one"/>\n</article>',
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
}

function renderEditors(divisions: Division[]) {
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

/** The TOC row whose title is `label`. */
function tocRow(label: string): HTMLElement {
  const row = [...document.querySelectorAll('[data-testid^="toc-item-"]')].find(
    (li) =>
      li.querySelector('[data-testid="toc-title"]')?.textContent === label,
  ) as HTMLElement | undefined;
  if (!row) throw new Error(`no TOC row for "${label}"`);
  return row;
}

/** "Add new division" from `label`'s row menu. */
function addUnder(label: string) {
  const row = tocRow(label);
  fireEvent.click(within(row).getByTitle("More options"));
  fireEvent.click(screen.getByText("Add new division"));
}

/** Title the open draft and save it; returns the xml:id it created. */
function saveForm(title: string): string {
  const row = screen.getByTestId("toc-new-division");
  const input = within(row).getByText("Title").parentElement!
    .querySelector("input") as HTMLInputElement;
  fireEvent.change(input, { target: { value: title } });
  const xmlId = (
    within(row).getByPlaceholderText("unique identifier") as HTMLInputElement
  ).value;
  fireEvent.click(within(row).getByText("Save"));
  return xmlId;
}

/** Replace `find` with `replace` in the open buffer, leaving the debounce armed. */
function typeIntoEditor(find: string, replace: string) {
  const editor = screen.getByTestId("code-editor") as HTMLTextAreaElement;
  fireEvent.change(editor, {
    target: { value: editor.value.replace(find, replace) },
  });
}

describe("a new division survives a pending edit in its parent's buffer", () => {
  it("settles a keystroke typed into the parent just before the add", () => {
    vi.useFakeTimers();
    try {
      const { sourceOf } = renderEditors(project());
      // The root is the division open on load — and stays open, since adding a
      // division no longer creates or switches to anything. Edit it, then add a
      // child and save it before the debounce has reported that edit.
      typeIntoEditor("<p>Intro.</p>", "<p>Intro edited.</p>");
      addUnder("Main");
      const xmlId = saveForm("My New Bit");
      act(() => vi.advanceTimersByTime(600));

      // The typing and the placeholder both survive: the create may not be
      // computed from a source that omits the typing, and the late delivery may
      // not land on a source that omits the placeholder.
      expect(sourceOf("doc")).toContain("<p>Intro edited.</p>");
      expect(sourceOf("doc")).toContain(`<plus:section ref="${xmlId}"/>`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles a keystroke typed into the parent while the draft form is open", () => {
    vi.useFakeTimers();
    try {
      const { sourceOf } = renderEditors(project());
      addUnder("Main");
      // Glance back at the parent while the form is up, tweak a line, then
      // return to the form and save within the debounce window.
      fireEvent.click(
        within(tocRow("Main")).getByTestId("toc-title").closest("button")!,
      );
      typeIntoEditor("<p>Intro.</p>", "<p>Intro!</p>");
      const xmlId = saveForm("My New Bit");
      act(() => vi.advanceTimersByTime(600));

      expect(sourceOf("doc")).toContain("<p>Intro!</p>");
      expect(sourceOf("doc")).toContain(`<plus:section ref="${xmlId}"/>`);
      expect(sourceOf("doc")!.match(/<plus:\w+ ref="[^"]+"\/>/g)).toEqual([
        '<plus:section ref="one"/>',
        `<plus:section ref="${xmlId}"/>`,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
