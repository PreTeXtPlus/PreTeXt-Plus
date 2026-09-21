/**
 * The converters this app offers, shared by both places that import: the
 * new-project wizard (`react/import.jsx`) and the editor's Tools → Import…
 * dialog (`<Editors importEngines>`), which converts a file for the author to
 * paste into the division they are editing.
 *
 * They are built here rather than in either mount because two copies would be
 * two chances to disagree about which formats this deployment reads. The split
 * depth below matters only to the wizard: the editor's dialog takes the whole
 * converted document and never looks at the layout.
 */
import {
  analyzeImportSources,
  createRemotePandocEngine,
  extractUpload,
  importProjectFromFiles,
  relayoutImport,
} from "@pretextbook/import";

/** @typedef {import("@pretextbook/import").ImportProjectOptions} ImportProjectOptions */
/** @typedef {import("@pretextbook/import").ImportedProjectResult} ImportedProjectResult */

/**
 * How many levels of division to split out of the root, per document kind, so
 * that either kind splits down to its **subsections**.
 *
 * The depths differ because `resolveSplitLevel` counts levels below the root
 * element, and a book has a chapter layer an article does not: for a book 3 is
 * chapter → section → subsection, while for an article 2 is already
 * section → subsection (3 would carry on into subsubsections).
 *
 * Splitting this far is not a preference here, it's the storage model: a plus
 * project keeps each division as its own record, joined by `<plus:* ref="…"/>`
 * placeholders, and that is the unit of editing, of the table of contents, and
 * of collaborative locking. A division left unsplit is one nobody can open on
 * their own.
 *
 * A deck is the exception: it stays one record, sections and slides inline in
 * the root. That is the package's own default for a slideshow (`splitLevel` 0),
 * which the book depth below would otherwise override. Slides are not
 * divisions, so there is nothing under a `<section>` to split out, and one
 * record is the shape a new slideshow project starts in
 * (`app/default_docs/slideshow.xml`).
 */
const SPLIT_LEVEL = { book: 3, article: 2, slideshow: 0 };

/**
 * Convert an already-unpacked upload, splitting deeply enough that every
 * division it produces is its own record.
 *
 * The document kind is not knowable up front —
 * `detectDocumentKind` reads *PreTeXt* source, so a raw LaTeX or Markdown
 * upload only classifies itself once converted — so this converts at the book
 * depth and repeats at the article depth if that is what came back. The second
 * pass only ever runs for articles, which are the cheap case by definition; a
 * book, the expensive one, is right on the first try. A slideshow needs no
 * second conversion either: only its layout differs, so it is re-split from the
 * result already in hand.
 *
 * @param {Record<string, string>} files
 * @param {ImportProjectOptions} options
 * @returns {ImportedProjectResult}
 */
function importSplitToSubsections(files, options) {
  const asBook = importProjectFromFiles(files, {
    ...options,
    splitLevel: SPLIT_LEVEL.book,
  });
  if ("pretextError" in asBook || asBook.documentKind === "book") return asBook;
  if (asBook.documentKind === "slideshow") {
    return relayoutImport(asBook, SPLIT_LEVEL.slideshow);
  }

  return importProjectFromFiles(files, {
    ...options,
    splitLevel: SPLIT_LEVEL.article,
  });
}

/**
 * The in-browser converter, replacing the wizard's built-in one so the split
 * depth is ours rather than the checkbox's.
 *
 * `prepare`/`convertPrepared` mirror the built-in engine exactly apart from
 * that; `convertFile` is required by the interface but unreachable, since the
 * wizard prefers the two-phase pair whenever an engine supplies it.
 *
 * @type {import("@pretextbook/import/react").ImportEngine}
 */
const builtinEngine = {
  id: "pretext-plus",
  label: "Built-in converter",
  prepare: async (file) => {
    const { files, assets } = await extractUpload(file);
    return { fileName: file.name, files, assets, analysis: analyzeImportSources(files) };
  },
  convertPrepared: (prepared, options) =>
    importSplitToSubsections(prepared.files, { ...options, assets: prepared.assets }),
  convertFile: async (file, options) => {
    const { files, assets } = await extractUpload(file);
    return importSplitToSubsections(files, { ...options, assets });
  },
};

/**
 * The second converter: pandoc, running on the lite build server.
 *
 * This is what brings Word, OpenOffice, EPUB, HTML, reStructuredText, Org and
 * Typst within reach — formats the in-browser pipeline cannot read at all.
 *
 * Nobody picks it. The wizard routes each upload by extension, so a `.docx`
 * arrives here and a `.zip` of LaTeX does not; where both converters read a
 * format (`.tex`, `.md`) the engine listed first wins, and the other is offered
 * on the review step as something to switch to once there is a result to judge.
 *
 * `url` is our own Rails proxy (`projects#pandoc`), never the build server
 * itself, and `token` is deliberately absent: the shared build credential is
 * added server-side, which is the arrangement the option documents as "omit
 * when proxying". `credentials: "same-origin"` sends the session cookie the
 * proxy authenticates on, and the CSRF token rides alongside it.
 *
 * @param {{ pandocUrl: string, csrfToken?: string }} config
 * @returns {import("@pretextbook/import/react").ImportEngine}
 */
function buildPandocEngine({ pandocUrl, csrfToken }) {
  const engine = createRemotePandocEngine({
    url: pandocUrl,
    credentials: "same-origin",
    headers: { "X-CSRF-Token": csrfToken },
    // Both of these render on the review step's override — "Convert with
    // Pandoc instead", with the description beneath — rather than in a menu of
    // converters chosen up front. So the label is the converter's name and
    // nothing more, and the description answers the only question actually on
    // offer there: this file already converted, would the other reader do
    // better? The package's own default answers a different one ("Convert Word,
    // OpenOffice, EPUB…"), which is upload-step copy, and its "no local install
    // needed" is aimed at the VS Code extension.
    label: "Pandoc",
    description:
      "A different parser for this file. Sometimes preserves markup the " +
      "built-in converter drops, such as raw TeX.",
  });

  return {
    ...engine,
    // Same split rule as the built-in engine, reached differently.
    // `importSplitToSubsections` can afford to convert twice because its second
    // pass is local; here the conversion is a file upload and up to 25s of
    // server time, so the article pass re-derives the layout from the result
    // already in hand (`relayoutImport` is pure and re-splits the same
    // converted source) rather than sending the document again.
    convertFile: async (file, options) => {
      const asBook = await engine.convertFile(file, {
        ...options,
        splitLevel: SPLIT_LEVEL.book,
      });
      if ("pretextError" in asBook || asBook.documentKind === "book") {
        return asBook;
      }
      if (asBook.documentKind === "slideshow") {
        return relayoutImport(asBook, SPLIT_LEVEL.slideshow);
      }
      return relayoutImport(asBook, SPLIT_LEVEL.article);
    },
  };
}

/**
 * Every converter this deployment can offer, in precedence order: the built-in
 * one owns the formats both read (`.tex`, `.md`), since it cleans the source,
 * unpacks archives, and is the only one that can keep the original as LaTeX.
 *
 * Pandoc is listed only when the host wired a proxy URL. Without one it has
 * nothing to convert against, and an engine that always fails is worse than one
 * that was never there: it would widen the file picker's accept list to formats
 * this deployment cannot actually import.
 *
 * @param {{ pandocUrl?: string, csrfToken?: string }} config
 * @returns {import("@pretextbook/import/react").ImportEngine[]}
 */
export function buildImportEngines({ pandocUrl, csrfToken }) {
  return pandocUrl
    ? [builtinEngine, buildPandocEngine({ pandocUrl, csrfToken })]
    : [builtinEngine];
}
