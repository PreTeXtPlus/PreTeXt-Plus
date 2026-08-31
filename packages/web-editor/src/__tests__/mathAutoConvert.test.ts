import { describe, it, expect } from "vitest";
import {
  findLineMathMatch,
  handleMathAutoConvert,
  isMathConvertibleContext,
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

  it("does not treat an unrelated $ as closing an earlier inline mention", () => {
    // The "$" before "10" isn't closing "$5" — it's opening its own mention.
    const line = "Tickets cost $5 or $10.";
    const secondDollar = line.indexOf("$", line.indexOf("$") + 1);
    expect(findLineMathMatch(line, secondDollar + 2)).toBeNull();
  });

  it("does not treat an unrelated $$ as closing an earlier display mention", () => {
    const line = "Tickets cost $$5 or $$10.";
    const secondPair = line.indexOf("$$10");
    expect(findLineMathMatch(line, secondPair + 3)).toBeNull();
  });

  it("still converts when the content merely contains interior whitespace", () => {
    const line = "$x + y$";
    expect(findLineMathMatch(line, line.length + 1)).toEqual({
      startColumn: 1,
      endColumn: line.length + 1,
      replacement: "<m>x + y</m>",
    });
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

describe("handleMathAutoConvert", () => {
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
      // Real Monaco closes off an undo group so a conversion becomes its own
      // atomic undo step, distinct from the typing that produced it — this
      // just counts calls, since the fake model has no real undo stack.
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

  /** Applies the raw "$" keystroke to the model and returns the change describing it. */
  const typeDollar = (model: FakeModel, line: number, column: number) => {
    const range = {
      startLineNumber: line,
      startColumn: column,
      endLineNumber: line,
      endColumn: column,
    };
    model.applyEdit(range, "$");
    return { range, rangeLength: 0, text: "$" };
  };

  it("converts on the closing $ and closes off an undo group on both sides", () => {
    const model = makeModel(
      ['<section xml:id="s">', "The value $x^2", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);

    const change = typeDollar(model, 2, model.getLineContent(2).length + 1);
    expect(handleMathAutoConvert(monaco, editor, change)).toBe(true);
    expect(model.getLineContent(2)).toBe("The value <m>x^2</m>");
    // One call before the edit (so it doesn't merge into the user's typing
    // that produced "$x^2$") and one after (so later typing doesn't merge
    // into it either) — without both, undo would delete the converted text
    // outright instead of reverting it to "$x^2$".
    expect(model.getPushStackElementCalls()).toBe(2);
  });

  it("does nothing on a locked line, and touches no undo boundary", () => {
    const model = makeModel(
      ['<section xml:id="s">$x^2', "body", "</section>"].join("\n"),
    );
    const editor = makeEditor(model);

    const change = typeDollar(model, 1, model.getLineContent(1).length + 1);
    expect(handleMathAutoConvert(monaco, editor, change)).toBe(false);
    expect(model.getLineContent(1)).toBe('<section xml:id="s">$x^2$');
    expect(model.getPushStackElementCalls()).toBe(0);
  });
});
