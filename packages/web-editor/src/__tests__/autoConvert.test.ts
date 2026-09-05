import { describe, it, expect } from "vitest";
import { registerAutoConvert } from "../components/editorConfigs/autoConvert";

describe("registerAutoConvert", () => {
  /** A stand-in for Monaco's text model, backed by mutable lines. */
  const makeModel = (initial: string) => {
    const lines = initial.split("\n");
    let pushStackElementCalls = 0;
    return {
      getLineCount: () => lines.length,
      getLineContent: (n: number) => lines[n - 1] ?? "",
      getLineMaxColumn: (n: number) => (lines[n - 1]?.length ?? 0) + 1,
      getValue: () => lines.join("\n"),
      getOffsetAt: ({
        lineNumber,
        column,
      }: {
        lineNumber: number;
        column: number;
      }) => {
        let offset = 0;
        for (let i = 0; i < lineNumber - 1; i++) offset += lines[i].length + 1;
        return offset + (column - 1);
      },
      applyEdit: (
        range: {
          startLineNumber: number;
          startColumn: number;
          endColumn: number;
        },
        text: string,
      ) => {
        const idx = range.startLineNumber - 1;
        const line = lines[idx];
        lines[idx] =
          line.slice(0, range.startColumn - 1) + text + line.slice(range.endColumn - 1);
      },
      pushStackElement: () => {
        pushStackElementCalls += 1;
      },
      getPushStackElementCalls: () => pushStackElementCalls,
    };
  };

  type FakeModel = ReturnType<typeof makeModel>;

  /**
   * A stand-in for a Monaco editor that actually subscribes/dispatches, the
   * way real Monaco does — unlike the other auto-convert test files, this
   * one needs a real `onDidChangeModelContent` harness, since the whole
   * point of `registerAutoConvert` is what happens when a single dispatch
   * runs through several triggers in sequence.
   */
  const makeEditor = (model: FakeModel) => {
    let contentListener: ((event: unknown) => void) | null = null;
    return {
      getModel: () => model,
      onDidChangeModelContent: (cb: (event: unknown) => void) => {
        contentListener = cb;
        return { dispose: () => (contentListener = null) };
      },
      executeEdits: (_source: string, edits: any[]) => {
        for (const edit of edits) model.applyEdit(edit.range, edit.text);
      },
      typeChar: (line: number, column: number, text: string) => {
        const range = {
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: column,
        };
        model.applyEdit(range, text);
        contentListener?.({ changes: [{ range, rangeLength: 0, text }] });
      },
    };
  };

  class FakeRange {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  }
  const monaco = { Range: FakeRange };

  it("converts < to &lt; without corruption from the ampersand trigger (regression)", () => {
    // This is the exact scenario that was broken: with angle-bracket and
    // ampersand each registering their own independent listener, the
    // ampersand listener processed the ORIGINAL "space typed" event a
    // second time, against the buffer angle-bracket had already rewritten
    // — reading a stale column that happened to land on the "&" of the
    // "&lt;" just inserted, producing "&amp;lt;" instead of "&lt;".
    const model = makeModel(
      ['<section xml:id="s">', "if x <", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerAutoConvert(monaco, editor);

    editor.typeChar(2, model.getLineContent(2).length + 1, " ");
    expect(model.getLineContent(2)).toBe("if x &lt; ");
    expect(model.getLineContent(2)).not.toContain("&amp;lt;");
  });

  it("still converts > to &gt; when registered alongside the other triggers", () => {
    const model = makeModel(
      ['<section xml:id="s">', "if x ", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerAutoConvert(monaco, editor);

    editor.typeChar(2, model.getLineContent(2).length + 1, ">");
    expect(model.getLineContent(2)).toBe("if x &gt;");
  });

  it("still converts & to &amp; when registered alongside the other triggers", () => {
    const model = makeModel(
      ['<section xml:id="s">', "Alice &", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerAutoConvert(monaco, editor);

    editor.typeChar(2, model.getLineContent(2).length + 1, " ");
    expect(model.getLineContent(2)).toBe("Alice &amp; ");
  });

  it("still converts $x$ to <m>x</m> when registered alongside the other triggers", () => {
    const model = makeModel(
      ['<section xml:id="s">', "The value $x", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerAutoConvert(monaco, editor);

    editor.typeChar(2, model.getLineContent(2).length + 1, "$");
    expect(model.getLineContent(2)).toBe("The value <m>x</m>");
  });

  it("applies exactly one edit (two pushStackElement calls) per matching keystroke", () => {
    const model = makeModel(
      ['<section xml:id="s">', "if x <", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerAutoConvert(monaco, editor);

    editor.typeChar(2, model.getLineContent(2).length + 1, " ");
    // Not four, not six — only the angle-bracket trigger's edit should have
    // run; no other trigger should have reacted to the same or a nested
    // event.
    expect(model.getPushStackElementCalls()).toBe(2);
  });

  it("applies no edit for an ordinary keystroke", () => {
    const model = makeModel(
      ['<section xml:id="s">', "if x", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerAutoConvert(monaco, editor);

    editor.typeChar(2, model.getLineContent(2).length + 1, "5");
    expect(model.getLineContent(2)).toBe("if x5");
    expect(model.getPushStackElementCalls()).toBe(0);
  });

  it("dispose() stops all further conversions", () => {
    const model = makeModel(
      ['<section xml:id="s">', "if x <", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    const { dispose } = registerAutoConvert(monaco, editor);
    dispose();

    editor.typeChar(2, model.getLineContent(2).length + 1, " ");
    expect(model.getLineContent(2)).toBe("if x < ");
    expect(model.getPushStackElementCalls()).toBe(0);
  });
});
