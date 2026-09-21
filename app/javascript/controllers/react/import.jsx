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
  //
  // No `importOptions`: passing any, even `{}`, hides the wizard's "Document
  // kind" dropdown, and that is the only way to import as a slideshow a source
  // that does not announce itself as one (Markdown without `division:
  // slideshow` frontmatter, chiefly). Left on "Auto detect" it detects, as
  // before. The choice reaches the engines as `options.documentKind`.
  //
  // It unhides the review step's "Split into files" control too, which is the
  // price: that control re-splits the converted result, so a reader can still
  // land on a depth shallower than `importEngines.js` would pick. The engines
  // set the default they arrive at, which is the one that matters.
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
