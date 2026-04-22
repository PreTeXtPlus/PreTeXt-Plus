import React, { useState, useCallback } from 'react';
import ReactDOM from "react-dom/client";
import { Editors } from '@pretextbook/web-editor';
import '@pretextbook/web-editor/dist/web-editor.css';

let root = null;

function EditorWrapper({ onContentChange, onTitleChange, onCreatePretextProjectCopy, onFeedbackSubmit, ...rest }) {
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
    if (meta?.sourceFormat !== undefined) setSourceFormat(meta.sourceFormat);
    if (meta?.pretextSource !== undefined) setPretextSource(meta.pretextSource);
    // docinfo changes arrive via meta when DocinfoEditor saves inside Editors
    if (meta?.docinfo !== undefined) setDocinfo(meta.docinfo);
    onContentChange?.(nextSource, meta);
  }, [onContentChange]);

  const handleTitleChange = useCallback((v) => {
    setTitle(v);
    onTitleChange?.(v);
  }, [onTitleChange]);

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
      onCreatePretextProjectCopy={onCreatePretextProjectCopy}
      onFeedbackSubmit={onFeedbackSubmit}
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
