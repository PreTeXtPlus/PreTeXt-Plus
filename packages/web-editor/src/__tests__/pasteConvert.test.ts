/**
 * @vitest-environment jsdom
 *
 * The Monaco half of paste-and-convert.
 *
 * The placement rules themselves (`isInlineContext`, `placeConvertedMarkup`)
 * are `@pretextbook/import`'s and are tested there; what is checked here is
 * what this package adds — reading a placement context out of a Monaco model
 * with its 1-based coordinates, and the decline-or-convert decision — plus a
 * few end-to-end cases that pin the behaviour an author actually sees.
 */
import { describe, it, expect } from "vitest";
import {
  convertPastedSnippet,
  installPasteConvertListener,
  placementContextAt,
  type PasteContextModel,
} from "../pasteConvert";

/** A stand-in for Monaco's text model, backed by a plain string. */
function modelFor(text: string): PasteContextModel {
  const lines = text.split("\n");
  return {
    getLineContent: (lineNumber) => lines[lineNumber - 1] ?? "",
    getValueInRange: ({
      startLineNumber,
      startColumn,
      endLineNumber,
      endColumn,
    }) => {
      if (startLineNumber === endLineNumber) {
        return (lines[startLineNumber - 1] ?? "").slice(
          startColumn - 1,
          endColumn - 1,
        );
      }
      const first = (lines[startLineNumber - 1] ?? "").slice(startColumn - 1);
      const middle = lines.slice(startLineNumber, endLineNumber - 1);
      const last = (lines[endLineNumber - 1] ?? "").slice(0, endColumn - 1);
      return [first, ...middle, last].join("\n");
    },
  };
}

// A division as the editor holds one: locked header, a paragraph, and a blank
// line before the closing tag where new block content would go.
const DIVISION = [
  '<section xml:id="sec-x">', // 1
  "  <title>A section</title>", // 2
  "  <p>", // 3
  "    Some existing prose.", // 4
  "  </p>", // 5
  "  ", // 6
  "</section>", // 7
].join("\n");

/** Line 4, just past the indent — inside the paragraph. */
const INSIDE_PARAGRAPH = { lineNumber: 4, column: 5 };
/** Line 6, just past the indent — between the paragraph and the closing tag. */
const BETWEEN_BLOCKS = { lineNumber: 6, column: 3 };

describe("placementContextAt", () => {
  it("sees an unclosed paragraph as inline context", () => {
    expect(placementContextAt(modelFor(DIVISION), INSIDE_PARAGRAPH).inline).toBe(
      true,
    );
  });

  it("sees a closed paragraph as block context", () => {
    expect(placementContextAt(modelFor(DIVISION), BETWEEN_BLOCKS).inline).toBe(
      false,
    );
  });

  it("reads the indent of the line the cursor is on", () => {
    expect(
      placementContextAt(modelFor(DIVISION), INSIDE_PARAGRAPH).baseIndent,
    ).toBe("    ");
    expect(
      placementContextAt(modelFor(DIVISION), BETWEEN_BLOCKS).baseIndent,
    ).toBe("  ");
  });

  // Monaco counts columns from 1, so this is the boundary that would be off by
  // one if the VS Code host's `character > 0` were copied across unchanged.
  it("treats column 1 as the start of the line and anything past it as mid-line", () => {
    const model = modelFor(DIVISION);
    expect(placementContextAt(model, { lineNumber: 4, column: 1 }).midLine).toBe(
      false,
    );
    expect(placementContextAt(model, { lineNumber: 4, column: 2 }).midLine).toBe(
      true,
    );
  });
});

describe("convertPastedSnippet", () => {
  const model = modelFor(DIVISION);

  it("declines ordinary prose, so a normal paste is untouched", () => {
    expect(
      convertPastedSnippet(
        "Just some ordinary prose with no markup at all.",
        model,
        BETWEEN_BLOCKS,
      ),
    ).toBeUndefined();
  });

  // The shared detector guards against currency being read as inline math;
  // this pins that guard from the consumer's side.
  it("declines text whose only LaTeX-ish marks are dollar signs on prices", () => {
    expect(
      convertPastedSnippet(
        "The book costs $5 and the pen costs $7.",
        model,
        BETWEEN_BLOCKS,
      ),
    ).toBeUndefined();
  });

  it("converts inline LaTeX pasted inside a paragraph, without adding a block", () => {
    const result = convertPastedSnippet(
      "Let $G$ be a \\emph{group} of order $n$.",
      model,
      INSIDE_PARAGRAPH,
    );
    expect(result?.markup).toBe(
      "Let <m>G</m> be a <em>group</em> of order <m>n</m>.",
    );
    expect(result?.warning).toBeUndefined();
  });

  it("converts a LaTeX environment at block level", () => {
    const result = convertPastedSnippet(
      "\\begin{theorem}\nEvery group of prime order is cyclic.\n\\end{theorem}",
      model,
      BETWEEN_BLOCKS,
    );
    expect(result?.markup).toContain("<theorem>");
    expect(result?.markup).toContain(
      "Every group of prime order is cyclic.",
    );
    expect(result?.warning).toBeUndefined();
  });

  it("converts Markdown", () => {
    const result = convertPastedSnippet(
      "- first item\n- second item\n",
      model,
      BETWEEN_BLOCKS,
    );
    expect(result?.markup).toContain("<ul>");
    expect(result?.markup).toContain("first item");
  });

  it("indents every line after the first to the insertion point", () => {
    const result = convertPastedSnippet(
      "\\begin{theorem}\nEvery group of prime order is cyclic.\n\\end{theorem}",
      model,
      BETWEEN_BLOCKS,
    );
    const lines = result!.markup.split("\n");
    // The cursor already sits past the indent, so the first line is left where
    // the editor puts it and only the rest are shifted out to match.
    expect(lines[0]).toBe("<theorem>");
    expect(lines.slice(1).every((line) => line.startsWith("  "))).toBe(true);
  });

  it("inserts a division dropped inside a paragraph, but says it did", () => {
    const result = convertPastedSnippet(
      "\\subsection{Homework 3}\nSolve every problem.",
      model,
      INSIDE_PARAGRAPH,
    );
    expect(result?.markup).toContain("<subsection>");
    expect(result?.warning).toMatch(/subsection/);
  });
});

/**
 * The listener's placement is the part most easily broken by a tidy-up, so it
 * is pinned here: it must sit on `document` (Monaco 0.56 keeps the element that
 * receives the paste *outside* `editor.getDomNode()`), in the capture phase
 * (the conversion has to beat the text to the model), and it must act only for
 * the focused editor.
 */
describe("installPasteConvertListener", () => {
  interface FakeEditor {
    hasTextFocus: () => boolean;
    getModel: () => (PasteContextModel & { pushStackElement: () => void }) | null;
    getSelection: () => { startLineNumber: number; startColumn: number } | null;
    executeEdits: (source: string, edits: { text: string }[]) => void;
    edits: { text: string }[];
    undoGroupsClosed: number;
  }

  function fakeEditor(overrides: Partial<FakeEditor> = {}): FakeEditor {
    const base = modelFor(DIVISION);
    const editor: FakeEditor = {
      hasTextFocus: () => true,
      getModel: () => ({ ...base, pushStackElement: () => void editor.undoGroupsClosed++ }),
      // A Monaco selection, not a position: the two spell their coordinates
      // differently, and reading the wrong pair silently loses the placement.
      getSelection: () => ({
        startLineNumber: BETWEEN_BLOCKS.lineNumber,
        startColumn: BETWEEN_BLOCKS.column,
      }),
      executeEdits: (_source, edits) => editor.edits.push(...edits),
      edits: [],
      undoGroupsClosed: 0,
      ...overrides,
    };
    return editor;
  }

  /** A paste event carrying `text`, as the browser would deliver it. */
  function pasteEvent(text: string): Event {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type: string) => (type === "text/plain" ? text : "") },
    });
    return event;
  }

  const LATEX = "\\begin{theorem}\nEvery group of prime order is cyclic.\n\\end{theorem}";

  /** Dispatch from a detached node, so only a document-level listener hears it. */
  function dispatchFromDetachedTarget(event: Event) {
    const node = document.createElement("div");
    document.body.appendChild(node);
    try {
      node.dispatchEvent(event);
    } finally {
      node.remove();
    }
  }

  it("converts a paste that never touches the editor's own element", () => {
    const editor = fakeEditor();
    const dispose = installPasteConvertListener({
      getEditor: () => editor,
      isEnabled: () => true,
    });
    try {
      const event = pasteEvent(LATEX);
      dispatchFromDetachedTarget(event);

      expect(editor.edits).toHaveLength(1);
      expect(editor.edits[0].text).toContain("<theorem>");
      // Shifted out by the cursor line's own two-space indent, on top of the
      // converter's. Only happens if the selection's coordinates were read
      // correctly on the way in — with them lost, there is no indent at all.
      expect(editor.edits[0].text).toContain("\n    <statement>");
      // Cancelled, so Monaco never inserts the raw LaTeX behind us.
      expect(event.defaultPrevented).toBe(true);
      expect(editor.undoGroupsClosed).toBe(1);
    } finally {
      dispose();
    }
  });

  it("leaves the paste alone for an editor that does not have focus", () => {
    const editor = fakeEditor({ hasTextFocus: () => false });
    const dispose = installPasteConvertListener({
      getEditor: () => editor,
      isEnabled: () => true,
    });
    try {
      const event = pasteEvent(LATEX);
      dispatchFromDetachedTarget(event);
      expect(editor.edits).toHaveLength(0);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      dispose();
    }
  });

  it("leaves the paste alone when disabled", () => {
    const editor = fakeEditor();
    const dispose = installPasteConvertListener({
      getEditor: () => editor,
      isEnabled: () => false,
    });
    try {
      dispatchFromDetachedTarget(pasteEvent(LATEX));
      expect(editor.edits).toHaveLength(0);
    } finally {
      dispose();
    }
  });

  it("re-reads enablement per paste, so the menu toggle takes effect at once", () => {
    const editor = fakeEditor();
    let enabled = false;
    const dispose = installPasteConvertListener({
      getEditor: () => editor,
      isEnabled: () => enabled,
    });
    try {
      dispatchFromDetachedTarget(pasteEvent(LATEX));
      expect(editor.edits).toHaveLength(0);

      enabled = true;
      dispatchFromDetachedTarget(pasteEvent(LATEX));
      expect(editor.edits).toHaveLength(1);
    } finally {
      dispose();
    }
  });

  it("leaves an unconvertible paste to the editor", () => {
    const editor = fakeEditor();
    const dispose = installPasteConvertListener({
      getEditor: () => editor,
      isEnabled: () => true,
    });
    try {
      const event = pasteEvent("Just some ordinary prose with no markup at all.");
      dispatchFromDetachedTarget(event);
      expect(editor.edits).toHaveLength(0);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      dispose();
    }
  });

  /** The chord an author presses to paste verbatim, as the browser sends it. */
  function plainPasteChord(
    overrides: Partial<KeyboardEventInit> = {},
  ): KeyboardEvent {
    return new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "V",
      code: "KeyV",
      ctrlKey: true,
      shiftKey: true,
      ...overrides,
    });
  }

  it("leaves a paste alone when Ctrl+Shift+V armed it", () => {
    const editor = fakeEditor();
    const dispose = installPasteConvertListener({
      getEditor: () => editor,
      isEnabled: () => true,
    });
    try {
      dispatchFromDetachedTarget(plainPasteChord());
      const event = pasteEvent(LATEX);
      dispatchFromDetachedTarget(event);

      expect(editor.edits).toHaveLength(0);
      // Not cancelled either: the browser's own plain-text paste is what puts
      // the LaTeX in the buffer.
      expect(event.defaultPrevented).toBe(false);
    } finally {
      dispose();
    }
  });

  it("accepts the Mac spelling of the chord", () => {
    const editor = fakeEditor();
    const dispose = installPasteConvertListener({
      getEditor: () => editor,
      isEnabled: () => true,
    });
    try {
      dispatchFromDetachedTarget(
        plainPasteChord({ ctrlKey: false, metaKey: true }),
      );
      dispatchFromDetachedTarget(pasteEvent(LATEX));
      expect(editor.edits).toHaveLength(0);
    } finally {
      dispose();
    }
  });

  // One chord, one paste: the arm must not linger and quietly swallow the
  // conversion on the author's next ordinary Ctrl+V.
  it("arms only the paste that follows it", () => {
    const editor = fakeEditor();
    const dispose = installPasteConvertListener({
      getEditor: () => editor,
      isEnabled: () => true,
    });
    try {
      dispatchFromDetachedTarget(plainPasteChord());
      dispatchFromDetachedTarget(pasteEvent(LATEX));
      expect(editor.edits).toHaveLength(0);

      dispatchFromDetachedTarget(pasteEvent(LATEX));
      expect(editor.edits).toHaveLength(1);
    } finally {
      dispose();
    }
  });

  it("does not treat a plain Ctrl+V as a request to skip conversion", () => {
    const editor = fakeEditor();
    const dispose = installPasteConvertListener({
      getEditor: () => editor,
      isEnabled: () => true,
    });
    try {
      dispatchFromDetachedTarget(plainPasteChord({ shiftKey: false }));
      dispatchFromDetachedTarget(pasteEvent(LATEX));
      expect(editor.edits).toHaveLength(1);
    } finally {
      dispose();
    }
  });

  it("stops listening for the chord once disposed", () => {
    const editor = fakeEditor();
    const dispose = installPasteConvertListener({
      getEditor: () => editor,
      isEnabled: () => true,
    });
    dispose();
    dispatchFromDetachedTarget(plainPasteChord());
    // Re-installed: a chord heard by a disposed listener must not reach this one.
    const dispose2 = installPasteConvertListener({
      getEditor: () => editor,
      isEnabled: () => true,
    });
    try {
      dispatchFromDetachedTarget(pasteEvent(LATEX));
      expect(editor.edits).toHaveLength(1);
    } finally {
      dispose2();
    }
  });

  it("stops converting once disposed", () => {
    const editor = fakeEditor();
    installPasteConvertListener({
      getEditor: () => editor,
      isEnabled: () => true,
    })();
    dispatchFromDetachedTarget(pasteEvent(LATEX));
    expect(editor.edits).toHaveLength(0);
  });
});
