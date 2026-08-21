import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Editors } from "@pretextbook/web-editor";
import {
  railsDivisionToEditor,
  railsAssetToEditor,
  railsSnippetToEditor,
} from "./railsProjectMapping";

/** @typedef {import("./railsProjectMapping").RailsDivision} RailsDivision */
/** @typedef {import("./railsProjectMapping").RailsAsset} RailsAsset */
/** @typedef {import("./railsProjectMapping").RailsSnippet} RailsSnippet */

/**
 * The full project JSON returned by the `source.json` endpoint -- same shape
 * as the editor-state endpoint (see ./editor.jsx), read-only here.
 * @typedef {Object} RailsProjectJson
 * @property {string} [title]
 * @property {string} [docinfo]
 * @property {string} [common_docinfo]
 * @property {boolean} [use_common_docinfo]
 * @property {string} [document_type]
 * @property {string} [language]
 * @property {RailsDivision[]} [divisions]
 * @property {RailsAsset[]} [assets]
 * @property {RailsSnippet[]} [snippets]
 */

// This host never saves anything, so unlike ./editor.jsx there's no working
// copy / server snapshot split, no collaboration, and no autosave -- just a
// one-time transform of the loaded JSON into <Editors>'s prop shape.
/**
 * @param {RailsProjectJson} json
 */
function railsToReadOnlyState(json) {
  const root = (json.divisions ?? []).find((d) => d.is_root);
  const title = json.title ?? "";
  const projectType = json.document_type === "book" ? "book" : "article";
  const rootMeta = { type: projectType, title };
  return {
    title,
    docinfo: json.docinfo ?? "",
    commonDocinfo: json.common_docinfo ?? "",
    useCommonDocinfo: json.use_common_docinfo ?? false,
    language: json.language,
    projectType,
    divisions: (json.divisions ?? []).map((d) => railsDivisionToEditor(d, rootMeta)),
    projectAssets: (json.assets ?? []).map(railsAssetToEditor),
    projectSnippets: (json.snippets ?? []).map(railsSnippetToEditor),
    rootDivisionId: root ? (root.ref ?? "") : undefined,
  };
}

/**
 * @typedef {Object} SharedSourceConfig
 * @property {string} projectId
 * @property {string} sourceUrl - The `source.json` endpoint URL.
 */

/**
 * @param {{ config: SharedSourceConfig }} props
 * @returns {JSX.Element}
 */
function SharedSourceApp({ config }) {
  const { projectId, sourceUrl } = config;

  const query = useQuery({
    queryKey: ["shared-source", projectId],
    queryFn: async () => {
      const res = await fetch(sourceUrl, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
      return railsToReadOnlyState(await res.json());
    },
  });

  if (query.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="mx-5 text-center">Loading…</div>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="mx-5 text-center">Error loading document. Please reload the page.</div>
      </div>
    );
  }

  const state = query.data;
  return (
    <Editors
      readOnly
      title={state.title}
      docinfo={state.docinfo}
      commonDocinfo={state.commonDocinfo}
      useCommonDocinfo={state.useCommonDocinfo}
      language={state.language}
      projectType={state.projectType}
      divisions={state.divisions}
      rootDivisionId={state.rootDivisionId}
      projectAssets={state.projectAssets}
      hideAssets
      projectSnippets={state.projectSnippets}
      hideSnippets
      onContentChange={() => {}}
    />
  );
}

// --- Imperative mount/unmount interface used by the Stimulus controller ----

/** @type {import("react-dom/client").Root|null} */
let root = null;

/**
 * @param {Element} node - Mount point provided by the Stimulus controller.
 * @param {SharedSourceConfig} config
 * @returns {void}
 */
function render(node, config) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
  });
  root = ReactDOM.createRoot(node);
  root.render(
    <QueryClientProvider client={queryClient}>
      <SharedSourceApp config={config} />
    </QueryClientProvider>,
  );
}

/** @returns {void} */
function destroy() {
  root?.unmount();
  root = null;
}

export { destroy, render };
