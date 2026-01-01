import React, { useState } from 'react';
import ReactDOM from "react-dom/client";
import { Editors } from '@pretextbook/web-editor';
import '@pretextbook/web-editor/dist/web-editor.css';

function App() {
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('My Document');

  return (
    <Editors
      content={content}
      onContentChange={setContent}
      title={title}
      onTitleChange={setTitle}
      onSaveButton={() => console.log('Save clicked')}
      saveButtonLabel="Save"
      onCancelButton={() => console.log('Cancel clicked')}
      cancelButtonLabel="Cancel"
    />
  );
}

const root = ReactDOM.createRoot(
  document.getElementById("root")
);

root.render(<App />);
