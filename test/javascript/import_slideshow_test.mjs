import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serializeProjectToPlusPayload, projectForImportMode } from "@pretextbook/import";
import { buildImportEngines } from "../../app/javascript/controllers/react/importEngines.js";

// These drive the real @pretextbook/import pipeline the way the new-project
// wizard does -- the same engine, then the same serialization -- because what
// they guard is what that package actually emits, not what we assume it does.
const [engine] = buildImportEngines({});

/** Convert `files` as the wizard would, with the reader's "Document kind" choice. */
function convert(files, options = {}) {
  return engine.convertPrepared({ fileName: "upload", files, assets: {}, analysis: {} }, options);
}

/** The Rails payload for a conversion, in one of the review step's two modes. */
function payload(result, mode) {
  assert.ok(!("pretextError" in result), `conversion failed: ${result.pretextError}`);
  return serializeProjectToPlusPayload(projectForImportMode(result, mode));
}

const rootOf = (p) => p.divisions_attributes.find((d) => d.is_root);

const BEAMER = String.raw`\documentclass{beamer}
\title{Limits and Continuity}
\begin{document}
\section{Intro}
\begin{frame}{One}
Hello $x$.
\end{frame}
\begin{frame}{Two}
World.
\end{frame}
\end{document}`;

const MARKDOWN_DECK = `---
title: Deck
division: slideshow
---

# Intro

## One

Hello.
`;

const PRETEXT_DECK = `<pretext>
<slideshow xml:id="deck"><title>Deck</title>
<slide><title>One</title><p>Hi</p></slide>
</slideshow>
</pretext>`;

// What this deployment decides about a slideshow import. Detection and the
// markup itself are the importer's; these are ours.
describe("slideshow imports", () => {
  it("detects a deck from each of the three source formats", () => {
    for (const [name, files] of [
      ["beamer", { "main.tex": BEAMER }],
      ["markdown", { "main.md": MARKDOWN_DECK }],
      ["pretext", { "main.ptx": PRETEXT_DECK }],
    ]) {
      assert.equal(payload(convert(files), "converted").document_type, "slideshow", name);
    }
  });

  it("honours a 'Slides' choice for a source that does not announce itself", () => {
    // The wizard's Document kind dropdown is the only way to reach this: left
    // to itself this Markdown is a book, since nothing in it says otherwise.
    const files = { "main.md": "# Intro\n\n## One\n\nHello.\n\n## Two\n\nBye.\n" };
    assert.equal(payload(convert(files), "converted").document_type, "book");

    const chosen = payload(convert(files, { documentKind: "slideshow" }), "converted");
    assert.equal(chosen.document_type, "slideshow");
    // `#` became a <section> and `##` a <slide>, rather than section/subsection.
    assert.equal(rootOf(chosen).source.match(/<slide>/g).length, 2);
  });

  it("keeps a deck in one division record rather than splitting it", () => {
    // Our SPLIT_LEVEL forces a book-depth split for everything else; a deck is
    // small enough to be one record, which is also the package's own default.
    for (const [name, files] of [
      ["beamer", { "main.tex": BEAMER }],
      ["markdown", { "main.md": MARKDOWN_DECK }],
      ["pretext", { "main.ptx": PRETEXT_DECK }],
    ]) {
      for (const mode of ["converted", "native"]) {
        const p = payload(convert(files), mode);
        assert.equal(p.divisions_attributes.length, 1, `${name}/${mode}`);
        assert.ok(rootOf(p), `${name}/${mode} has a root`);
      }
    }
  });

  it("still splits an article and a book", () => {
    const article = payload(convert({ "main.tex": "\\documentclass{article}\\title{Doc}\\begin{document}\\section{Intro}\nHello.\\end{document}" }), "converted");
    assert.equal(article.document_type, "article");
    assert.ok(article.divisions_attributes.length > 1, "an article splits");

    const book = payload(convert({ "main.md": "# Intro\n\n## One\n\nHello.\n" }), "converted");
    assert.equal(book.document_type, "book");
    assert.ok(book.divisions_attributes.length > 1, "a book splits");
  });
});

// A deck's root element has to survive the import as `<slideshow>`. This is a
// regression guard with history: @pretextbook/import 0.14.0 detected a deck and
// then discarded the root, its layout stage wrapping the converted <slideshow>
// in <article xml:id="document"> and emitting `\article{}` for the LaTeX
// projection -- in `outputFiles` (what pretext-tools writes to disk) as much as
// in the record pool we serialize.
//
// That was fatal here rather than merely wrong, because plus reads a project's
// root element out of the root division's own source (the PRETEXT_ROOT_TAG match
// in `railsProjectMapping.js`) rather than trusting `document_type`. An <article>
// wrapper silently outvoted it, and the deck rendered with no slides in it --
// see the `rootType` note on `wrapDivisionForPreview` in `sectionUtils.ts`.
//
// Fixed upstream in 0.14.1, which is the floor package.json now depends on.
// https://github.com/PreTeXtBook/pretext-tools -- packages/import
describe("slideshow root element", () => {
  it("gives a converted deck a <slideshow> root", () => {
    const root = rootOf(payload(convert({ "main.tex": BEAMER }), "converted"));
    assert.doesNotMatch(root.source, /<article/);
    assert.match(root.source, /^<slideshow[\s>]/);
  });

  it("gives a deck kept as LaTeX a \\slideshow root", () => {
    const root = rootOf(payload(convert({ "main.tex": BEAMER }), "native"));
    assert.match(root.source, /^\\slideshow\{Limits and Continuity\}/);
  });

  it("keeps a PreTeXt deck's own xml:id", () => {
    const p = payload(convert({ "main.ptx": PRETEXT_DECK }), "converted");
    assert.equal(rootOf(p).ref, "deck");
  });
});
