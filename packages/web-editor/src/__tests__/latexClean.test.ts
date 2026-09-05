import { describe, it, expect } from "vitest";
import {
  describeFix,
  findLatexFixes,
  getLatexCleanDiagnostics,
  pretextLatexLanguage,
} from "@pretextbook/latex-style-pretext";
import { applyCleanFixes } from "../components/editorConfigs/latexClean";
import type { CleanSupport } from "../components/editorConfigs/types";

/**
 * The real engine, wired the way `latexConfig` wires it. Only the Monaco half
 * is faked, so these tests exercise the actual rules and the actual fixpoint
 * behavior.
 */
const clean: CleanSupport = {
  getDiagnostics: (text) => getLatexCleanDiagnostics(text),
  getFixes: (text) => findLatexFixes(text),
  getCodeActions: (text, range, uri) =>
    pretextLatexLanguage.getCleanCodeActions?.(text, range, uri) ?? [],
  describeFix,
};

interface EditOperation {
  range: FakeRange;
  text: string;
}

class FakeRange {
  constructor(
    public startLineNumber: number,
    public startColumn: number,
    public endLineNumber: number,
    public endColumn: number,
  ) {}
}

const fakeMonaco = { Range: FakeRange };

/**
 * An in-memory stand-in for Monaco's text model — enough of it for the apply
 * loop: offsets ↔ positions, line access for the locked-region geometry, and
 * an edit method that really applies the operations.
 */
class FakeModel {
  stackElements = 0;
  /** When true, edits are swallowed — how the collab guard rejects a batch. */
  rejectEdits = false;

  constructor(private text: string) {}

  getValue() {
    return this.text;
  }
  isDisposed() {
    return false;
  }
  pushStackElement() {
    this.stackElements += 1;
  }
  private lines() {
    return this.text.split("\n");
  }
  getLineCount() {
    return this.lines().length;
  }
  getLineContent(lineNumber: number) {
    return this.lines()[lineNumber - 1] ?? "";
  }
  getLineMaxColumn(lineNumber: number) {
    return this.getLineContent(lineNumber).length + 1;
  }
  getPositionAt(offset: number) {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    const before = this.text.slice(0, clamped).split("\n");
    return {
      lineNumber: before.length,
      column: before[before.length - 1].length + 1,
    };
  }
  private offsetAt(lineNumber: number, column: number) {
    const lines = this.lines();
    let offset = 0;
    for (let i = 0; i < lineNumber - 1; i += 1) offset += lines[i].length + 1;
    return offset + column - 1;
  }
  pushEditOperations(_before: unknown, operations: EditOperation[]) {
    if (this.rejectEdits) return null;
    // Back to front, so each operation's offsets stay valid as we splice.
    const ordered = [...operations].sort(
      (a, b) =>
        this.offsetAt(b.range.startLineNumber, b.range.startColumn) -
        this.offsetAt(a.range.startLineNumber, a.range.startColumn),
    );
    for (const op of ordered) {
      const start = this.offsetAt(
        op.range.startLineNumber,
        op.range.startColumn,
      );
      const end = this.offsetAt(op.range.endLineNumber, op.range.endColumn);
      this.text = this.text.slice(0, start) + op.text + this.text.slice(end);
    }
    return null;
  }
}

const editorFor = (model: FakeModel) => ({ getModel: () => model });

const run = (
  model: FakeModel,
  options: { sourceFormat?: "latex" | "pretext"; ruleIds?: string[] } = {},
) =>
  applyCleanFixes(fakeMonaco, editorFor(model), clean, {
    sourceFormat: options.sourceFormat ?? "pretext",
    ruleIds: options.ruleIds,
  });

describe("applyCleanFixes", () => {
  it("removes presentational markup", () => {
    // No locked region: a one-line buffer has nothing to lock.
    const model = new FakeModel("Some text \\hspace{1cm} more text.");

    const result = run(model);

    expect(model.getValue()).toBe("Some text  more text.");
    expect(result.applied).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("applies every occurrence in one pass", () => {
    const model = new FakeModel("a \\hspace{1cm} b \\hspace{2cm} c \\hspace{3cm}");

    const result = run(model);

    expect(model.getValue()).not.toContain("\\hspace");
    expect(result.applied).toBe(3);
    expect(result.passes).toBe(1);
  });

  it("follows a cascading rewrite to its fixpoint", () => {
    // `{\bf x}` rewrites to `\textbf{x}`, which the engine then *flags* rather
    // than rewriting again — only the author knows what the bold meant.
    const model = new FakeModel("This is {\\bf important} text.");

    const result = run(model);

    expect(model.getValue()).toBe("This is \\textbf{important} text.");
    expect(result.applied).toBe(1);
    expect(result.truncated).toBe(false);
    // The flag survives, so the review dialog still has something to show.
    expect(
      clean.getFixes(model.getValue()).some((f) => f.replacement === undefined),
    ).toBe(true);
  });

  it("leaves flag-only findings alone", () => {
    const model = new FakeModel("This is \\textbf{important} text.");

    const result = run(model);

    expect(model.getValue()).toBe("This is \\textbf{important} text.");
    expect(result.applied).toBe(0);
  });

  it("applies only the requested rules", () => {
    const model = new FakeModel("\\hspace{1cm} and \\date{today} here.");

    const result = run(model, { ruleIds: ["hspace"] });

    expect(model.getValue()).toContain("\\date{today}");
    expect(model.getValue()).not.toContain("\\hspace");
    expect(result.applied).toBe(1);
  });

  it("skips a finding on a locked structural line", () => {
    // A LaTeX division's `\section{…}` header is line 1 and is not editable
    // here — it is edited from the Table of Contents.
    const model = new FakeModel(
      "\\section{Limits \\hspace{1cm}}\nBody text \\hspace{2cm} here.",
    );

    const result = run(model, { sourceFormat: "latex" });

    expect(model.getLineContent(1)).toBe("\\section{Limits \\hspace{1cm}}");
    expect(model.getLineContent(2)).toBe("Body text  here.");
    expect(result.applied).toBe(1);
  });

  it("stops instead of spinning when the model refuses the edits", () => {
    // The collab guard drops a whole batch it will not allow; without the
    // no-progress check the same fixes would be found and pushed until the
    // pass cap ran out.
    const model = new FakeModel("Some text \\hspace{1cm} more.");
    model.rejectEdits = true;

    const result = run(model);

    expect(model.getValue()).toBe("Some text \\hspace{1cm} more.");
    expect(result.applied).toBe(0);
    // No pass completed: the loop bails on the first one that changes nothing,
    // rather than retrying up to the cap.
    expect(result.passes).toBe(0);
  });

  it("brackets the whole run in one undo step", () => {
    const model = new FakeModel("a \\hspace{1cm} b {\\bf c}");

    run(model);

    expect(model.stackElements).toBe(2);
  });

  it("does nothing when there is no model", () => {
    const result = applyCleanFixes(
      fakeMonaco,
      { getModel: () => null },
      clean,
      { sourceFormat: "latex" },
    );

    expect(result).toEqual({ applied: 0, passes: 0, truncated: false });
  });
});
