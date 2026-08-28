import { describe, it, expect, vi } from "vitest";
import {
  findLineMathMatch,
  isMathConvertibleContext,
  registerMathAutoConvert,
} from "../components/editorConfigs/mathAutoConvert";

describe("findLineMathMatch", () => {
  it("converts a basic inline span", () => {
    const line = "The value $x^2$ end";
    const column = line.indexOf("$", line.indexOf("$") + 1) + 2;
    expect(findLineMathMatch(line, column)).toEqual({
      startColumn: line.indexOf("$") + 1,
      endColumn: column,
      replacement: "<m>x^2</m>",
    });
  });

  it("converts a basic display span", () => {
    const line = "$$\\int f$$";
    expect(findLineMathMatch(line, line.length + 1)).toEqual({
      startColumn: 1,
      endColumn: line.length + 1,
      replacement: "<md>\\int f</md>",
    });
  });

  it("does not match while only the opening $$ has been typed", () => {
    expect(findLineMathMatch("$$", 3)).toBeNull();
  });

  it("does not fire on the intermediate state before $$ closes", () => {
    // Typing "$$x$$" passes through "$$x$" on the way — the lone trailing $
    // there is really the first half of the closing "$$" and must not be
    // read as an inline closer.
    expect(findLineMathMatch("$$x$", 5)).toBeNull();
  });

  it("prefers display over inline once the closing $$ completes", () => {
    expect(findLineMathMatch("$$x$$", 6)).toEqual({
      startColumn: 1,
      endColumn: 6,
      replacement: "<md>x</md>",
    });
  });

  it("does not match an escaped opener", () => {
    const line = "\\$5\\$";
    expect(findLineMathMatch(line, line.length + 1)).toBeNull();
  });

  it("does not search back across a tag boundary on the same line", () => {
    const line = '<p title="a">a</p> $x$';
    const closer = line.lastIndexOf("$") + 1;
    expect(findLineMathMatch(line, closer + 1)).toEqual({
      startColumn: line.lastIndexOf("$", closer - 2) + 1,
      endColumn: closer + 1,
      replacement: "<m>x</m>",
    });
  });

  it("ignores a $ that sits before an earlier tag boundary on the line", () => {
    const line = "$before</hint>$x$";
    const closer = line.length;
    expect(findLineMathMatch(line, closer + 1)).toEqual({
      startColumn: line.lastIndexOf("$", closer - 2) + 1,
      endColumn: closer + 1,
      replacement: "<m>x</m>",
    });
  });

  it("rejects an empty inline span", () => {
    expect(findLineMathMatch("$$", 2)).toBeNull();
  });
});

describe("isMathConvertibleContext", () => {
  it("is true in ordinary body text", () => {
    const source = "<p>The value $x^2 here</p>";
    expect(isMathConvertibleContext(source, source.indexOf("$") + 1)).toBe(
      true,
    );
  });

  it("is false inside a comment", () => {
    const source = "<!-- $x$ -->";
    expect(isMathConvertibleContext(source, source.indexOf("$") + 1)).toBe(
      false,
    );
  });

  it("is false inside an attribute value", () => {
    const source = '<p title="cost $5">text</p>';
    expect(isMathConvertibleContext(source, source.indexOf("$") + 1)).toBe(
      false,
    );
  });

  it("is false inside a CDATA section", () => {
    const source = "<![CDATA[ $x$ ]]>";
    expect(isMathConvertibleContext(source, source.indexOf("$") + 1)).toBe(
      false,
    );
  });

  it.each(["m", "md", "me", "men", "mdn", "c", "program", "sage", "pre", "latex-image"])(
    "is false inside <%s>",
    (tag) => {
      const source = `<${tag}>content $ here</${tag}>`;
      expect(isMathConvertibleContext(source, source.indexOf("$") + 1)).toBe(
        false,
      );
    },
  );

  it("recovers once a suppressing element closes", () => {
    const source = "<pre>code $ here</pre> more $ text";
    const offset = source.lastIndexOf("$") + 1;
    expect(isMathConvertibleContext(source, offset)).toBe(true);
  });
});

describe("registerMathAutoConvert", () => {
  /** A stand-in for Monaco's text model, backed by mutable lines. */
  const makeModel = (initial: string) => {
    const lines = initial.split("\n");
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
    };
  };

  type FakeModel = ReturnType<typeof makeModel>;

  /** A stand-in for a Monaco editor: records the two listeners this module registers. */
  const makeEditor = (model: FakeModel) => {
    let contentListener: ((event: unknown) => void) | null = null;
    let keyListener: ((event: unknown) => void) | null = null;
    return {
      getModel: () => model,
      onDidChangeModelContent: (cb: (event: unknown) => void) => {
        contentListener = cb;
        return { dispose: () => (contentListener = null) };
      },
      onKeyDown: (cb: (event: unknown) => void) => {
        keyListener = cb;
        return { dispose: () => (keyListener = null) };
      },
      executeEdits: (_source: string, edits: any[]) => {
        for (const edit of edits) model.applyEdit(edit.range, edit.text);
      },
      typeDollar: (line: number, column: number) => {
        const range = {
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: column,
        };
        model.applyEdit(range, "$");
        contentListener?.({ changes: [{ range, rangeLength: 0, text: "$" }] });
      },
      /** Types an arbitrary single character — used to simulate an unrelated edit. */
      type: (line: number, column: number, text: string) => {
        const range = {
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: column,
        };
        model.applyEdit(range, text);
        contentListener?.({ changes: [{ range, rangeLength: 0, text }] });
      },
      pressEscape: () => {
        const event = {
          keyCode: monaco.KeyCode.Escape,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        };
        keyListener?.(event);
        return event;
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
  const monaco = { Range: FakeRange, KeyCode: { Escape: 9 } };

  it("converts on the closing $ and reverts it on Escape", () => {
    const model = makeModel(
      ['<section xml:id="s">', "The value $x^2", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerMathAutoConvert(monaco, editor);

    editor.typeDollar(2, model.getLineContent(2).length + 1);
    expect(model.getLineContent(2)).toBe("The value <m>x^2</m>");

    const event = editor.pressEscape();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(model.getLineContent(2)).toBe("The value $x^2$");
  });

  it("forfeits the Escape-undo once another edit happens", () => {
    const model = makeModel(
      ['<section xml:id="s">', "The value $x^2", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerMathAutoConvert(monaco, editor);

    editor.typeDollar(2, model.getLineContent(2).length + 1);
    expect(model.getLineContent(2)).toBe("The value <m>x^2</m>");

    editor.type(2, model.getLineContent(2).length + 1, "!");
    const afterEdit = model.getLineContent(2);
    expect(afterEdit).toBe("The value <m>x^2</m>!");

    const event = editor.pressEscape();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(model.getLineContent(2)).toBe(afterEdit);
  });

  it("does nothing on a locked line", () => {
    const model = makeModel(
      ['<section xml:id="s">$x^2', "body", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);
    registerMathAutoConvert(monaco, editor);

    editor.typeDollar(1, model.getLineContent(1).length + 1);
    expect(model.getLineContent(1)).toBe('<section xml:id="s">$x^2$');
  });
});
