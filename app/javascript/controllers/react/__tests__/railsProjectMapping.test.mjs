import { describe, it, expect } from "vitest";
import {
  railsToEditorState,
  effectiveDocinfo,
  assembleProjectJson,
  editorDivisionToRails,
  splitImportedDivisions,
} from "../railsProjectMapping.js";

/**
 * This module became load-bearing when the server stopped storing the assembled
 * document and started building it on demand: `assembleProjectJson` is what
 * `script/assemble-source.mjs` runs under Node for every full build, and
 * `railsToEditorState` is what the browser renders from. They are the same
 * functions deliberately -- a build has to get the document the author was
 * looking at -- so the thing worth pinning here is the behaviour Ruby cannot
 * see: what this makes of the project JSON before the assembler ever runs.
 *
 * The Ruby side has its own half of this (SourceAssemblerTest asserts that
 * `SourceAssembler#payload` still matches the JSON the editor is served). These
 * are the other half: given that JSON, what comes out.
 */

const project = (overrides = {}) => ({
  title: "A Book",
  docinfo: "<docinfo/>",
  document_type: "book",
  language: "en-US",
  divisions: [
    {
      id: "d-root",
      ref: "root",
      source_format: "pretext",
      is_root: true,
      division_type: "book",
      title: "A Book",
      source: '<plus:chapter ref="ch1"/>',
    },
    {
      id: "d-ch1",
      ref: "ch1",
      source_format: "pretext",
      is_root: false,
      division_type: "chapter",
      title: "One",
      source: "<p>Hello.</p>",
    },
  ],
  assets: [],
  snippets: [],
  ...overrides,
});

describe("railsToEditorState", () => {
  it("keys the root by its xml:id and its record id, which move independently", () => {
    const state = railsToEditorState(project());

    // `rootDivisionId` is the ref, because that is how the editor addresses
    // divisions; `rootDivisionUuid` is the row, which survives a ref rename.
    expect(state.rootDivisionId).toBe("root");
    expect(state.rootDivisionUuid).toBe("d-root");
  });

  it("reads a division's type, title, label and attributes off its record", () => {
    // The TOC lets an author switch article <-> book on the root's own record;
    // `document_type` never hears about it. Whichever of the two this trusts is
    // the one that decides the assembled document's root element.
    const json = project({ document_type: "article" });
    json.divisions[1] = { ...json.divisions[1], label: "L", attrs: { component: "x" } };
    const [root, chapter] = railsToEditorState(json).divisions;

    expect(root.type).toBe("book");
    expect(chapter).toMatchObject({
      type: "chapter",
      title: "One",
      label: "L",
      attrs: { component: "x" },
      source: "<p>Hello.</p>",
    });
  });

  it("gives a division without a type the one its place implies", () => {
    const json = project();
    json.divisions = json.divisions.map(({ division_type, ...d }) => d);
    const [root, chapter] = railsToEditorState(json).divisions;

    expect(root.type).toBe("book");
    expect(chapter.type).toBe("section");
  });

  it("maps a division back to the attributes Rails accepts, never moving the root", () => {
    const [root] = railsToEditorState(project()).divisions;
    const attributes = editorDivisionToRails(root);

    expect(attributes).toMatchObject({
      id: "d-root",
      ref: "root",
      division_type: "book",
      title: "A Book",
      source: '<plus:chapter ref="ch1"/>',
    });
    expect(attributes).not.toHaveProperty("is_root");
  });

  it("treats an unrecognised document_type as an article rather than as a tag", () => {
    // The value is written into the document as an element name, so a wrong tag
    // is worse than a default one.
    expect(railsToEditorState(project({ document_type: "zzz" })).projectType).toBe("article");
  });

  it("supplies the defaults Rails may send as null", () => {
    const state = railsToEditorState({});

    expect(state.title).toBe("");
    expect(state.docinfo).toBe("");
    expect(state.language).toBe("en-US");
    expect(state.divisions).toEqual([]);
    expect(state.rootDivisionId).toBeUndefined();
  });
});

describe("effectiveDocinfo", () => {
  const state = (useCommonDocinfo, commonDocinfo) => ({
    docinfo: "<docinfo>own</docinfo>",
    commonDocinfo,
    useCommonDocinfo,
  });

  it("prefers the user's common preamble when the project opts in", () => {
    expect(effectiveDocinfo(state(true, "<docinfo>shared</docinfo>"))).toBe(
      "<docinfo>shared</docinfo>",
    );
  });

  it("uses the project's own when it does not", () => {
    expect(effectiveDocinfo(state(false, "<docinfo>shared</docinfo>"))).toBe(
      "<docinfo>own</docinfo>",
    );
  });

  // Opting in to a preamble that was never written should not blank the
  // document's docinfo -- the build would lose every macro.
  it("uses the project's own when the common one is empty", () => {
    expect(effectiveDocinfo(state(true, ""))).toBe("<docinfo>own</docinfo>");
  });
});

describe("assembleProjectJson", () => {
  it("resolves division placeholders into one standalone document", () => {
    const xml = assembleProjectJson(project());

    expect(xml).toMatch(/^<pretext/);
    expect(xml).toContain('<book xml:id="root" label="root">');
    expect(xml).toContain('<chapter xml:id="ch1">\n<title>One</title>');
    expect(xml).toContain("Hello.");
    expect(xml).not.toContain("plus:chapter");
  });

  it("writes the language as xml:lang on the root element", () => {
    expect(assembleProjectJson(project({ language: "fr-FR" }))).toContain('xml:lang="fr-FR"');
  });

  it("puts the docinfo in effect into the document, not the project's own", () => {
    const xml = assembleProjectJson(
      project({
        docinfo: "<docinfo>own</docinfo>",
        common_docinfo: "<docinfo>shared</docinfo>",
        use_common_docinfo: true,
      }),
    );

    expect(xml).toContain("shared");
    expect(xml).not.toContain("own");
  });

  it("resolves a file-backed image asset to the bare filename the archive writes", () => {
    // `<image source>` names a file inside the archive's external/ directory,
    // which ProjectArchiveBuilder writes as "<ref>.<ext>". A full URL here would
    // be double-prefixed by the build server.
    const xml = assembleProjectJson(
      project({
        divisions: [
          {
            id: "d-root",
            ref: "root",
            source_format: "pretext",
            is_root: true,
            division_type: "book",
            title: "A Book",
            source: '<p><plus:image ref="fig"/></p>',
          },
        ],
        assets: [
          {
            id: "a1",
            ref: "fig",
            kind: "file_asset",
            title: "A Figure",
            short_description: "A figure",
            extension: "png",
            content_type: "image/png",
            path: "/projects/x/external/fig.png",
          },
        ],
      }),
    );

    expect(xml).toContain('<image source="fig.png">');
    expect(xml).toContain("<shortdescription>A figure</shortdescription>");
    expect(xml).not.toContain("/projects/x/external");
  });

  it("leaves a loud comment where a ref names nothing, rather than dropping it", () => {
    const xml = assembleProjectJson(
      project({
        divisions: [
          {
            id: "d-root",
            ref: "root",
            source_format: "pretext",
            is_root: true,
            division_type: "book",
            title: "A Book",
            source: '<plus:chapter ref="gone"/>',
          },
        ],
      }),
    );

    expect(xml).toContain("missing division: gone");
  });

  // "" rather than a throw: it is what the editor's save path produced for a
  // project in this state, and SourceAssembler passes it through as a success.
  it("assembles a project with no root division to nothing", () => {
    expect(assembleProjectJson(project({ divisions: [] }))).toBe("");
  });
});

describe("splitImportedDivisions", () => {
  // What @pretextbook/import emits: each division's whole source, element and all.
  const payload = {
    title: "Imported",
    document_type: "book",
    divisions_attributes: [
      {
        ref: "root",
        is_root: true,
        source_format: "pretext",
        source: '<book xml:id="root"><title>A Book</title>\n<plus:chapter ref="ch1"/>\n</book>',
      },
      {
        ref: "ch1",
        source_format: "latex",
        source: "\\chapter{One $x$}\\label{ch1}\n\nHello.",
      },
      {
        ref: "md",
        source_format: "markdown",
        source: '---\ndivision: section\nid: md\ntitle: "Hi"\ncomponent: teacher\n---\n\nBody.',
      },
    ],
  };

  it("takes each division's element apart into the columns it is built from", () => {
    const [root, chapter, md] = splitImportedDivisions(payload).divisions_attributes;

    expect(root).toMatchObject({ division_type: "book", title: "A Book", source: '<plus:chapter ref="ch1"/>' });
    expect(chapter).toMatchObject({ division_type: "chapter", title: "One $x$", source: "Hello." });
    expect(md).toMatchObject({ division_type: "section", title: "Hi", attrs: { component: "teacher" }, source: "Body." });
  });

  it("gives a root with no element of its own the project's type and title", () => {
    const [root] = splitImportedDivisions({
      ...payload,
      divisions_attributes: [{ ref: "root", is_root: true, source_format: "latex", source: "Just prose." }],
    }).divisions_attributes;

    expect(root).toMatchObject({ division_type: "book", title: "Imported", source: "Just prose." });
  });

  it("leaves a payload without divisions alone", () => {
    expect(splitImportedDivisions({ title: "x" })).toEqual({ title: "x" });
  });
});
