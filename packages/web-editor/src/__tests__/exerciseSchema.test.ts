// @vitest-environment jsdom
/**
 * Every exercise type the designer writes is valid PreTeXt: each sample, read
 * into the designer and written back out, assembles into a document the
 * development grammar (the one the linter uses, which alone has Runestone's
 * interactive exercises) accepts. Grammar loading mirrors `snippets.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  PRETEXT_GRAMMAR_FILE,
  setPretextSchemaUrl,
  validatePretextDocument,
} from "../components/editorConfigs/pretextSchema";
import { assembleFullProjectSource } from "../sectionUtils";
import { EXERCISE_KINDS } from "../exerciseDesigner/model";
import { designFromSource } from "../exerciseDesigner/parse";
import { EXERCISE_SAMPLES } from "../exerciseDesigner/samples";
import { sourceFromDesign } from "../exerciseDesigner/serialize";
import type { Exercise } from "../types/editor";

const require = createRequire(import.meta.url);
const GRAMMAR_URL = `https://test.invalid/${PRETEXT_GRAMMAR_FILE}`;
let realFetch: typeof globalThis.fetch;

beforeAll(() => {
  const grammar = fs.readFileSync(
    path.join(path.dirname(require.resolve("@pretextbook/schema")), "assets", PRETEXT_GRAMMAR_FILE),
    "utf8",
  );
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: any) => {
    if (String(input) !== GRAMMAR_URL) throw new Error(`unexpected fetch: ${input}`);
    return new Response(grammar, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  setPretextSchemaUrl(GRAMMAR_URL);
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

/** `exercise` placed in a section of an article, assembled as a build would. */
const documentWith = (exercise: Exercise, placement = `<plus:exercise ref="${exercise.ref}"/>`) =>
  assembleFullProjectSource(
    [
      { xmlId: "art", type: "article", title: "Doc", sourceFormat: "pretext", source: '<plus:section ref="sec"/>' },
      {
        xmlId: "sec",
        type: "section",
        title: "One",
        sourceFormat: "pretext",
        source: `<p>Try it.</p>\n${placement}`,
      },
    ],
    "art",
    "",
    [],
    undefined,
    [],
    [exercise],
  );

describe("exercise designer output", () => {
  it.each(EXERCISE_KINDS)("the %s sample, round-tripped, is valid PreTeXt", async (kind) => {
    const sample = EXERCISE_SAMPLES[kind];
    const { design } = designFromSource(sample.source, sample.attrs);
    const ref = `ex-${kind}`;
    const stored = sourceFromDesign(design, ref);
    expect(await validatePretextDocument(documentWith({ ref, title: "Sample", ...stored }))).toEqual([]);
  });

  // The same record, placed as the other elements an author can choose.
  it.each(EXERCISE_KINDS)("the %s sample is valid PreTeXt placed as a project or a task", async (kind) => {
    const sample = EXERCISE_SAMPLES[kind];
    const { design } = designFromSource(sample.source, sample.attrs);
    const ref = `ex-${kind}`;
    const exercise = { ref, title: "Sample", ...sourceFromDesign(design, ref) };
    expect(await validatePretextDocument(documentWith(exercise, `<plus:project ref="${ref}"/>`))).toEqual([]);
    expect(
      await validatePretextDocument(documentWith(exercise, `<project><plus:task ref="${ref}"/></project>`)),
    ).toEqual([]);
  });

  it("a tag that can't stand where it is written still assembles to valid PreTeXt", async () => {
    const exercise = { ref: "ex", source: "<statement><p>Q</p></statement>" };
    for (const placement of [
      '<plus:task ref="ex"/>',
      '<project><plus:exercise ref="ex"/></project>',
      '<exercise><plus:project ref="ex"/></exercise>',
      '<activity><plus:task ref="ex"/></activity>',
    ]) {
      expect(await validatePretextDocument(documentWith(exercise, placement)), placement).toEqual([]);
    }
  });

  // Not a goal, only a record of a limit: the Markdown converter wraps what is in
  // a `:::project` in a `<statement>`, which a `<task>` can't be in. The fix
  // belongs in `@pretextbook/remark-pretext`.
  it("a task in a <statement> is invalid, which is where Markdown nesting puts it", async () => {
    const exercise = { ref: "ex", source: "<statement><p>Q</p></statement>" };
    const placement = '<project><statement><plus:task ref="ex"/></statement></project>';
    expect(await validatePretextDocument(documentWith(exercise, placement))).not.toEqual([]);
  });
});
