import React, { useCallback } from "react";
import ReactDOM from "react-dom/client";
import { ImportWizard } from "@pretextbook/import/react";
import {
  analyzeImportSources,
  extractUpload,
  importProjectFromFiles,
  projectForImportMode,
  serializeProjectToPlusPayload,
} from "@pretextbook/import";
import "@pretextbook/import/react.css";

/** @typedef {import("@pretextbook/import").ImportedProjectSuccess} ImportedProjectSuccess */
/** @typedef {import("@pretextbook/import").ImportedProjectResult} ImportedProjectResult */
/** @typedef {import("@pretextbook/import").ImportProjectOptions} ImportProjectOptions */
/** @typedef {import("@pretextbook/import").ImportMode} ImportMode */
/** @typedef {import("@pretextbook/import/react").PreparedUpload} PreparedUpload */

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
 */
const SPLIT_LEVEL = { book: 3, article: 2 };

/**
 * Convert an already-unpacked upload, splitting to subsection depth whatever
 * the document turns out to be.
 *
 * The kind is not knowable up front — `detectDocumentKind` reads *PreTeXt*
 * source, so a raw LaTeX or Markdown upload only classifies itself once
 * converted — so this converts at the book depth and repeats at the article
 * depth if that is what came back. The second pass only ever runs for
 * articles, which are the cheap case by definition; a book, the expensive one,
 * is right on the first try.
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

  return importProjectFromFiles(files, {
    ...options,
    splitLevel: SPLIT_LEVEL.article,
  });
}

/**
 * The wizard's converter, replacing its built-in one so the split depth is
 * ours rather than the checkbox's.
 *
 * `prepare`/`convertPrepared` mirror the built-in engine exactly apart from
 * that; `convertFile` is required by the interface but unreachable, since the
 * wizard prefers the two-phase pair whenever an engine supplies it.
 *
 * @type {import("@pretextbook/import/react").ImportEngine}
 */
const importEngine = {
  id: "pretext-plus",
  label: "Built-in converter",
  description: "Create a new project starting with LaTeX, Markdown, or PreTeXt files.",
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
 * Fixed options, which also suppress the wizard's own document-kind and
 * "split sections into separate files" controls — the split depth is settled
 * above, and the kind is detected from the source, which it does more reliably
 * than a reader picking from a dropdown before seeing the document.
 *
 * `splitLevel` is deliberately absent: `importEngine` overrides it per pass,
 * and a value here would only be shadowed.
 *
 * @type {ImportProjectOptions}
 */
const IMPORT_OPTIONS = {};

/**
 * @typedef {Object} ImportConfig
 * @property {string} createUrl - POST target that creates the project (projects#create_from_import).
 * @property {string} [csrfToken]
 */

/**
 * @param {{ config: ImportConfig }} props
 * @returns {JSX.Element}
 */
function ImportApp({ config }) {
  const { createUrl, csrfToken } = config;

  // `defaultImportMode` opens the review step on "Keep as LaTeX" (or Markdown)
  // rather than the wizard's own "Convert to PreTeXt" default: plus edits those
  // sources natively, so the less destructive choice is to keep what was
  // uploaded and let the reader opt into the conversion, not the other way
  // round. The chooser is still shown — this sets which radio starts selected.
  //
  // A PreTeXt upload has no native alternative, and the wizard resolves that
  // itself: it hides the chooser and hands `onConfirm` "converted" regardless of
  // this preference.
  //
  // projectForImportMode picks the division pool matching the user's choice at
  // the review step: the native LaTeX/Markdown pool when they keep the source
  // format, the converted PreTeXt pool otherwise (and for PreTeXt input, which
  // has no native projection).
  //
  // serializeProjectToPlusPayload then emits the Rails shape directly --
  // snake_case keys matching ProjectsController's permitted
  // `divisions_attributes` / `assets_attributes`, with asset bytes
  // base64-encoded -- so the payload goes straight over the same JSON API the
  // editor uses, with nothing to map here.
  const onConfirm = useCallback(
    /**
     * @param {ImportedProjectSuccess} result
     * @param {ImportMode} mode
     */
    async (result, mode) => {
      try {
        const payload = serializeProjectToPlusPayload(projectForImportMode(result, mode));
        const res = await fetch(createUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({ project: payload }),
        });
        if (!res.ok) {
          let message = `Import failed: ${res.status}`;
          try {
            const err = await res.json();
            message = err.errors?.join(", ") || err.error || message;
          } catch {
            /* non-JSON error body */
          }
          throw new Error(message);
        }
        const { project_url } = await res.json();
        window.location.href = project_url;
      } catch (error) {
        console.error("Error importing project:", error);
        alert(`Failed to import project:\n${error.message}`);
      }
    },
    [createUrl, csrfToken],
  );

  return (
    <ImportWizard
      onConfirm={onConfirm}
      importOptions={IMPORT_OPTIONS}
      defaultImportMode="native"
      engines={[importEngine]}
    />
  );
}

// --- Imperative mount/unmount interface used by the Stimulus controller ----

/** @type {import("react-dom/client").Root|null} */
let root = null;

/**
 * @param {Element} node
 * @param {ImportConfig} config
 * @returns {void}
 */
function render(node, config) {
  root = ReactDOM.createRoot(node);
  root.render(<ImportApp config={config} />);
}

/** @returns {void} */
function destroy() {
  root?.unmount();
  root = null;
}

export { destroy, render };
