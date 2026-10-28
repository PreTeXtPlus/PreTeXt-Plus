import React, { useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import { Editors } from "@pretextbook/web-editor";
import AccountArea from "./AccountArea";
import { railsDivisionToEditor } from "./railsProjectMapping";
import { buildHelpMenu } from "./helpEntries";
import { TOOLS_ENTRIES } from "./toolsEntries";

/** @typedef {import("./railsProjectMapping").RailsDivision} RailsDivision */

/**
 * @typedef {Object} TryItConfig
 * @property {{title?: string, docinfo?: string, divisions?: RailsDivision[]}} project
 * @property {string} [csrfToken]
 * @property {string} [rootPath]
 * @property {string} [newUserPath]
 * @property {string} [newSessionPath]
 * @property {string} [previewWorkerUrl] - See EditorConfig in ./editor.jsx.
 */

/**
 * @param {{ config: TryItConfig }} props
 * @returns {JSX.Element}
 */
function TryItApp({ config }) {
  const { project, csrfToken, rootPath, newUserPath, newSessionPath } = config;

  const editorDivisions = (project.divisions ?? []).map((d) => ({
    ...railsDivisionToEditor(d),
    // Try-it divisions are never saved, so they have no record id of their own.
    id: String(d.id ?? d.ref),
  }));
  const rootRef = (project.divisions ?? []).find((d) => d.is_root)?.ref ?? editorDivisions[0]?.xmlId ?? "";

  const initial = useRef({
    title: project.title ?? "",
    docinfo: project.docinfo ?? "",
    commonDocinfo: "",
    useCommonDocinfo: false,
    projectType: "article",
    divisions: editorDivisions,
    rootDivisionId: rootRef,
  });

  const onPreviewRebuild = useCallback((source, title, postToIframe) => {
    postToIframe("/tryit/preview", { source, title, authenticity_token: csrfToken });
  }, [csrfToken]);

  const onDivisionAdd = useCallback(async () => crypto.randomUUID(), []);

  const noop = useCallback(() => {}, []);
  const noopAsync = useCallback(async () => {}, []);

  const logo = (
    <a href={rootPath} className="flex items-center">
      <img src="/icon.svg" className="h-14" alt="PreTeXtPlus Logo" />
    </a>
  );

  const state = initial.current;
  return (
    <Editors
      title={state.title}
      docinfo={state.docinfo}
      commonDocinfo={state.commonDocinfo}
      useCommonDocinfo={state.useCommonDocinfo}
      projectType={state.projectType}
      divisions={state.divisions}
      rootDivisionId={state.rootDivisionId}
      projectAssets={[]}
      libraryAssets={[]}
      onContentChange={noop}
      onDivisionAdd={onDivisionAdd}
      onDivisionRemove={noop}
      onDivisionUpdate={noop}
      onAssetInsert={noop}
      onAssetAddFromLibrary={noopAsync}
      onAssetUpload={noopAsync}
      onAssetFetchUrl={noopAsync}
      onCreateAuthored={noopAsync}
      onAssetUpdate={noopAsync}
      onAssetRemove={noop}
      onLoadAssets={async () => []}
      onLoadLibraryAssets={async () => []}
      onTitleChange={noop}
      onUseCommonDocinfoChange={noop}
      onCommonDocinfoChange={noop}
      onSave={noop}
      onPreviewRebuild={onPreviewRebuild}
      previewWorkerUrl={config.previewWorkerUrl}
      onCreatePretextProjectCopy={noopAsync}
      onFeedbackSubmit={noopAsync}
      hideAssets={true}
      topBar={{
        logo,
        accountArea: (
          <AccountArea
            signedIn={false}
            newUserPath={newUserPath}
            newSessionPath={newSessionPath}
          />
        ),
        helpMenu: () => buildHelpMenu(),
        toolsEntries: TOOLS_ENTRIES,
        titleOverride: "Try PreTeXt in Your Browser!",
      }}
    />
  );
}

/** @type {import("react-dom/client").Root|null} */
let root = null;

/**
 * @param {Element} node - Mount point provided by the Stimulus controller.
 * @param {TryItConfig} config
 * @returns {void}
 */
function render(node, config) {
  root = ReactDOM.createRoot(node);
  root.render(<TryItApp config={config} />);
}

/** @returns {void} */
function destroy() {
  root?.unmount();
  root = null;
}

export { destroy, render };
