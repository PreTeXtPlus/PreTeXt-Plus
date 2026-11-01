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
const documentWith = (exercise: Exercise) =>
  assembleFullProjectSource(
    [
      { xmlId: "art", type: "article", title: "Doc", sourceFormat: "pretext", source: '<plus:section ref="sec"/>' },
      {
        xmlId: "sec",
        type: "section",
        title: "One",
        sourceFormat: "pretext",
        source: `<p>Try it.</p>\n<plus:exercise ref="${exercise.ref}"/>`,
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
});
