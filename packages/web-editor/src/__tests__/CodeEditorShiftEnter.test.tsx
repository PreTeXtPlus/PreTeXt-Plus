/**
 * @vitest-environment jsdom
 *
 * Shift+Enter's paragraph-split keybinding, registered in
 * `CodeEditor.tsx`'s `handleEditorMount`. `paragraphSplit.test.ts` covers the
 * pure decision logic; this covers the wiring — that the right Monaco
 * keybinding is registered, that it rewrites the buffer exactly as
 * `planParagraphSplit` says via a plain `executeEdits` (not a snippet
 * insertion — see `splitParagraphAtCursor`'s doc comment for why), that it
 * falls back to a plain newline outside a `<p>` (Monaco's own default for the
 * combo, which `addCommand` fully overrides), and that Ctrl+Enter's existing
 * rebuild shortcut is unaffected by the new registration living right next to
 * it.
 *
 * The heavier parts of `handleEditorMount` (constrained-editor-plugin, the
 * collab edit guard, per-format Monaco language extensions) are mocked out —
 * none of them bear on this keybinding, and driving them for real would need
 * a much more complete Monaco stub than this test has any use for.
 */
import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import CodeEditor from "../components/CodeEditor";

vi.mock("constrained-editor-plugin", () => ({
  constrainedEditor: () => ({
    initializeIn: () => {},
    addRestrictionsTo: () => {},
  }),
}));

vi.mock("../collab/editGuard", () => ({
  installEditGuard: () => () => {},
}));

vi.mock("../components/editorConfigs", () => ({
  editorConfigs: {
    pretext: { language: "xml" },
    latex: { language: "pretext-latex" },
    markdown: { language: "pretext-markdown" },
  },
}));

const monaco = {
  KeyMod: { CtrlCmd: 1 << 11, Shift: 1 << 10, Alt: 1 << 9, WinCtrl: 1 << 8 },
  KeyCode: { Enter: 3, KeyS: 4, KeyF: 5, KeyA: 6 },
  editor: { setModelMarkers: vi.fn() },
};

/**
 * A single-line Monaco stand-in, cursor placed at `cursorOffset`. `content`
 * is mutable and `executeEdits` actually splices it — using column-as-offset
 * math, which stays valid throughout since the model always reports exactly
 * one line, however many `\n`s the content ends up holding — so tests can
 * assert on the resulting text directly instead of on recorded edit calls.
 */
const makeEditorStub = (initialContent: string, cursorOffset: number) => {
  let content = initialContent;
  const commands = new Map<number, () => void>();
  const triggers: { source: string; handlerId: string; payload?: unknown }[] = [];
  let position = { lineNumber: 1, column: cursorOffset + 1 };

  const model = {
    getValue: () => content,
    getLineCount: () => 1,
    getLineContent: () => content,
    getLineMaxColumn: () => content.length + 1,
    getOffsetAt: (pos: { column: number }) => pos.column - 1,
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    isDisposed: () => false,
  };

  const selection = () => ({
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
    isEmpty: () => true,
  });

  const editor = {
    getModel: () => model,
    getPosition: () => position,
    setPosition: (p: { lineNumber: number; column: number }) => {
      position = p;
    },
    getSelection: selection,
    getSelections: () => [selection()],
    setSelections: () => {},
    addCommand: (keybinding: number, handler: () => void) => {
      commands.set(keybinding, handler);
    },
    getContribution: () => undefined,
    trigger: (source: string, handlerId: string, payload?: unknown) => {
      triggers.push({ source, handlerId, payload });
    },
    executeEdits: (
      _source: string,
      ops: {
        range: { startColumn: number; endColumn: number };
        text: string;
      }[],
    ) => {
      for (const op of ops) {
        content =
          content.slice(0, op.range.startColumn - 1) +
          op.text +
          content.slice(op.range.endColumn - 1);
      }
    },
    focus: () => {},
    onMouseDown: () => ({ dispose: () => {} }),
    onDidChangeCursorPosition: () => ({ dispose: () => {} }),
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    onDidChangeModelContent: () => ({ dispose: () => {} }),
  };

  return {
    editor,
    model,
    commands,
    triggers,
    getValue: () => content,
    getPosition: () => position,
  };
};

type Harness = ReturnType<typeof makeEditorStub>;

// Set by each test right before `render`; read once by the mocked `Editor`'s
// mount effect, since the real cursor position has to be baked into the
// stub before `onMount` fires.
let cursorOffsetForNextMount = 0;
let harness: Harness | null = null;

vi.mock("@monaco-editor/react", () => ({
  Editor: (props: { defaultValue?: string; onMount?: (editor: unknown, monaco: unknown) => void }) => {
    useEffect(() => {
      harness = makeEditorStub(props.defaultValue ?? "", cursorOffsetForNextMount);
      props.onMount?.(harness.editor, monaco);
      // Runs once per mount; a fresh harness per test comes from a fresh render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="monaco-mock" />;
  },
}));

const shiftEnter = () =>
  harness!.commands.get(monaco.KeyMod.Shift | monaco.KeyCode.Enter)!();
const ctrlEnter = () =>
  harness!.commands.get(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter)!();

const baseProps = {
  onChange: vi.fn(),
  onOpenLatexImport: vi.fn(),
  onOpenDocinfoEditor: vi.fn(),
  onShowFullSource: vi.fn(),
};

beforeEach(() => {
  harness = null;
  cursorOffsetForNextMount = 0;
});

describe("Shift+Enter paragraph split", () => {
  it("reconstructs a plain paragraph as two siblings, split at the cursor", () => {
    const content = "<article><p>The car is fast.</p></article>";
    cursorOffsetForNextMount = content.indexOf("fast.") + 2; // "The car is fa|st."
    render(<CodeEditor {...baseProps} content={content} sourceFormat="pretext" />);

    shiftEnter();

    expect(harness!.getValue()).toBe(
      "<article><p>The car is fa\n</p>\n<p>\n    st.</p></article>",
    );
    const cursorColumn = "<article><p>The car is fa\n</p>\n<p>\n    ".length + 1;
    expect(harness!.getPosition()).toEqual({ lineNumber: 1, column: cursorColumn });
    expect(harness!.triggers).toEqual([]);
  });

  it("reuses the original tag's indentation for the new line", () => {
    const content = "<section>\n  <p>The car is fast.</p>\n</section>";
    cursorOffsetForNextMount = content.indexOf("fast.") + 2;
    render(<CodeEditor {...baseProps} content={content} sourceFormat="pretext" />);

    shiftEnter();

    expect(harness!.getValue()).toBe(
      "<section>\n  <p>The car is fa\n  </p>\n  <p>\n      st.</p>\n</section>",
    );
  });

  it("appends a matching-indentation empty sibling when the cursor is nested inside inline markup, leaving the original untouched", () => {
    const content = "<article><p>Some <em>emphasized text</em> here.</p></article>";
    cursorOffsetForNextMount = content.indexOf("emphasized te") + "emphasized te".length;
    render(<CodeEditor {...baseProps} content={content} sourceFormat="pretext" />);

    shiftEnter();

    expect(harness!.getValue()).toBe(
      "<article><p>Some <em>emphasized text</em> here.</p>\n<p>\n    \n</p></article>",
    );
    const cursorColumn =
      "<article><p>Some <em>emphasized text</em> here.</p>\n<p>\n    ".length + 1;
    expect(harness!.getPosition()).toEqual({ lineNumber: 1, column: cursorColumn });
    expect(harness!.triggers).toEqual([]);
  });

  it("falls back to a plain newline when the cursor isn't inside a <p>", () => {
    const content = "<article><title>Hi</title></article>";
    cursorOffsetForNextMount = content.indexOf("Hi") + 2;
    render(<CodeEditor {...baseProps} content={content} sourceFormat="pretext" />);

    shiftEnter();

    expect(harness!.getValue()).toBe(content);
    expect(harness!.triggers).toEqual([
      { source: "keyboard", handlerId: "type", payload: { text: "\n" } },
    ]);
  });

  it("falls back to a plain newline in non-PreTeXt buffers, even where <p> looks textually present", () => {
    const content = "Some <p> text.";
    cursorOffsetForNextMount = content.indexOf("<p>") + 2;
    render(<CodeEditor {...baseProps} content={content} sourceFormat="latex" />);

    shiftEnter();

    expect(harness!.getValue()).toBe(content);
    expect(harness!.triggers).toEqual([
      { source: "keyboard", handlerId: "type", payload: { text: "\n" } },
    ]);
  });

  it("leaves Ctrl+Enter's rebuild shortcut unaffected", () => {
    const content = "<article><p>The car is fast.</p></article>";
    cursorOffsetForNextMount = content.indexOf("fast.") + 2;
    const onRebuild = vi.fn();
    render(
      <CodeEditor
        {...baseProps}
        content={content}
        sourceFormat="pretext"
        onRebuild={onRebuild}
      />,
    );

    ctrlEnter();

    expect(onRebuild).toHaveBeenCalledTimes(1);
    expect(harness!.getValue()).toBe(content);
  });
});
