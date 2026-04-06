import React, { useState, useCallback } from 'react';
import ReactDOM from "react-dom/client";
import { Editors } from '@pretextbook/web-editor';
import '@pretextbook/web-editor/dist/web-editor.css';

let root = null;

function EditorWrapper({ onContentChange, onTitleChange, onDocinfoChange, ...rest }) {
  const {
    source: sourceProp,
    title: titleProp,
    sourceFormat: sourceFormatProp,
    pretextSource: pretextSourceProp,
    docinfo: docinfoProp,
    ...editorProps
  } = rest;

  const [source, setSource] = useState(sourceProp ?? "");
  const [title, setTitle] = useState(titleProp);
  const [sourceFormat, setSourceFormat] = useState(sourceFormatProp);
  const [pretextSource, setPretextSource] = useState(pretextSourceProp);
  const [docinfo, setDocinfo] = useState(docinfoProp);

  const handleContentChange = useCallback((v, meta) => {
    const nextSource = v ?? meta?.sourceContent ?? "";
    setSource(nextSource);
    if (meta?.sourceFormat) setSourceFormat(meta.sourceFormat);
    if (meta?.pretextSource) setPretextSource(meta.pretextSource);
    onContentChange?.(nextSource, meta);
  }, [onContentChange]);

  const handleTitleChange = useCallback((v) => {
    setTitle(v);
    onTitleChange?.(v);
  }, [onTitleChange]);

  const handleDocinfoChange = useCallback((v) => {
    const next = v ?? "";
    setDocinfo(next);
    onDocinfoChange?.(next);
  }, [onDocinfoChange]);

  return (
    <Editors
      {...editorProps}
      source={source}
      title={title}
      sourceFormat={sourceFormat}
      pretextSource={pretextSource}
      docinfo={docinfo}
      onContentChange={handleContentChange}
      onTitleChange={handleTitleChange}
      onDocinfoChange={handleDocinfoChange}
    />
  );
}

function render(node, props) {
  root = ReactDOM.createRoot(node);
  root.render(<EditorWrapper {...props} />);
}

function destroy() {
  root.unmount();
}

export { destroy, render };
