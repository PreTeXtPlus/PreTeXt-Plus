/**
 * The check that a record placed more than once names all but one placement,
 * and the quick fix that names one.
 */
import { describe, it, expect } from "vitest";
import {
  findPlacementProblems,
  placementFix,
  placementUses,
  type PlacementCheckInput,
} from "../components/editorConfigs/placementDiagnostics";

const input = (overrides: Partial<PlacementCheckInput> = {}): PlacementCheckInput => ({
  sourceFormat: "pretext",
  recordRef: "sec-intro",
  elsewhere: [],
  knownRefs: new Set(["doc", "sec-intro", "graph", "fact"]),
  ...overrides,
});

/** A stand-in for the bits of a Monaco model `placementFix` reads. */
const modelOf = (text: string) => ({
  getValue: () => text,
  getOffsetAt: ({ lineNumber, column }: { lineNumber: number; column: number }) => {
    const lines = text.split("\n");
    return lines.slice(0, lineNumber - 1).reduce((n, line) => n + line.length + 1, 0) + column - 1;
  },
});

describe("findPlacementProblems", () => {
  it("is quiet for a record placed once, or placed again under an instance name", () => {
    expect(findPlacementProblems('<plus:image ref="graph"/>', input())).toEqual([]);
    expect(
      findPlacementProblems('<plus:image ref="graph"/><plus:image ref="graph" instance="again"/>', input()),
    ).toEqual([]);
  });

  it("flags every unnamed placement of a record placed elsewhere too, naming where, and suggests a name", () => {
    const elsewhere = placementUses([
      { name: "Methods", source: "\\plus{image}{graph}", sourceFormat: "latex" },
    ]);
    const [problem] = findPlacementProblems('<p/><plus:image ref="graph"/>', input({ elsewhere }));
    expect(problem).toMatchObject({ index: 4, length: 25, severity: "warning", suggestedInstance: "sec-intro" });
    expect(problem.message).toContain('"graph" is placed here and in Methods without an instance name');
  });

  it("flags both unnamed placements in one buffer", () => {
    const problems = findPlacementProblems('<plus:snippet ref="fact"/><plus:snippet ref="fact"/>', input());
    expect(problems).toHaveLength(2);
    expect(problems[0].message).toContain("more than once here");
  });

  it("does not count an image and a snippet with the same ref as one record", () => {
    expect(findPlacementProblems('<plus:image ref="x"/><plus:snippet ref="x"/>', input())).toEqual([]);
  });

  it("suggests a name that is free and whose labels collide with nothing", () => {
    const elsewhere = placementUses([
      { name: "Other", source: '<plus:image ref="graph" instance="sec-intro"/>', sourceFormat: "pretext" },
    ]);
    const knownRefs = new Set(["graph", "graph-sec-intro-2"]);
    const [problem] = findPlacementProblems(
      '<plus:image ref="graph"/><plus:image ref="graph"/>',
      input({ elsewhere, knownRefs }),
    );
    expect(problem.suggestedInstance).toBe("sec-intro-3");
  });

  it("flags an instance name used twice for the same record", () => {
    const elsewhere = placementUses([
      { name: "Other", source: '<plus:image ref="graph" instance="again"/>', sourceFormat: "pretext" },
    ]);
    const [problem] = findPlacementProblems('<plus:image ref="graph" instance="again"/>', input({ elsewhere }));
    expect(problem.message).toContain('instance name "again" more than once');
  });

  it("flags an instance whose labels would be another record's ref, and a malformed name", () => {
    const [collision] = findPlacementProblems(
      '<plus:image ref="graph" instance="two"/>',
      input({ knownRefs: new Set(["graph", "graph-two"]) }),
    );
    expect(collision.message).toContain('"graph-two", which is already the id of something else');

    const [malformed] = findPlacementProblems('<plus:image ref="graph" instance="a b"/>', input());
    expect(malformed.severity).toBe("error");
  });
});

describe("placementFix", () => {
  it("names the placement under the marker, in the buffer's own syntax", () => {
    const text = "Intro\n\\plus{image}{graph}\n\\plus[width=50%]{image}{graph}";
    const fix = placementFix(modelOf(text), input({ sourceFormat: "latex" }), { startLineNumber: 3, startColumn: 1 });
    expect(fix).toEqual({
      index: 26,
      length: 30,
      text: "\\plus[width=50%,instance=sec-intro]{image}{graph}",
      instance: "sec-intro",
    });
  });

  it("offers nothing where no fixable problem starts", () => {
    expect(placementFix(modelOf('<plus:image ref="graph"/>'), input(), { startLineNumber: 1, startColumn: 1 })).toBeUndefined();
  });
});
