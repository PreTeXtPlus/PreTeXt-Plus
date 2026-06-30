import React, { useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import { Editors } from "@pretextbook/web-editor";
import "@pretextbook/web-editor/dist/web-editor.css";

const PRETEXT_ROOT_TAG = /^\s*<(article|book|slideshow)[\s>]/;

function pretextRootType(content) {
  const match = PRETEXT_ROOT_TAG.exec(content ?? "");
  return match ? match[1] : undefined;
}

function TryItApp({ config }) {
  const { content, title, docinfo, sourceFormat, csrfToken } = config;

  const TRYIT_XML_ID = "tryit";

  const rootDivision = {
    id: "tryit-root",
    xmlId: TRYIT_XML_ID,
    content: content ?? "",
    sourceFormat: sourceFormat ?? "pretext",
  };
  if (sourceFormat !== "pretext") {
    rootDivision.type = "article";
    rootDivision.title = title;
  } else {
    const type = pretextRootType(content);
    if (type) rootDivision.type = type;
  }

  const initial = useRef({
    title: title ?? "",
    docinfo: docinfo ?? "",
    commonDocinfo: "",
    useCommonDocinfo: false,
    projectType: "article",
    divisions: [rootDivision],
    rootDivisionId: TRYIT_XML_ID,
  });

  const working = useRef({
    title: title ?? "",
    content: content ?? "",
    sourceFormat: sourceFormat ?? "pretext",
    docinfo: docinfo ?? "",
  });

  const onContentChange = useCallback((change) => {
    const w = working.current;
    if (change.sourceContent !== undefined) w.content = change.sourceContent;
    if (change.sourceFormat !== undefined) w.sourceFormat = change.sourceFormat;
    if (change.docinfo !== undefined) w.docinfo = change.docinfo;
  }, []);

  const onTitleChange = useCallback((value) => {
    working.current.title = value ?? "";
  }, []);

  const onPreviewRebuild = useCallback((source, title, postToIframe) => {
    postToIframe("/projects/preview", { source, title, authenticity_token: csrfToken });
  }, [csrfToken]);

  // Division add must return an id; use a local uuid since there's no backend.
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
      onContentChange={onContentChange}
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
      onTitleChange={onTitleChange}
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
