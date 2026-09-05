import { describe, it, expect } from "vitest";
import {
  findAmpersandEscape,
  handleAmpersandAutoConvert,
} from "../components/editorConfigs/ampersandAutoConvert";

describe("findAmpersandEscape", () => {
  it("finds a & immediately before a typed space", () => {
    // Simulate: line was "Alice &" (length 7) before the space was typed at
    // column 8 (1-based, the insertion point).
    expect(findAmpersandEscape("Alice & ", 8)).toBe(7);
  });

  it("finds a & immediately before a typed tab", () => {
    expect(findAmpersandEscape("Alice &\tBob", 8)).toBe(7);
  });

  it("finds a & immediately before a simulated Enter", () => {
    // Pressing Enter right after "Alice &" reports insertColumn 8 (the
    // position right after the "&"), and — since the newline isn't part of
    // getLineContent's return value — line 1's content afterward is just
    // "Alice &" itself, unchanged.
    expect(findAmpersandEscape("Alice &", 8)).toBe(7);
  });

  it("does not match when the preceding character isn't &", () => {
    expect(findAmpersandEscape("Alice a 5", 8)).toBeNull();
  });

  it("does not match at the start of a line", () => {
    expect(findAmpersandEscape(" ", 1)).toBeNull();
  });
});

describe("handleAmpersandAutoConvert", () => {
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

  /** A stand-in for a Monaco editor. */
  const makeEditor = (model: FakeModel) => ({
    getModel: () => model,
    executeEdits: (_source: string, edits: any[]) => {
      for (const edit of edits) model.applyEdit(edit.range, edit.text);
    },
  });

  class FakeRange {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  }
  const monaco = { Range: FakeRange };

  /** Applies a raw single-character keystroke to the model and returns the change describing it. */
  const typeChar = (
    model: FakeModel,
    line: number,
    column: number,
    text: string,
  ) => {
    const range = {
      startLineNumber: line,
      startColumn: column,
      endLineNumber: line,
      endColumn: column,
    };
    model.applyEdit(range, text);
    return { range, rangeLength: 0, text };
  };

  it("converts a stray & to &amp; and closes off an undo group on both sides", () => {
    const model = makeModel(
      ['<section xml:id="s">', "Alice &", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);

    const change = typeChar(model, 2, model.getLineContent(2).length + 1, " ");
    expect(handleAmpersandAutoConvert(monaco, editor, change)).toBe(true);
    expect(model.getLineContent(2)).toBe("Alice &amp; ");
    expect(model.getPushStackElementCalls()).toBe(2);
  });

  it("does not fire while a real entity reference is still being typed", () => {
    const model = makeModel(
      ['<section xml:id="s">', "Alice &", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);

    // Typing "a" right after "&" (as in typing out "&amp;" by hand) isn't a
    // whitespace character, so nothing should happen.
    const change = typeChar(model, 2, model.getLineContent(2).length + 1, "a");
    expect(handleAmpersandAutoConvert(monaco, editor, change)).toBe(false);
    expect(model.getLineContent(2)).toBe("Alice &a");
    expect(model.getPushStackElementCalls()).toBe(0);
  });

  it("does not convert a & that is inside a comment", () => {
    const model = makeModel(
      [
        '<section xml:id="s">',
        "<!-- Alice &",
        "reason -->",
        "</section>",
      ].join("\n"),
    );
    const editor = makeEditor(model);

    const change = typeChar(model, 2, model.getLineContent(2).length + 1, " ");
    expect(handleAmpersandAutoConvert(monaco, editor, change)).toBe(false);
    expect(model.getLineContent(2)).toBe("<!-- Alice & ");
    expect(model.getPushStackElementCalls()).toBe(0);
  });

  it("does nothing on a locked line", () => {
    const model = makeModel(
      ['<section xml:id="s">Alice &', "body", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);

    const change = typeChar(model, 1, model.getLineContent(1).length + 1, " ");
    expect(handleAmpersandAutoConvert(monaco, editor, change)).toBe(false);
    expect(model.getLineContent(1)).toBe('<section xml:id="s">Alice & ');
    expect(model.getPushStackElementCalls()).toBe(0);
  });
});
