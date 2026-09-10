import React, { useCallback, useMemo } from "react";
import ReactDOM from "react-dom/client";
import { ImportWizard } from "@pretextbook/import/react";
import {
  projectForImportMode,
  serializeProjectToPlusPayload,
} from "@pretextbook/import";
import { buildImportEngines } from "./importEngines";
import "@pretextbook/import/react.css";

/** @typedef {import("@pretextbook/import").ImportedProjectSuccess} ImportedProjectSuccess */
/** @typedef {import("@pretextbook/import").ImportMode} ImportMode */

/**
 * Fixed options, which also suppress the wizard's own document-kind and
 * "split sections into separate files" controls — the split depth is settled by
 * the engines (see `importEngines.js`), and the kind is detected from the
 * source, which it does more reliably than a reader picking from a dropdown
 * before seeing the document.
 *
 * `splitLevel` is deliberately absent: the engines override it per pass, and a
 * value here would only be shadowed.
 *
 * @type {import("@pretextbook/import").ImportProjectOptions}
 */
const IMPORT_OPTIONS = {};

/**
 * @typedef {Object} ImportConfig
 * @property {string} createUrl - POST target that creates the project (projects#create_from_import).
 * @property {string} pandocUrl - POST target that proxies pandoc conversions (projects#pandoc).
 * @property {string} [csrfToken]
 */

/**
 * @param {{ config: ImportConfig }} props
 * @returns {JSX.Element}
 */
function ImportApp({ config }) {
  const { createUrl, csrfToken } = config;

  // Shared with the editor's Tools → Import…, so both read the same formats —
  // see `importEngines.js`.
  const engines = useMemo(() => buildImportEngines(config), [config]);

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
      engines={engines}
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
