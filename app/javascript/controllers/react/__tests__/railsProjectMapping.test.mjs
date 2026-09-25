import { describe, it, expect } from "vitest";
import {
  railsToEditorState,
  effectiveDocinfo,
  assembleProjectJson,
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
      source: '<book xml:id="root"><title>A Book</title><plus:chapter ref="ch1"/></book>',
    },
    {
      id: "d-ch1",
      ref: "ch1",
      source_format: "pretext",
      is_root: false,
      source: '<chapter xml:id="ch1"><title>One</title><p>Hello.</p></chapter>',
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

  it("reads a pretext root's type out of its own source, not out of document_type", () => {
    // The TOC lets an author switch article <-> book by rewriting the root's
    // source; `document_type` never hears about it. Whichever of the two this
    // trusts is the one that decides the assembled document's root element.
    const json = project({ document_type: "article" });
    const root = railsToEditorState(json).divisions.find((d) => d.id === "d-root");

    expect(root.type).toBe("book");
  });

  it("falls back to document_type for a latex root, which carries no tag to read", () => {
    const json = project({
      document_type: "book",
      divisions: [
        {
          id: "d-root",
          ref: "root",
          source_format: "latex",
          is_root: true,
          source: "\\book{A Book}\\label{root}",
        },
      ],
    });
    const root = railsToEditorState(json).divisions.find((d) => d.id === "d-root");

    expect(root.type).toBe("book");
  });

  it("attaches no type to a pretext root still holding a bare section", () => {
    // Pre-migration data. Guessing "article" here would make the editor rewrap
    // that section, so the absence is deliberate.
    const json = project({
      divisions: [
        {
          id: "d-root",
          ref: "root",
          source_format: "pretext",
          is_root: true,
          source: '<section xml:id="root"><title>Orphan</title></section>',
        },
      ],
    });
    const root = railsToEditorState(json).divisions.find((d) => d.id === "d-root");

    expect(root.type).toBeUndefined();
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
    expect(xml).toContain("<title>One</title>");
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
            source: '<book xml:id="root"><title>A Book</title><p><plus:image ref="fig"/></p></book>',
          },
        ],
        assets: [
          {
            id: "a1",
            ref: "fig",
            kind: "file",
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
            source: '<book xml:id="root"><title>A Book</title><plus:chapter ref="gone"/></book>',
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
