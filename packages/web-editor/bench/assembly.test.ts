/**
 * Benchmark: the *JavaScript* half of a preview rebuild.
 *
 * Every keystroke in the editor re-runs, on the React render path:
 *   - `assembleProjectSource(divisions, activeDivision.xmlId)` — unmemoized in
 *     `Editors.tsx`, so it runs on literally every render;
 *   - `assembleFullProjectSource(...)` for `previewContextSource` — memoized,
 *     but on `divisions`, which changes on every keystroke.
 *
 * Both walk the whole divisions tree and convert every LaTeX/Markdown division
 * to PreTeXt on the way. This measures what that costs as a project grows.
 */
import { describe, it } from "vitest";
import {
  assembleFullProjectSource,
  assembleProjectSource,
  latexDivisionToTaggedPretext,
  wrapDivisionForPreview,
} from "../src/sectionUtils";
import { convertLatexToPretext } from "../src/contentConversion";
import { DOCINFO, makeProject, timeIt, type ProjectShape } from "./fixtures";

const SHAPES: ProjectShape[] = [
  // (chapters × sections) × units — roughly: small article → large book.
  { chapters: 1, sectionsPerChapter: 3, unitsPerSection: 3, format: "pretext" },
  { chapters: 3, sectionsPerChapter: 4, unitsPerSection: 4, format: "pretext" },
  { chapters: 6, sectionsPerChapter: 5, unitsPerSection: 5, format: "pretext" },
  { chapters: 10, sectionsPerChapter: 6, unitsPerSection: 6, format: "pretext" },
  { chapters: 16, sectionsPerChapter: 8, unitsPerSection: 6, format: "pretext" },
  { chapters: 24, sectionsPerChapter: 10, unitsPerSection: 8, format: "pretext" },
];

const LATEX_SHAPES: ProjectShape[] = SHAPES.map((s) => ({
  ...s,
  format: "latex" as const,
}));

interface Row {
  format: string;
  divisions: number;
  kb: number;
  assembleFull: number;
  assembleActive: number;
  convertActive: number;
  wrap: number;
  perKeystroke: number;
}

function measure(shapes: ProjectShape[]): Row[] {
  return shapes.map((shape) => {
    const project = makeProject(shape);
    const { divisions, rootXmlId, activeXmlId } = project;
    const active = divisions.find((d) => d.xmlId === activeXmlId)!;

    const assembleFull = timeIt(() =>
      assembleFullProjectSource(divisions, rootXmlId, DOCINFO, [], "en-US"),
    );
    const assembleActive = timeIt(() =>
      assembleProjectSource(divisions, activeXmlId, []),
    );
    const convertActive =
      shape.format === "latex"
        ? timeIt(() => latexDivisionToTaggedPretext(active))
        : 0;
    const taggedXml = assembleProjectSource(divisions, activeXmlId, []);
    const wrap = timeIt(() =>
      wrapDivisionForPreview(active.type, taggedXml, DOCINFO, active.title, "en-US"),
    );

    return {
      format: shape.format,
      divisions: divisions.length,
      kb: Math.round(project.totalChars / 1024),
      assembleFull,
      assembleActive,
      convertActive,
      wrap,
      // What one keystroke costs on the render path, before any WASM render.
      perKeystroke: assembleFull + assembleActive + wrap,
    };
  });
}

function report(label: string, rows: Row[]): void {
  const fmt = (n: number) => n.toFixed(1).padStart(9);
  console.log(`\n=== ${label} ===`);
  console.log(
    "divisions   size   assembleFull  assembleActive  convertActive     wrap  →  per-keystroke JS",
  );
  for (const r of rows) {
    console.log(
      `${String(r.divisions).padStart(9)}  ${String(r.kb + "KB").padStart(6)}  ` +
        `${fmt(r.assembleFull)}ms ${fmt(r.assembleActive)}ms ${fmt(
          r.convertActive,
        )}ms ${fmt(r.wrap)}ms  →  ${fmt(r.perKeystroke)}ms`,
    );
  }
}

describe("preview assembly cost vs project size", () => {
  it("PreTeXt-format project", () => {
    report("PreTeXt divisions", measure(SHAPES));
  }, 600_000);

  it("LaTeX-format project", () => {
    report("LaTeX divisions", measure(LATEX_SHAPES));
  }, 600_000);

  /*
   * The floor under the LaTeX numbers above. Conversion is cached per division,
   * so a keystroke only re-converts the division being typed in — this is what
   * that one costs, and it is the part no cache can remove.
   */
  it("LaTeX conversion of a single division, by size", () => {
    console.log("\n=== LaTeX → PreTeXt conversion, one division ===");
    console.log("  units    chars    convert    per KB");
    for (const units of [1, 2, 4, 8, 16, 32]) {
      const project = makeProject({
        chapters: 1,
        sectionsPerChapter: 1,
        unitsPerSection: units,
        format: "latex",
      });
      const section = project.divisions.find((d) => d.type === "section")!;
      const ms = timeIt(() => convertLatexToPretext(section.source), 5, 2);
      console.log(
        `${String(units).padStart(7)} ${String(section.source.length).padStart(8)} ` +
          `${ms.toFixed(1).padStart(8)}ms ${(ms / (section.source.length / 1024))
            .toFixed(1)
            .padStart(8)}ms`,
      );
    }
  }, 600_000);
});
