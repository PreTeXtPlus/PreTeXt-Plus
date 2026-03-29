import React, { useState, useCallback } from 'react';
import ReactDOM from "react-dom/client";
import { Editors } from '@pretextbook/web-editor';
import '@pretextbook/web-editor/dist/web-editor.css';

let root = null;

function EditorWrapper({ onContentChange, onTitleChange, ...rest }) {
  const [content, setContent] = useState(rest.content);
  const [title, setTitle] = useState(rest.title);
  const [sourceFormat, setSourceFormat] = useState(rest.sourceFormat);
  const [pretextContent, setPretextContent] = useState(rest.pretextContent);

  const handleContentChange = useCallback((v, meta) => {
    setContent(v);
    if (meta?.sourceFormat) setSourceFormat(meta.sourceFormat);
    if (meta?.pretextContent) setPretextContent(meta.pretextContent);
    onContentChange?.(v, meta);
  }, [onContentChange]);

  const handleTitleChange = useCallback((v) => {
    setTitle(v);
    onTitleChange?.(v);
  }, [onTitleChange]);

  return (
    <Editors
      {...rest}
      content={content}
      title={title}
      sourceFormat={sourceFormat}
      pretextContent={pretextContent}
      onContentChange={handleContentChange}
      onTitleChange={handleTitleChange}
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
