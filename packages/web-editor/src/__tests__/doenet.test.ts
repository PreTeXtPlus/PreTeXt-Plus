/**
 * Doenet activities: an exercise record in DoenetML, placed as an exercise, a
 * project-like block or a bare interactive (docs/doenet-plan.md). The wraps
 * are checked against the real PreTeXt schema, as the designer's are.
 */
/// <reference types="node" />
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  PRETEXT_GRAMMAR_FILE,
  setPretextSchemaUrl,
  validatePretextDocument,
} from "../components/editorConfigs/pretextSchema";
import {
  EXERCISE_PLACEMENT_TAGS,
  EXERCISE_WRAPPER_TAGS,
  assembleExercisePreviewSource,
  assembleFullProjectSource,
  exerciseEmbedCode,
  parseExerciseRefs,
  parsePlacements,
  removeExerciseRef,
  renameExerciseRef,
  wrapExerciseSource,
} from "../sectionUtils";
import {
  DEFAULT_DOENETML_VERSION,
  DOENET_STARTER,
  DOENET_STATIC_FALLBACK,
  docinfoDoenetmlVersion,
  effectiveDoenetmlVersion,
  doenetmlCdata,
} from "../doenet";
import { doenetEditorPage, DOENET_EDITOR_SANDBOX } from "../doenet/editorPage";
import { derivePretextContent } from "../contentConversion";
import * as Y from "yjs";
import { makeExerciseEntry, exerciseEntryToSnapshot, getExercisesMap } from "../collab/schema";
import type { Exercise } from "../types/editor";
import type { Division } from "../types/sections";

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

const doenet: Exercise = {
  ref: "drag",
  title: "Drag <m>P</m>",
  sourceFormat: "doenetml",
  source: '<p>What is <m>2 &amp; 2</m>? <answer name="a">4</answer></p>\n',
  attrs: { width: "100%", aspect: "4:3" },
};

const designer: Exercise = {
  ref: "quiz",
  source: '<statement><p>Pick.</p></statement>\n<choices><choice correct="yes"><statement><p>A</p></statement></choice></choices>',
  attrs: {},
};

const root = (source: string, sourceFormat: Division["sourceFormat"] = "pretext"): Division => ({
  xmlId: "root",
  type: "article",
  title: "Doc",
  source,
  sourceFormat,
});

const assemble = (source: string, docinfo = "") =>
  assembleFullProjectSource([root(source)], "root", docinfo, [], undefined, [], [doenet, designer]);

describe("wrapExerciseSource for a Doenet activity", () => {
  it("makes an exercise dual: the activity in <dynamic>, a static version in <static>", () => {
    expect(wrapExerciseSource(doenet)).toBe(
      '<exercise xml:id="drag" label="drag">\n<title>Drag <m>P</m></title>\n' +
        "<dynamic>\n<statement>\n" +
        '<interactive xml:id="drag-doenet" label="drag-doenet" platform="doenetml" resize-behavior="responsive" width="100%">\n' +
        '<slate surface="doenetml"><![CDATA[<p>What is <m>2 &amp; 2</m>? <answer name="a">4</answer></p>]]></slate>\n' +
        "</interactive>\n</statement>\n</dynamic>\n" +
        `<static>\n${DOENET_STATIC_FALLBACK}\n</static>\n</exercise>`,
    );
  });

  it("drops a stored aspect: the frame's height follows the activity", () => {
    for (const tag of EXERCISE_PLACEMENT_TAGS) {
      const xml = wrapExerciseSource(doenet, tag);
      expect(xml).not.toContain("aspect=");
      expect(xml).toContain('resize-behavior="responsive"');
    }
  });

  it("makes every wrapper dual, the project-likes as well as an exercise", () => {
    for (const tag of EXERCISE_WRAPPER_TAGS) {
      const xml = wrapExerciseSource(doenet, tag);
      expect(xml).toMatch(new RegExp(`^<${tag} xml:id="drag" label="drag">\\n<title>Drag <m>P</m></title>\\n<dynamic>\\n<statement>\\n<interactive `));
      expect(xml).toMatch(new RegExp(`</interactive>\\n</statement>\\n</dynamic>\\n<static>\\n[\\s\\S]*\\n</static>\\n</${tag}>$`));
      expect(xml).toContain(DOENET_STATIC_FALLBACK);
    }
  });

  it("wraps in the project-like element the tag names", () => {
    const xml = wrapExerciseSource(doenet, "activity");
    expect(xml).toMatch(/^<activity xml:id="drag" label="drag">\n<title>/);
    expect(xml).toMatch(/<\/static>\n<\/activity>$/);
  });

  it("places the bare interactive under the record's own ref", () => {
    const xml = wrapExerciseSource(doenet, "interactive");
    expect(xml).toMatch(/^<interactive xml:id="drag" label="drag" platform="doenetml"/);
    expect(xml).not.toContain("<exercise");
    expect(xml).not.toContain("<title>");
  });

  it("never lets attrs override the platform or the identifiers", () => {
    const xml = wrapExerciseSource({ ...doenet, attrs: { platform: "geogebra", label: "x", "xml:id": "y" } });
    expect(xml).toContain('<interactive xml:id="drag-doenet" label="drag-doenet" platform="geogebra"');
    expect(xml.match(/platform=/g)).toHaveLength(1);
  });

  it("keeps the source verbatim in one CDATA section", () => {
    expect(doenetmlCdata('<m a="1">x &amp; "y"</m>')).toBe('<![CDATA[<m a="1">x &amp; "y"</m>]]>');
  });

  it("splits a CDATA terminator in the source across two sections", () => {
    const source = "<text>a]]>b]]>c</text>";
    const cdata = doenetmlCdata(source);
    expect(cdata).toBe("<![CDATA[<text>a]]]]><![CDATA[>b]]]]><![CDATA[>c</text>]]>");
    // What an XML parser reads back: the sections' contents, joined.
    expect([...cdata.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((m) => m[1]).join("")).toBe(source);
  });

  it("leaves a comment when a designer exercise is placed under another tag", () => {
    expect(wrapExerciseSource(designer, "project")).toBe(
      '<!-- quiz is not a Doenet activity: place it with <plus:exercise ref="quiz"/> -->',
    );
    expect(wrapExerciseSource(designer)).toMatch(/^<exercise xml:id="quiz" label="quiz">/);
  });
});

describe("placement tags", () => {
  it("resolves every tag during assembly", () => {
    const doc = assemble(
      EXERCISE_PLACEMENT_TAGS.map((tag) => `<plus:${tag} ref="drag"/>`).join("\n"),
    );
    for (const tag of EXERCISE_WRAPPER_TAGS) {
      expect(doc).toContain(`<${tag} xml:id="drag" label="drag">`);
    }
    // The bare one carries the ref itself; the wrapped ones name their interactive after it.
    expect(doc.match(/<interactive xml:id="drag" label="drag"/g)).toHaveLength(1);
    expect(doc.match(/<interactive xml:id="drag-doenet"/g)).toHaveLength(EXERCISE_WRAPPER_TAGS.length);
    expect(doc).not.toContain("<plus:");
  });

  it("passes placement attributes to the element and qualifies an instance", () => {
    const doc = assemble('<plus:interactive ref="drag" width="50%" instance="two"/>');
    expect(doc).toContain('<interactive xml:id="drag-two" label="drag-two" platform="doenetml" resize-behavior="responsive" width="50%"');
    // The DoenetML inside the slate is text: nothing in it is qualified.
    expect(doc).toContain('<![CDATA[<p>What is <m>2 &amp; 2</m>? <answer name="a">4</answer></p>]]>');
  });

  it("takes the wrapper's title from the placement: none for title=\"no\", or a replacement", async () => {
    const doc = assemble(
      '<plus:exercise ref="drag" title="no"/>' +
        '<plus:project ref="drag" instance="p" title="Try it &amp; see"/>' +
        '<plus:activity ref="drag" instance="a"/>' +
        '<plus:interactive ref="drag" instance="i" title="no"/>',
    );
    expect(doc).toMatch(/<exercise xml:id="drag" label="drag">\n<dynamic>/);
    expect(doc).toContain('<project xml:id="drag-p" label="drag-p">\n<title>Try it &amp; see</title>\n');
    expect(doc).toContain('<activity xml:id="drag-a" label="drag-a">\n<title>Drag <m>P</m></title>\n');
    // Consumed, never copied onto the element as an attribute.
    expect(doc).not.toMatch(/<[a-z]+ [^>]*\btitle="/);
    expect(await validatePretextDocument(doc.replace(/<project[\s\S]*<\/activity>/, ""))).toEqual([]);
  });

  it("drops or replaces a designer exercise's title from the placement too", () => {
    const titled = { ...designer, title: "Pick one" };
    const pools = (source: string) =>
      assembleFullProjectSource([root(source)], "root", "", [], undefined, [], [titled]);
    expect(pools('<plus:exercise ref="quiz"/>')).toContain("<title>Pick one</title>");
    expect(pools('<plus:exercise ref="quiz" title="no"/>')).toMatch(/<exercise xml:id="quiz" label="quiz">\n<statement>/);
    expect(pools('<plus:exercise ref="quiz" title="Warm-up"/>')).toContain("<title>Warm-up</title>");
  });

  it("reads the title from a Markdown and a LaTeX placement", () => {
    const md = assembleFullProjectSource(
      [root('Text.\n\n::exercise{ref="drag" title="no"}\n', "markdown")], "root", "", [], undefined, [], [doenet],
    );
    expect(md).toMatch(/<exercise xml:id="drag" label="drag">\n<dynamic>/);
    const tex = assembleFullProjectSource(
      [root("Text.\n\n\\plus[title=no]{exercise}{drag}\n", "latex")], "root", "", [], undefined, [], [doenet],
    );
    expect(tex).toMatch(/<exercise xml:id="drag" label="drag">\n<dynamic>/);
  });

  it("leaves DoenetML that looks like PreTeXt, or like a placeholder, alone", async () => {
    // DoenetML has its own <section>, <title> and <exercise>, and nothing
    // stops an author typing an xml:id or a placeholder into it.
    const source =
      '<section xml:id="drag"><title>Inside</title><exercise label="quiz"><p>x ]]> y</p></exercise></section>\n' +
      '<plus:exercise ref="quiz"/><plus:image ref="nope"/>';
    const tricky: Exercise = { ...doenet, ref: "tricky", source };
    const doc = assembleFullProjectSource(
      [root('<plus:exercise ref="tricky"/><plus:interactive ref="tricky" instance="two" width="50%"/>')],
      "root", "", [], undefined, [], [tricky, designer],
    );
    const slates = [...doc.matchAll(/<slate surface="doenetml">([\s\S]*?)<\/slate>/g)].map((m) =>
      [...m[1].matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((c) => c[1]).join(""),
    );
    expect(slates).toEqual([source, source]);
    expect(doc).toContain('<interactive xml:id="tricky-two" label="tricky-two" platform="doenetml" resize-behavior="responsive" width="50%"');
    expect(await validatePretextDocument(doc)).toEqual([]);
  });

  it("is found, renamed and removed under every tag, in all three syntaxes", () => {
    const ptx = '<p>a</p><plus:project ref="drag"/><plus:interactive ref="drag"/><plus:exercise ref="quiz"/>';
    expect(parseExerciseRefs(ptx, "pretext").map((r) => r.ref)).toEqual(["drag", "drag", "quiz"]);
    expect(parsePlacements(ptx, "pretext").map((p) => p.tag)).toEqual(["project", "interactive", "exercise"]);
    expect(renameExerciseRef(ptx, "drag", "pull")).toBe(
      '<p>a</p><plus:project ref="pull"/><plus:interactive ref="pull"/><plus:exercise ref="quiz"/>',
    );
    expect(removeExerciseRef(ptx, "drag")).toBe('<p>a</p><plus:exercise ref="quiz"/>');

    const md = 'text\n\n::activity{ref="drag"}\n\n::interactive{ref="drag" width="50%"}\n';
    expect(parseExerciseRefs(md, "markdown").map((r) => r.ref)).toEqual(["drag", "drag"]);
    expect(renameExerciseRef(md, "drag", "pull")).toContain('::activity{ref="pull"}');
    expect(removeExerciseRef(md, "drag").trim()).toBe("text");

    const tex = "Text\n\\plus{exploration}{drag}\n\\plus[width=50\\%]{interactive}{drag}\n";
    expect(parseExerciseRefs(tex, "latex").map((r) => r.ref)).toEqual(["drag", "drag"]);
    expect(parsePlacements(tex, "latex").map((p) => p.tag)).toEqual(["exploration", "interactive"]);
    expect(renameExerciseRef(tex, "drag", "pull")).toContain("\\plus{exploration}{pull}");
    expect(removeExerciseRef(tex, "drag").trim()).toBe("Text");
  });

  it("writes the embed code for a tag in each syntax", () => {
    expect(exerciseEmbedCode("drag", "pretext", "project")).toBe('<plus:project ref="drag"/>');
    expect(exerciseEmbedCode("drag", "markdown", "interactive")).toBe('::interactive{ref="drag"}');
    expect(exerciseEmbedCode("drag", "latex", "activity")).toBe("\\plus{activity}{drag}");
    expect(exerciseEmbedCode("quiz")).toBe('<plus:exercise ref="quiz"/>');
  });

  it("reaches assembly from a LaTeX and a Markdown division", () => {
    const tex = derivePretextContent("\\plus{project}{drag}\n\n\\plus{interactive}{drag}\n", "latex").pretextSource ?? "";
    expect(tex).toMatch(/<plus:project\s+ref="drag"/);
    expect(tex).toMatch(/<plus:interactive\s+ref="drag"/);
    const md = derivePretextContent('::investigation{ref="drag"}\n\n::interactive{ref="drag"}\n', "markdown").pretextSource ?? "";
    expect(md).toMatch(/<plus:investigation\s+ref="drag"/);
    expect(md).toMatch(/<plus:interactive\s+ref="drag"/);
  });
});

describe("the DoenetML version", () => {
  it("is read from the docinfo", () => {
    expect(docinfoDoenetmlVersion('<docinfo><doenetml version="0.6.17"/></docinfo>')).toBe("0.6.17");
    expect(docinfoDoenetmlVersion("<docinfo><macros>x</macros></docinfo>")).toBeUndefined();
    expect(effectiveDoenetmlVersion("")).toBe(DEFAULT_DOENETML_VERSION);
  });

  it("is written into the assembled docinfo when the document uses DoenetML and names none", () => {
    expect(assemble('<plus:exercise ref="drag"/>')).toContain(
      `<doenetml version="${DEFAULT_DOENETML_VERSION}"/>`,
    );
    // Spliced in before </docinfo>, after the author's elements (and the default preamble).
    expect(assemble('<plus:exercise ref="drag"/>', "<docinfo><macros>\\newcommand{\\R}{\\mathbb R}</macros></docinfo>")).toMatch(
      /<macros>\\newcommand\{\\R\}\{\\mathbb R\}<\/macros>[\s\S]*\n\s*<doenetml version="[^"]+"\/>\n<\/docinfo>/,
    );
    // A hand-typed interactive counts too.
    expect(
      assemble('<interactive platform="doenetml" xml:id="i"><slate surface="doenetml">x</slate></interactive>'),
    ).toContain("<doenetml version=");
  });

  it("is left to the author when the docinfo names one, and absent without DoenetML", () => {
    const own = assemble('<plus:exercise ref="drag"/>', '<docinfo><doenetml version="0.6.17"/></docinfo>');
    expect(own).toContain('<doenetml version="0.6.17"/>');
    expect(own.match(/<doenetml\b/g)).toHaveLength(1);
    expect(assemble('<plus:exercise ref="quiz"/>')).not.toContain("<doenetml");
  });
});

describe("the schema", () => {
  const valid = async (source: string) => {
    const diagnostics = await validatePretextDocument(source);
    expect(diagnostics.map((d) => d.message)).toEqual([]);
  };

  it("accepts a Doenet activity as an exercise, in a figure and in a task", async () => {
    await valid(
      assemble(
        [
          "<p>Intro.</p>",
          '<plus:exercise ref="drag" instance="exercise"/>',
          '<figure xml:id="fig"><caption>In a figure.</caption><plus:interactive ref="drag"/></figure>',
          '<exercise xml:id="hand"><title>Hand-written</title><introduction><p>Two parts.</p></introduction>',
          '<task><plus:interactive ref="drag" instance="task"/></task>',
          '<task><statement><p>And a plain one.</p></statement></task></exercise>',
        ].join("\n"),
      ),
    );
  });

  // PreTeXt's XSL treats a dual project-like as it does a dual exercise, and
  // Runestone books place Doenet that way, but the development schema admits
  // the form for <exercise> only so far. The live lint draws none of this on
  // the author's buffer (it falls inside the expanded placement). When the
  // schema catches up this test fails: fold the project-likes into the one above.
  it("is rejected by the schema for a dual project-like only for the dual shape itself", async () => {
    const projectLikes = EXERCISE_WRAPPER_TAGS.filter((tag) => tag !== "exercise");
    const doc = assemble(projectLikes.map((tag) => `<plus:${tag} ref="drag" instance="${tag}"/>`).join("\n"));
    const lines = doc.split("\n");
    const flagged = (await validatePretextDocument(doc)).map(
      (d) => `${lines[d.range.start.line].trim()} ${String(d.message).split(".")[0]}`,
    );
    expect(flagged).toEqual(
      projectLikes.flatMap((tag) => [
        "<dynamic> <dynamic> is not allowed here",
        "<static> <static> is not allowed here",
        `</${tag}> Missing required content`,
      ]),
    );
  });

  it("accepts the starter activity in its preview document", async () => {
    await valid(
      assembleExercisePreviewSource(
        "drag",
        { divisions: [], snippets: [], assets: [], exercises: [{ ...doenet, source: DOENET_STARTER }] },
        "",
      ),
    );
  });
});

describe("the collab entry", () => {
  it("carries the source format", () => {
    const doc = new Y.Doc();
    const exercises = getExercisesMap(doc);
    exercises.set("e1", makeExerciseEntry(doenet));
    exercises.set("e2", makeExerciseEntry(designer));
    expect(exerciseEntryToSnapshot("e1", exercises.get("e1")!)).toEqual({ id: "e1", ...doenet });
    expect(exerciseEntryToSnapshot("e2", exercises.get("e2")!).sourceFormat).toBeUndefined();
  });
});

describe("the editor page", () => {
  it("loads the version asked for, holds the source, and ends no script early", () => {
    const page = doenetEditorPage({ version: "0.7.29", source: 'a </script> b $& "c"' });
    expect(page).toContain("https://cdn.jsdelivr.net/npm/@doenet/standalone@0.7.29/doenet-standalone.js");
    expect(page).toContain("https://cdn.jsdelivr.net/npm/@doenet/standalone@0.7.29/style.css");
    expect(page).toContain('"source":"a <\\/script> b $& \\"c\\""');
    expect(page.match(/<\/script>/g)).toHaveLength(2);
    expect(page).toContain('"readOnly":false');
    expect(doenetEditorPage({ version: "x", source: "", readOnly: true })).toContain('"readOnly":true');
    expect(DOENET_EDITOR_SANDBOX).toBe("allow-scripts");
  });

  it("is light unless told otherwise, and hands the theme to Doenet's editor", () => {
    const light = doenetEditorPage({ version: "x", source: "" });
    expect(light).toContain('"theme":"light"');
    expect(light).toContain('<html style="color-scheme: light">');
    expect(light).toContain("darkMode: INIT.theme");
    const system = doenetEditorPage({ version: "x", source: "", theme: "system" });
    expect(system).toContain('"theme":"system"');
    expect(system).toContain('<html style="color-scheme: light dark">');
    expect(doenetEditorPage({ version: "x", source: "", theme: "dark" })).toContain('<html style="color-scheme: dark">');
  });
});
