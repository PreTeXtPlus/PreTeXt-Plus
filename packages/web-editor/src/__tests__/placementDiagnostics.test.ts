/**
 * The check that a record placed more than once names all but one placement,
 * and the quick fix that names one.
 */
import { describe, it, expect } from "vitest";
import {
  findPlacementProblems,
  placementFix,
  placementUses,
  placementTagFixes,
  type PlacementCheckInput,
} from "../components/editorConfigs/placementDiagnostics";
import type { PlaceholderTarget } from "../sectionUtils";

/** The project's refs: a fixed few of each kind, and `extra` sections. */
const refs = (...extra: string[]) =>
  new Map<string, PlaceholderTarget>([
    ["doc", { kind: "division", divisionType: "article" }],
    ["sec-intro", { kind: "division", divisionType: "section" }],
    ["graph", { kind: "asset" }],
    ["fact", { kind: "snippet" }],
    ["ex", { kind: "exercise" }],
    ...extra.map((ref): [string, PlaceholderTarget] => [ref, { kind: "division", divisionType: "section" }]),
  ]);

const input = (overrides: Partial<PlacementCheckInput> = {}): PlacementCheckInput => ({
  sourceFormat: "pretext",
  recordRef: "sec-intro",
  elsewhere: [],
  knownRefs: refs(),
  outerHolder: "outside",
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
    const knownRefs = refs("graph-sec-intro-2");
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
      input({ knownRefs: refs("graph-two") }),
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

describe("tag checks", () => {
  it("is quiet for a tag that suits its record, or a ref with no record yet", () => {
    for (const text of [
      '<plus:section ref="sec-intro"/>',
      '<plus:division ref="sec-intro"/>',
      '<plus:image ref="graph"/>',
      '<plus:snippet ref="fact"/>',
      '<plus:exercise ref="ex"/>',
      '<plus:project ref="ex"/>',
      '<exercise><plus:task ref="ex"/></exercise>',
      '<plus:section ref="not-made-yet"/>',
    ]) {
      expect(findPlacementProblems(text, input()), text).toEqual([]);
    }
  });

  it("is an error, with fixes, for a record of another kind", () => {
    const [problem] = findPlacementProblems('<plus:section ref="fact"/>', input());
    expect(problem).toMatchObject({ severity: "error", suggestedTags: ["snippet"] });
    expect(problem.message).toContain("nothing is embedded");
    expect(findPlacementProblems('<plus:image ref="ex"/>', input())[0].suggestedTags).toEqual([
      "exercise",
      "task",
      "project",
    ]);
  });

  it("does not also report repeated labels on a placeholder that embeds nothing", () => {
    expect(findPlacementProblems('<plus:image ref="fact"/><plus:image ref="fact"/>', input())).toMatchObject([
      { severity: "error" },
      { severity: "error" },
    ]);
  });

  it("is an error for a tag that is no placeholder, whatever its ref names", () => {
    expect(findPlacementProblems('<plus:foo ref="nothing"/>', input())).toMatchObject([
      { severity: "error", suggestedTags: [] },
    ]);
    expect(findPlacementProblems('<plus:foo ref="sec-intro"/>', input())).toMatchObject([
      { severity: "error", suggestedTags: ["section", "division"] },
    ]);
  });

  it("only warns about a division under another type's tag, offering its type and the alias", () => {
    const [problem] = findPlacementProblems('<plus:chapter ref="sec-intro"/>', input());
    expect(problem).toMatchObject({ severity: "warning", suggestedTags: ["section", "division"] });
    expect(problem.message).toContain("embedded as <section>");
  });

  it("warns about a task outside a holder, and anything else inside one", () => {
    expect(findPlacementProblems('<plus:task ref="ex"/>', input())).toMatchObject([
      { severity: "warning", suggestedTags: ["exercise"] },
    ]);
    for (const text of [
      '<project><plus:exercise ref="ex"/></project>',
      '<exercise><plus:project ref="ex"/></exercise>',
      '<activity><statement><p/></statement><plus:exercise ref="ex"/></activity>',
    ]) {
      expect(findPlacementProblems(text, input()), text).toMatchObject([
        { severity: "warning", suggestedTags: ["task"] },
      ]);
    }
  });

  it("reads a holder in each format's own syntax", () => {
    expect(
      findPlacementProblems("\\begin{project}\n\\plus{exercise}{ex}\n\\end{project}", input({ sourceFormat: "latex" })),
    ).toMatchObject([{ suggestedTags: ["task"] }]);
    expect(
      findPlacementProblems("\\begin{project}\n\\end{project}\n\\plus{exercise}{ex}", input({ sourceFormat: "latex" })),
    ).toEqual([]);
    expect(
      findPlacementProblems(':::project\n::exercise{ref="ex"}\n:::', input({ sourceFormat: "markdown" })),
    ).toMatchObject([{ suggestedTags: ["task"] }]);
    expect(
      findPlacementProblems(':::project\n:::\n::exercise{ref="ex"}', input({ sourceFormat: "markdown" })),
    ).toEqual([]);
  });

  it("does not take a holder from a comment, a verbatim span or a closed element", () => {
    for (const text of [
      '<!-- <project> --><plus:exercise ref="ex"/>',
      '<pre><project></pre><plus:exercise ref="ex"/>',
      '<project/><plus:exercise ref="ex"/>',
      '<project></project><plus:exercise ref="ex"/>',
    ]) {
      expect(findPlacementProblems(text, input()), text).toEqual([]);
    }
  });

  it("in a snippet, whose place is unknown, warns only about a holder it can see", () => {
    const snippet = input({ outerHolder: "unknown" });
    expect(findPlacementProblems('<plus:task ref="ex"/>', snippet)).toEqual([]);
    expect(findPlacementProblems('<plus:exercise ref="ex"/>', snippet)).toEqual([]);
    expect(findPlacementProblems('<project><plus:exercise ref="ex"/></project>', snippet)).toMatchObject([
      { suggestedTags: ["task"] },
    ]);
  });

  it("counts every exercise tag as a placement of the same record", () => {
    const problems = findPlacementProblems(
      '<plus:exercise ref="ex"/><plus:project ref="ex"/>',
      input(),
    );
    expect(problems).toHaveLength(2);
    expect(problems[0].message).toContain('The exercise "ex" is placed more than once here');
  });

  it("ignores placeholders in verbatim spans, and Markdown directives with no ref", () => {
    expect(findPlacementProblems('<pre><plus:foo ref="x"/></pre>', input())).toEqual([]);
    expect(findPlacementProblems('::note{id="y"}', input({ sourceFormat: "markdown" }))).toEqual([]);
  });

  it("rewrites just the tag, in the buffer's own syntax, keeping everything else", () => {
    const fixes = (text: string, sourceFormat: PlacementCheckInput["sourceFormat"]) =>
      placementTagFixes(modelOf(text), input({ sourceFormat }), { startLineNumber: 1, startColumn: 1 }).map(
        ({ text, title }) => [text, title],
      );
    expect(fixes('<plus:chapter ref="sec-intro" component="a"/>', "pretext")).toEqual([
      ['<plus:section ref="sec-intro" component="a"/>', "Change to <plus:section>"],
      ['<plus:division ref="sec-intro" component="a"/>', "Change to <plus:division>"],
    ]);
    expect(fixes('<plus:chapter ref="sec-intro"></plus:chapter>', "pretext")[0][0]).toBe(
      '<plus:section ref="sec-intro"></plus:section>',
    );
    expect(fixes('::chapter{ref="sec-intro" component="a"}', "markdown")[0]).toEqual([
      '::section{ref="sec-intro" component="a"}',
      "Change to ::section",
    ]);
    expect(fixes("\\plus[component=a]{chapter}{sec-intro}", "latex")[0]).toEqual([
      "\\plus[component=a]{section}{sec-intro}",
      "Change to \\plus{section}",
    ]);
  });

  it("offers each fix only on the marker it answers", () => {
    // A task outside a holder that also repeats a label carries two markers.
    const text = '<plus:task ref="ex"/><plus:task ref="ex"/>';
    const problems = findPlacementProblems(text, input()).filter((p) => p.index === 0);
    expect(problems).toHaveLength(2);
    const at = (message: string) => ({ startLineNumber: 1, startColumn: 1, message });
    const tag = problems.find((p) => p.suggestedTags)!;
    const instance = problems.find((p) => p.suggestedInstance)!;
    expect(placementTagFixes(modelOf(text), input(), at(tag.message))).toHaveLength(1);
    expect(placementFix(modelOf(text), input(), at(tag.message))).toBeUndefined();
    expect(placementTagFixes(modelOf(text), input(), at(instance.message))).toEqual([]);
    expect(placementFix(modelOf(text), input(), at(instance.message))).toBeDefined();
  });
});
