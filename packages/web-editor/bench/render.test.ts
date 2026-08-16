/**
 * Benchmark: the *WASM* half of a preview rebuild.
 *
 * `LivePreview` renders the active division as a fragment spliced into the
 * whole assembled project (`contextSource`), which is what makes numbering and
 * cross-references match the real build. That context is what scales with
 * project size — the fragment itself does not.
 *
 * Requires WebAssembly JSPI; the bench config passes --experimental-wasm-jspi.
 */
import { describe, it } from "vitest";
import { assembleFullProjectSource, assembleProjectSource } from "../src/sectionUtils";
import { DOCINFO, makeProject, timeItAsync, type ProjectShape } from "./fixtures";

const SHAPES: ProjectShape[] = [
  { chapters: 1, sectionsPerChapter: 3, unitsPerSection: 3, format: "pretext" },
  { chapters: 3, sectionsPerChapter: 4, unitsPerSection: 4, format: "pretext" },
  { chapters: 6, sectionsPerChapter: 5, unitsPerSection: 5, format: "pretext" },
  { chapters: 10, sectionsPerChapter: 6, unitsPerSection: 6, format: "pretext" },
  { chapters: 16, sectionsPerChapter: 8, unitsPerSection: 6, format: "pretext" },
  { chapters: 24, sectionsPerChapter: 10, unitsPerSection: 8, format: "pretext" },
];

describe("preview render cost vs project size", () => {
  it("fragment-in-context vs standalone", async () => {
    const { renderHtml, isJspiAvailable } = await import(
      "@pretextbook/pretext-html"
    );
    console.log("JSPI available:", isJspiAvailable?.() ?? "n/a");

    console.log("\n=== Local WASM render ===");
    console.log(
      " divisions   size    standalone    in-context   ratio",
    );

    for (const shape of SHAPES) {
      const project = makeProject(shape);
      const { divisions, rootXmlId, activeXmlId } = project;
      const contextSource = assembleFullProjectSource(
        divisions,
        rootXmlId,
        DOCINFO,
        [],
        "en-US",
      );
      const fragment = assembleProjectSource(divisions, activeXmlId, []);

      const common = {
        cssTheme: "default-modern",
        sourcePath: "/source/division.ptx",
        projectDir: "/source",
        sourceContent: fragment,
        sourceMap: true as const,
        fragment: true as const,
        docinfo: DOCINFO,
      };

      const standalone = await timeItAsync(
        () => renderHtml({ ...common }),
        3,
        1,
      );
      const inContext = await timeItAsync(
        () =>
          renderHtml({
            ...common,
            contextSourcePath: "/source/main.ptx",
            contextSourceContent: contextSource,
          }),
        3,
        1,
      );

      console.log(
        `${String(divisions.length).padStart(10)} ${String(
          Math.round(project.totalChars / 1024) + "KB",
        ).padStart(6)}  ${standalone.toFixed(1).padStart(9)}ms ${inContext
          .toFixed(1)
          .padStart(11)}ms   ${(inContext / standalone).toFixed(1)}x`,
      );
    }
  }, 900_000);
});
