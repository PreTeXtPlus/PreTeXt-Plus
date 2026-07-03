import React, { useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import { Editors } from "@pretextbook/web-editor";
import "@pretextbook/web-editor/dist/web-editor.css";

const PRETEXT_ROOT_TAG = /^\s*<(article|book|slideshow)[\s>]/;

function pretextRootType(content) {
  const match = PRETEXT_ROOT_TAG.exec(content ?? "");
  return match ? match[1] : undefined;
}

function railsDivisionToEditor(d) {
  const base = {
    id: String(d.id ?? d.ref),
    xmlId: d.ref ?? "",
    content: d.source ?? "",
    sourceFormat: d.source_format ?? "pretext",
  };
  if (!d.is_root) return base;
  if (d.source_format !== "pretext") return { ...base, type: "article" };
  const type = pretextRootType(base.content);
  return type ? { ...base, type } : base;
}

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
    />
  );
}

let root = null;

function render(node, config) {
  root = ReactDOM.createRoot(node);
  root.render(<TryItApp config={config} />);
}

function destroy() {
  root?.unmount();
  root = null;
}

export { destroy, render };
