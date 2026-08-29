import { describe, it, expect } from "vitest";
import {
  findGreaterThanEscape,
  findLessThanEscape,
  registerAngleBracketAutoConvert,
} from "../components/editorConfigs/angleBracketAutoConvert";
import { isXmlTextPosition } from "../components/editorConfigs/xmlTags";

describe("findLessThanEscape", () => {
  it("finds a < immediately before a typed space", () => {
    // Simulate: line was "if x <" (length 6) before the space was typed at
    // column 7 (1-based, the insertion point).
    expect(findLessThanEscape("if x < ", 7)).toEqual({
      column: 6,
      danglingGreaterThanColumn: null,
    });
  });

  it("finds a < immediately before a typed tab", () => {
    expect(findLessThanEscape("if x <\t5", 7)).toEqual({
      column: 6,
      danglingGreaterThanColumn: null,
    });
  });

  it("finds a < immediately before a simulated Enter", () => {
    // Pressing Enter right after "if x <" reports insertColumn 7 (the
    // position right after the "<"), and — since the newline isn't part of
    // getLineContent's return value — line 1's content afterward is just
    // "if x <" itself, unchanged.
    expect(findLessThanEscape("if x <", 7)).toEqual({
      column: 6,
      danglingGreaterThanColumn: null,
    });
  });

  it("does not match when the preceding character isn't <", () => {
    expect(findLessThanEscape("if x > 5", 7)).toBeNull();
    expect(findLessThanEscape("if x = 5", 7)).toBeNull();
  });

  it("does not match at the start of a line", () => {
    expect(findLessThanEscape(" ", 1)).toBeNull();
  });

  it("reports a dangling > immediately after the typed whitespace", () => {
    // Simulate Monaco's auto-closed "<>" (from typing "<" alone) with a
    // space typed between the two characters.
    expect(findLessThanEscape("< >", 2)).toEqual({
      column: 1,
      danglingGreaterThanColumn: 3,
    });
  });

  it("does not report a dangling > when something else follows", () => {
    expect(findLessThanEscape("< 5", 2)).toEqual({
      column: 1,
      danglingGreaterThanColumn: null,
    });
  });
});

describe("findGreaterThanEscape", () => {
  it("finds a > immediately preceded by a space", () => {
    // Simulate: line was "if x " (length 5) before the ">" was typed at
    // column 6 (1-based, the insertion point) — also the ">"'s own column.
    expect(findGreaterThanEscape("if x >", 6)).toBe(6);
  });

  it("finds a > immediately preceded by a tab", () => {
    expect(findGreaterThanEscape("if x\t>", 6)).toBe(6);
  });

  it("does not match when the preceding character isn't whitespace", () => {
    expect(findGreaterThanEscape("if x>", 5)).toBeNull();
    expect(findGreaterThanEscape("if x<>", 6)).toBeNull();
    expect(findGreaterThanEscape("if x>>", 6)).toBeNull();
  });

  it("does not match at the start of a line", () => {
    expect(findGreaterThanEscape(">", 1)).toBeNull();
  });
});

describe("isXmlTextPosition with no suppressed elements", () => {
  it.each(["pre", "c", "m", "program", "latex-image"])(
    "is true inside <%s> (unlike the math-convert suppression list)",
    (tag) => {
      const source = `<${tag}>content < here</${tag}>`;
      expect(isXmlTextPosition(source, source.indexOf("<", 1))).toBe(true);
    },
  );

  it("is false inside a real tag/attribute value", () => {
    const source = '<p title="a < b">text</p>';
    expect(isXmlTextPosition(source, source.indexOf("<", 1))).toBe(false);
  });

  it("is false inside a comment", () => {
    const source = "<!-- a < b -->";
    expect(isXmlTextPosition(source, source.indexOf("<", 1))).toBe(false);
  });

  it("is false inside a CDATA section", () => {
    const source = "<![CDATA[ a < b ]]>";
    expect(isXmlTextPosition(source, source.indexOf("<", 1))).toBe(false);
  });

  it("is false at a real tag's own closing >, even preceded by whitespace", () => {
    const source = '<p xml:id="x" >text</p>';
    expect(isXmlTextPosition(source, source.indexOf(">"))).toBe(false);
  });
});

describe("registerAngleBracketAutoConvert", () => {
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

  /** A stand-in for a Monaco editor: records the content listener this module registers. */
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

  it("converts a stray < to &lt; and closes off an undo group on both sides", () => {
    const model = makeModel(
      ['<section xml:id="s">', "if x <", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerAngleBracketAutoConvert(monaco, editor);

    editor.typeChar(2, model.getLineContent(2).length + 1, " ");
    expect(model.getLineContent(2)).toBe("if x &lt; ");
    expect(model.getPushStackElementCalls()).toBe(2);
  });

  it("removes an auto-closed > when converting < followed by a space", () => {
    // "if x <>" simulates Monaco's xml language having already auto-closed
    // a typed "<" into "<>"; typing a space right after "if x <" lands it
    // between the "<" and the auto-closed ">".
    const model = makeModel(
      ['<section xml:id="s">', "if x <>", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerAngleBracketAutoConvert(monaco, editor);

    editor.typeChar(2, "if x <".length + 1, " ");
    expect(model.getLineContent(2)).toBe("if x &lt; ");
    expect(model.getPushStackElementCalls()).toBe(2);
  });

  it("converts a stray > to &gt; and closes off an undo group on both sides", () => {
    const model = makeModel(
      ['<section xml:id="s">', "if x ", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerAngleBracketAutoConvert(monaco, editor);

    editor.typeChar(2, model.getLineContent(2).length + 1, ">");
    expect(model.getLineContent(2)).toBe("if x &gt;");
    expect(model.getPushStackElementCalls()).toBe(2);
  });

  it("does not convert a < that is inside a comment", () => {
    const model = makeModel(
      ['<section xml:id="s">', "<!-- if x <", "reason -->", "</section>"].join(
        "\n",
      ),
    );
    const editor = makeEditor(model);
    registerAngleBracketAutoConvert(monaco, editor);

    editor.typeChar(2, model.getLineContent(2).length + 1, " ");
    expect(model.getLineContent(2)).toBe("<!-- if x < ");
    expect(model.getPushStackElementCalls()).toBe(0);
  });

  it("does not convert a > that is inside a comment", () => {
    const model = makeModel(
      ['<section xml:id="s">', "<!-- if x ", "reason -->", "</section>"].join(
        "\n",
      ),
    );
    const editor = makeEditor(model);
    registerAngleBracketAutoConvert(monaco, editor);

    editor.typeChar(2, model.getLineContent(2).length + 1, ">");
    expect(model.getLineContent(2)).toBe("<!-- if x >");
    expect(model.getPushStackElementCalls()).toBe(0);
  });

  it("never converts a real tag's own > even when preceded by whitespace", () => {
    const model = makeModel(
      ['<section xml:id="s">', '<p xml:id="x" ', "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerAngleBracketAutoConvert(monaco, editor);

    editor.typeChar(2, model.getLineContent(2).length + 1, ">");
    expect(model.getLineContent(2)).toBe('<p xml:id="x" >');
    expect(model.getPushStackElementCalls()).toBe(0);
  });

  it("does nothing on a locked line, for either direction", () => {
    const model = makeModel(
      ['<section xml:id="s">if x < and y ', "body", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerAngleBracketAutoConvert(monaco, editor);

    editor.typeChar(1, model.getLineContent(1).length + 1, " ");
    expect(model.getLineContent(1)).toBe(
      '<section xml:id="s">if x < and y  ',
    );

    editor.typeChar(1, model.getLineContent(1).length + 1, ">");
    expect(model.getLineContent(1)).toBe(
      '<section xml:id="s">if x < and y  >',
    );
    expect(model.getPushStackElementCalls()).toBe(0);
  });

  it("handles a < conversion followed by a > conversion from the same registration", () => {
    const model = makeModel(
      ['<section xml:id="s">', "if x <", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerAngleBracketAutoConvert(monaco, editor);

    editor.typeChar(2, model.getLineContent(2).length + 1, " ");
    expect(model.getLineContent(2)).toBe("if x &lt; ");

    editor.typeChar(2, model.getLineContent(2).length + 1, ">");
    expect(model.getLineContent(2)).toBe("if x &lt; &gt;");
    expect(model.getPushStackElementCalls()).toBe(4);
  });
});
