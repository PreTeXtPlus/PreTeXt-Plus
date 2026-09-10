/**
 * @vitest-environment jsdom
 *
 * Importing a document into a project that already exists.
 *
 * Driven from a real `@pretextbook/import` run rather than hand-written
 * records, because the point of this module is to sit correctly on the other
 * side of that contract: the record shape, the placeholder syntax and the
 * retargeting are all upstream's, and a fixture would keep passing after any
 * of them changed.
 *
 * The last test is the one that matters most — it assembles the project the
 * way the preview and the schema linter do and checks the result against the
 * real PreTeXt grammar, so an insert that produced a document nobody could
 * build would fail here rather than in front of an author.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  importProjectFromFiles,
  serializeInsertToRecords,
  type ImportedProjectSuccess,
} from "@pretextbook/import";
import { planInsertImport, takenRefs } from "../insertImport";
import { assembleFullProjectSource } from "../sectionUtils";
import {
  setPretextSchemaUrl,
  validatePretextDocument,
} from "../components/editorConfigs/pretextSchema";
import type { Division } from "../types/sections";

const require = createRequire(import.meta.url);
const GRAMMAR_URL = "https://test.invalid/pretext.json";
let realFetch: typeof globalThis.fetch;

beforeAll(() => {
  const grammar = fs.readFileSync(
    path.join(
      path.dirname(require.resolve("@pretextbook/schema")),
      "assets",
      "pretext.json",
    ),
    "utf8",
  );
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: unknown) => {
    if (String(input) !== GRAMMAR_URL) throw new Error(`unexpected fetch: ${input}`);
    return new Response(grammar, { status: 200 });
  }) as typeof globalThis.fetch;
  setPretextSchemaUrl(GRAMMAR_URL);
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

/**
 * The LaTeX being brought in: two sections, so order is observable, and two
 * paragraphs each — see the `it.fails` at the end for why the second one
 * matters.
 */
const HOMEWORK = [
  "\\section{Homework 3}",
  "Solve every problem.",
  "",
  "Show all your working.",
  "\\section{Homework 4}",
  "Solve these too.",
  "",
  "Again, show your working.",
].join("\n");

const division = (over: Partial<Division> & Pick<Division, "xmlId">): Division => ({
  title: "",
  type: "section",
  sourceFormat: "pretext",
  source: "",
  ...over,
});

/**
 * The division being imported into: a section whose own prose sits in an
 * `<introduction>`.
 *
 * That is not incidental. PreTeXt does not let a division hold loose block
 * content *and* subdivisions — `<section><p/><subsection/></section>` is
 * rejected, while the same prose inside an `<introduction>` is fine — so a
 * section with a bare paragraph in it is made invalid by the act of importing
 * a subdivision into it. Authors will meet that; the editor's schema linter
 * reports it, and repairing it would mean rewriting prose nobody asked us to
 * touch. See the test at the end, which pins the rule.
 */
const parent = (): Division =>
  division({
    xmlId: "sec-existing",
    title: "An existing section",
    type: "section",
    source:
      '<section xml:id="sec-existing">\n' +
      "  <title>An existing section</title>\n" +
      "  <introduction>\n    <p>Already here.</p>\n  </introduction>\n" +
      "</section>",
  });

const root = (): Division =>
  division({
    xmlId: "art-a",
    title: "Doc",
    type: "article",
    source:
      '<article xml:id="art-a">\n<title>Doc</title>\n<plus:section ref="sec-existing"/>\n</article>',
  });

/** Import `HOMEWORK` as a `subsection` of the receiving division. */
function importIntoDivision(receiving: Division, takenIds: string[]) {
  const result = importProjectFromFiles(
    { "homework.tex": HOMEWORK },
    {
      destination: {
        kind: "insert",
        targetTag: "subsection",
        takenIds: new Set(takenIds),
        hrefBase: "",
      },
      splitLevel: 1,
    },
  );
  expect("pretextError" in result, JSON.stringify(result)).toBe(false);
  const success = result as ImportedProjectSuccess;
  const records = serializeInsertToRecords(success.project, {
    targetTag: "subsection",
    unwrapRoot: success.insert?.unwrapRoot ?? false,
  });
  return { success, records, plan: planInsertImport(records, receiving) };
}

describe("takenRefs", () => {
  // The host enforces one ref namespace across all three record kinds, so an
  // import told only about divisions can mint a name an image already has and
  // be rejected on save.
  it("spans divisions, assets and snippets", () => {
    expect(
      takenRefs(
        [{ xmlId: "sec-one" }],
        [{ ref: "fig-plot" }],
        [{ ref: "snip-macro" }],
      ),
    ).toEqual(["sec-one", "fig-plot", "snip-macro"]);
  });
});

describe("planInsertImport", () => {
  it("derives each division's title and type from its own source", () => {
    const { plan } = importIntoDivision(parent(), ["art-a", "sec-existing"]);

    expect(plan.divisions.length).toBeGreaterThan(0);
    for (const d of plan.divisions) {
      expect(d.xmlId).toBeTruthy();
      // Record identity belongs to `applyDivisionAdd`, which mints one for
      // every division it takes; an id here would only be overwritten.
      expect(d.id).toBeUndefined();
    }
    expect(plan.divisions.map((d) => d.title)).toContain("Homework 3");
    // Retargeted to the level asked for, not the `\section` it was written as.
    expect(plan.divisions.map((d) => d.type)).toContain("subsection");
  });

  it("writes a placeholder into the receiving division for each unit", () => {
    const { records, plan } = importIntoDivision(parent(), ["art-a", "sec-existing"]);

    for (const ref of records.placeholders) {
      const xmlId = /ref="([^"]+)"/.exec(ref)?.[1];
      expect(xmlId).toBeTruthy();
      expect(plan.parentSource).toContain(`ref="${xmlId}"`);
    }
    expect(plan.parentSource).toContain("Already here.");
  });

  // Each placeholder is anchored after the one before it; without that they
  // arrive in reverse, since every unanchored insert lands at the same spot.
  it("keeps the imported order", () => {
    const { records, plan } = importIntoDivision(parent(), ["art-a", "sec-existing"]);
    const refs = records.placeholders.map(
      (p) => /ref="([^"]+)"/.exec(p)?.[1] ?? "",
    );
    expect(refs.length).toBeGreaterThan(1);

    const positions = refs.map((ref) => plan.parentSource.indexOf(`ref="${ref}"`));
    expect(positions).not.toContain(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  // The importer is told what is already spoken for; nothing it mints may
  // collide with it, or the host rejects the save.
  it("mints refs that avoid the ones already in the project", () => {
    const taken = ["art-a", "sec-existing", "subsec-01", "subsec-02"];
    const { plan } = importIntoDivision(parent(), taken);
    for (const d of plan.divisions) {
      expect(taken).not.toContain(d.xmlId);
    }
  });

  // A LaTeX-authored parent cannot hold `<plus:section ref/>`: there it is
  // literal text, and the division it names would show up orphaned.
  it("writes the placeholder in the receiving division's own format", () => {
    const latexParent = division({
      xmlId: "sec-latex",
      title: "A LaTeX section",
      type: "section",
      sourceFormat: "latex",
      source: "\\section{A LaTeX section}\n\nAlready here.\n",
    });
    const { plan } = importIntoDivision(latexParent, ["art-a", "sec-latex"]);

    expect(plan.parentSource).toMatch(/\\plus\{subsection\}\{/);
    expect(plan.parentSource).not.toContain("<plus:");
  });

  it("produces a project that validates against the PreTeXt schema", async () => {
    const receiving = parent();
    const { plan } = importIntoDivision(receiving, ["art-a", "sec-existing"]);

    // The project as it stands after the insert: the parent rewritten, and the
    // imported divisions added to the pool.
    const divisions: Division[] = [
      root(),
      { ...receiving, source: plan.parentSource },
      ...plan.divisions,
    ];

    const assembled = assembleFullProjectSource(divisions, "art-a", "");
    expect(await validatePretextDocument(assembled)).toEqual([]);
  });

  // Why `parent()` keeps its prose in an `<introduction>`: importing a
  // subdivision into a division that holds a loose paragraph makes that
  // division invalid, whatever the import does. Pinned so the constraint is
  // discoverable from here rather than from a puzzling lint error later.
  it("cannot rescue a receiving division that holds loose prose", async () => {
    const loose = division({
      xmlId: "sec-loose",
      title: "Has loose prose",
      type: "section",
      source:
        '<section xml:id="sec-loose">\n  <title>Has loose prose</title>\n' +
        "  <p>Not in an introduction.</p>\n</section>",
    });
    const { plan } = importIntoDivision(loose, ["art-a", "sec-loose"]);
    const assembled = assembleFullProjectSource(
      [
        { ...root(), source: root().source.replace("sec-existing", "sec-loose") },
        { ...loose, source: plan.parentSource },
        ...plan.divisions,
      ],
      "art-a",
      "",
    );
    const diagnostics = await validatePretextDocument(assembled);
    expect(diagnostics.map((d) => d.message).join(" ")).toMatch(
      /<subsection> is not allowed here/,
    );
  });

  /**
   * A known gap upstream, pinned here so we are told when it closes.
   *
   * `unified-latex` wraps a division's body in `<p>` only when the LaTeX had
   * more than one paragraph, so a section with a single one converts to bare
   * text inside the division — which the schema rejects wherever it appears.
   * This is the same root cause as the paste bug fixed in `@pretextbook/import`
   * 0.13.0, but on the *import* path rather than the paste path, so it is
   * untouched by that fix: it affects new-project imports as much as inserts,
   * and the `wrapLooseParagraphs` helper 0.13.0 exports does not reach it
   * (that pass is for a fragment's top level, while this loose text is nested
   * inside `<section>`). Markdown imports are unaffected.
   *
   * `it.fails` rather than `it.skip` so this turns red — and gets deleted —
   * the day the conversion starts wrapping.
   */
  it.fails("upstream gap: a single-paragraph LaTeX section imports as bare text", async () => {
    const receiving = parent();
    const result = importProjectFromFiles(
      { "homework.tex": "\\section{Homework 3}\nSolve every problem." },
      {
        destination: {
          kind: "insert",
          targetTag: "subsection",
          takenIds: new Set(["art-a", "sec-existing"]),
          hrefBase: "",
        },
        splitLevel: 1,
      },
    ) as ImportedProjectSuccess;
    const records = serializeInsertToRecords(result.project, {
      targetTag: "subsection",
      unwrapRoot: result.insert?.unwrapRoot ?? false,
    });
    const plan = planInsertImport(records, receiving);

    const assembled = assembleFullProjectSource(
      [root(), { ...receiving, source: plan.parentSource }, ...plan.divisions],
      "art-a",
      "",
    );
    expect(await validatePretextDocument(assembled)).toEqual([]);
  });
});
