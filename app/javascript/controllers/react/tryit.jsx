import React, { useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import { Editors } from "@pretextbook/web-editor";
import "@pretextbook/web-editor/dist/web-editor.css";

/**
 * @typedef {Object} RailsDivision
 * @property {string|number} [id]
 * @property {string} [ref]
 * @property {string} [source]
 * @property {string} [source_format]
 * @property {boolean} [is_root]
 */

/**
 * @typedef {Object} EditorDivision
 * @property {string} id
 * @property {string} xmlId
 * @property {string} source
 * @property {string} sourceFormat
 * @property {string} [type]
 */

const PRETEXT_ROOT_TAG = /^\s*<(article|book|slideshow)[\s>]/;

/**
 * @param {string|undefined} source
 * @returns {string|undefined} The root element tag name ("article"|"book"|"slideshow"), or undefined.
 */
function pretextRootType(source) {
  const match = PRETEXT_ROOT_TAG.exec(source ?? "");
  return match ? match[1] : undefined;
}

/**
 * @param {RailsDivision} d
 * @returns {EditorDivision}
 */
function railsDivisionToEditor(d) {
  const base = {
    id: String(d.id ?? d.ref),
    xmlId: d.ref ?? "",
    source: d.source ?? "",
    sourceFormat: d.source_format ?? "pretext",
  };
  if (!d.is_root) return base;
  if (d.source_format !== "pretext") return { ...base, type: "article" };
  const type = pretextRootType(base.source);
  return type ? { ...base, type } : base;
}

/**
 * @typedef {Object} TryItConfig
 * @property {{title?: string, docinfo?: string, divisions?: RailsDivision[]}} project
 * @property {string} [csrfToken]
 */

/**
 * @param {{ config: TryItConfig }} props
 * @returns {JSX.Element}
 */
function TryItApp({ config }) {
  const { project, csrfToken } = config;

  const editorDivisions = (project.divisions ?? []).map(railsDivisionToEditor);
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
      onSaveButton={noop}
      onCancelButton={noop}
      onPreviewRebuild={onPreviewRebuild}
      onCreatePretextProjectCopy={noopAsync}
      onFeedbackSubmit={noopAsync}
      hideAssets={true}
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
