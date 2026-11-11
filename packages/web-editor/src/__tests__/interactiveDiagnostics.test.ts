import { describe, it, expect } from "vitest";
import {
  calcplot3dVariantFix,
  findInteractiveProblems,
  interactiveMarkers,
} from "../components/editorConfigs/interactiveDiagnostics";

const kinds = (text: string, hasStaticOutput = false) =>
  findInteractiveProblems(text, { hasStaticOutput }).map((p) => p.kind);

function modelFor(text: string) {
  return {
    getValue: () => text,
    getPositionAt: (offset: number) => {
      const before = text.slice(0, offset).split("\n");
      return { lineNumber: before.length, column: before[before.length - 1].length + 1 };
    },
    getOffsetAt: ({ lineNumber, column }: { lineNumber: number; column: number }) =>
      text.split("\n").slice(0, lineNumber - 1).reduce((n, line) => n + line.length + 1, 0) + column - 1,
  };
}

describe("a CalcPlot3D interactive", () => {
  it("is reported without a variant, on its start tag", () => {
    const text = '<p>x</p>\n<interactive calcplot3d="type=z;z=x^2" width="80%"/>';
    const [problem] = findInteractiveProblems(text, { hasStaticOutput: false });
    expect(problem.kind).toBe("calcplot3d-variant");
    expect(problem.severity).toBe("warning");
    expect(text.slice(problem.index, problem.index + problem.length)).toBe(
      '<interactive calcplot3d="type=z;z=x^2" width="80%"/>',
    );
  });

  it("is fine with one, wherever it is written", () => {
    expect(kinds('<interactive variant="minimal" calcplot3d="type=z"/>')).toEqual([]);
    expect(kinds("<interactive calcplot3d='a>b'\n  variant = 'controls'/>")).toEqual([]);
  });

  it("is not confused by other interactives, comments or CDATA", () => {
    expect(kinds('<interactive desmos="abc"/>')).toEqual([]);
    expect(kinds('<!-- <interactive calcplot3d="x"/> -->')).toEqual([]);
    expect(kinds('<![CDATA[<interactive calcplot3d="x"/>]]>')).toEqual([]);
    // A value that merely mentions a variant is not one.
    expect(kinds('<interactive calcplot3d="variant=1"/>')).toEqual(["calcplot3d-variant"]);
  });

  it("is fixed by writing the variant after the calcplot3d attribute", () => {
    const text = 'a\n  <interactive xml:id="i" calcplot3d="type=z;z=x^2" width="80%"/>';
    const model = modelFor(text);
    const [marker] = interactiveMarkers(
      { MarkerSeverity: { Warning: 4, Info: 2 } },
      model,
      findInteractiveProblems(text, { hasStaticOutput: false }),
    );
    expect(marker).toMatchObject({ severity: 4, startLineNumber: 2, startColumn: 3 });
    const fix = calcplot3dVariantFix(model, marker)!;
    const fixed = text.slice(0, fix.index) + fix.text + text.slice(fix.index + fix.length);
    expect(fixed).toBe(
      'a\n  <interactive xml:id="i" calcplot3d="type=z;z=x^2" variant="application" width="80%"/>',
    );
    expect(kinds(fixed)).toEqual([]);
    // Nothing to fix once it is fixed, or on some other marker.
    expect(calcplot3dVariantFix(modelFor(fixed), marker)).toBeUndefined();
  });
});

describe("an interactive with no picture for static outputs", () => {
  const bare = '<interactive desmos="abc" width="80%"/>';

  it("is noted only when the project builds a static output", () => {
    expect(kinds(bare)).toEqual([]);
    const [problem] = findInteractiveProblems(bare, { hasStaticOutput: true });
    expect(problem).toMatchObject({ kind: "no-static", severity: "info", index: 0, length: bare.length });
  });

  it("is satisfied by a preview attribute or a static element", () => {
    expect(kinds('<interactive desmos="abc" preview="graph.png"/>', true)).toEqual([]);
    expect(
      kinds('<interactive platform="jsxgraph">\n<slate/>\n<static><image source="g.png"/></static>\n</interactive>', true),
    ).toEqual([]);
  });

  it("does not borrow a static element from the next interactive", () => {
    const text =
      '<interactive platform="javascript"><slate/></interactive>\n' +
      '<interactive platform="javascript"><static><image source="g.png"/></static></interactive>';
    expect(kinds(text, true)).toEqual(["no-static"]);
    expect(kinds('<interactive desmos="a"/>\n<interactive desmos="b"><static/></interactive>', true)).toEqual([
      "no-static",
    ]);
  });

  it("reports both problems of one element, the warning first", () => {
    expect(kinds('<interactive calcplot3d="type=z"/>', true)).toEqual(["calcplot3d-variant", "no-static"]);
  });
});
