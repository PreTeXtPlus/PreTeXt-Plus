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
    commonDocinfo: commonDocinfoProp,
    useCommonDocinfo: useCommonDocinfoProp,
    onCommonDocinfoChange,
    onUseCommonDocinfoChange,
    ...editorProps
  } = rest;

  const [source, setSource] = useState(sourceProp ?? "");
  const [title, setTitle] = useState(titleProp);
  const [sourceFormat, setSourceFormat] = useState(sourceFormatProp);
  const [pretextSource, setPretextSource] = useState(pretextSourceProp);
  const [docinfo, setDocinfo] = useState(docinfoProp);
  const [commonDocinfo, setCommonDocinfo] = useState(commonDocinfoProp ?? "");
  const [useCommonDocinfo, setUseCommonDocinfo] = useState(useCommonDocinfoProp ?? false);

  const handleContentChange = useCallback((v, meta) => {
    const nextSource = v ?? meta?.sourceContent ?? "";
    setSource(nextSource);
    if (meta?.sourceFormat !== undefined) setSourceFormat(meta.sourceFormat);
    if (meta?.pretextSource !== undefined) setPretextSource(meta.pretextSource);
    // docinfo changes arrive via meta when DocinfoEditor saves inside Editors
    if (meta?.docinfo !== undefined) setDocinfo(meta.docinfo);
    if (meta?.commonDocinfo !== undefined) setCommonDocinfo(meta.commonDocinfo);
    if (meta?.useCommonDocinfo !== undefined) setUseCommonDocinfo(meta.useCommonDocinfo);
    onContentChange?.(nextSource, meta);
  }, [onContentChange]);

  const handleTitleChange = useCallback((v) => {
    setTitle(v);
    onTitleChange?.(v);
  }, [onTitleChange]);

  const handleCommonDocinfoChange = useCallback((value) => {
    const nextValue = value ?? "";
    setCommonDocinfo(nextValue);
    onCommonDocinfoChange?.(nextValue);
  }, [onCommonDocinfoChange]);

  const handleUseCommonDocinfoChange = useCallback((value) => {
    const nextValue = value === true;
    setUseCommonDocinfo(nextValue);
    onUseCommonDocinfoChange?.(nextValue);
  }, [onUseCommonDocinfoChange]);

  return (
    <Editors
      {...editorProps}
      source={source}
      title={title}
      sourceFormat={sourceFormat}
      pretextSource={pretextSource}
      docinfo={docinfo}
      commonDocinfo={commonDocinfo}
      useCommonDocinfo={useCommonDocinfo}
      onContentChange={handleContentChange}
      onTitleChange={handleTitleChange}
      onCommonDocinfoChange={handleCommonDocinfoChange}
      onUseCommonDocinfoChange={handleUseCommonDocinfoChange}
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
