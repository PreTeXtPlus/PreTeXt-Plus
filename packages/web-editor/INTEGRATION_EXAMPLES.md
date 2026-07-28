# Integration Examples

This file shows how to integrate the `@pretextbook/web-editor` package in different setups.

## React + TypeScript (Recommended)

```tsx
import React, { useState } from "react";
import { Editors, editorProps } from "@pretextbook/web-editor";
import "@pretextbook/web-editor/dist/web-editor.css";

interface DocumentState {
  source: string;
  title: string;
  isDirty: boolean;
}

export default function Editor() {
  const [doc, setDoc] = useState<DocumentState>({
    source: "<document></document>",
    title: "New PreTeXt Document",
    isDirty: false,
  });

  const handleContentChange = (source: string | undefined) => {
    setDoc((prev) => ({
      ...prev,
      source: source || "",
      isDirty: true,
    }));
  };

  const handleTitleChange = (title: string) => {
    setDoc((prev) => ({
      ...prev,
      title,
      isDirty: true,
    }));
  };

  const handleSave = async () => {
    // Send to backend
    const response = await fetch("/api/document/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: doc.title,
        source: doc.source,
      }),
    });

    if (response.ok) {
      setDoc((prev) => ({ ...prev, isDirty: false }));
      alert("Document saved!");
    }
  };

  const editorProps: editorProps = {
    source: doc.source,
    onContentChange: handleContentChange,
    title: doc.title,
    onTitleChange: handleTitleChange,
    onSaveButton: handleSave,
    saveButtonLabel: doc.isDirty ? "Save*" : "Save",
    onCancelButton: () => window.history.back(),
    cancelButtonLabel: "Cancel",
  };

  return (
    <div className="editor-container">
      <Editors {...editorProps} />
    </div>
  );
}
```

## Next.js Integration

```tsx
// app/editor/page.tsx
"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import "@pretextbook/web-editor/dist/web-editor.css";

const Editors = dynamic(
  () => import("@pretextbook/web-editor").then((mod) => mod.Editors),
  { ssr: false },
);

export default function EditorPage() {
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("Document");

  return (
    <main>
      <Editors
        source={source}
        onContentChange={setSource}
        title={title}
        onTitleChange={setTitle}
      />
    </main>
  );
}
```

## Vite React App

```tsx
// src/App.tsx
import { useState } from "react";
import { Editors } from "@pretextbook/web-editor";
import "@pretextbook/web-editor/dist/web-editor.css";
import "./App.css";

function App() {
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("My Document");

  return (
    <div className="app">
      <Editors
        source={source}
        onContentChange={setSource}
        title={title}
        onTitleChange={setTitle}
      />
    </div>
  );
}

export default App;
```

## Create React App

```tsx
// src/App.jsx
import { useState } from "react";
import { Editors } from "@pretextbook/web-editor";
import "@pretextbook/web-editor/dist/web-editor.css";
import "./App.css";

function App() {
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("My Document");

  return (
    <div className="App">
      <Editors
        source={source}
        onContentChange={setSource}
        title={title}
        onTitleChange={setTitle}
      />
    </div>
  );
}

export default App;
```

## HTML + React (UMD Build)

```html
<!DOCTYPE html>
<html>
  <head>
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/@pretextbook/web-editor@0.0.1/dist/web-editor.css"
    />
  </head>
  <body>
    <div id="root"></div>

    <script
      crossorigin
      src="https://unpkg.com/react@19/umd/react.production.min.js"
    ></script>
    <script
      crossorigin
      src="https://unpkg.com/react-dom@19/umd/react-dom.production.min.js"
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@pretextbook/web-editor@0.0.1/dist/index.js"></script>

    <script>
      const { useState } = React;
      const { Editors } = window.PretextWebEditor;

      function App() {
        const [source, setSource] = useState("");
        const [title, setTitle] = useState("My Document");

        return React.createElement(Editors, {
          source,
          onContentChange: setSource,
          title,
          onTitleChange: setTitle,
        });
      }

      const root = ReactDOM.createRoot(document.getElementById("root"));
      root.render(React.createElement(App));
    </script>
  </body>
</html>
```

## With Tailwind CSS

**Note:** This package already includes all Tailwind styles bundled in the CSS file. You do **NOT** need to install Tailwind CSS in your project. The example below shows how the editor works alongside your own Tailwind setup:

```tsx
// No need for: import '@tailwindcss/vite';
import { Editors } from "@pretextbook/web-editor";
import "@pretextbook/web-editor/dist/web-editor.css";

export default function Editor() {
  return (
    // You can use YOUR Tailwind classes here
    <div className="h-screen w-full flex flex-col">
      {/* The editor's buttons and styling work automatically */}
      <Editors source="" onContentChange={() => {}} title="My Document" />
    </div>
  );
}
```

## With Redux/State Management

```tsx
import { useDispatch, useSelector } from "react-redux";
import { Editors } from "@pretextbook/web-editor";
import "@pretextbook/web-editor/dist/web-editor.css";
import { updateContent, updateTitle } from "./store/documentSlice";

export default function Editor() {
  const dispatch = useDispatch();
  const { source, title } = useSelector((state) => state.document);

  return (
    <Editors
      source={source}
      onContentChange={(newSource) => {
        dispatch(updateContent(newSource));
      }}
      title={title}
      onTitleChange={(newTitle) => {
        dispatch(updateTitle(newTitle));
      }}
    />
  );
}
```

## Styling Customization

To customize the editor's appearance:

```css
/* Override editor styles */
.ProseMirror {
  font-family: "Fira Code", monospace;
  font-size: 14px;
}

.p-splitter {
  height: 80vh !important;
}
```

## Common Patterns

### Autosave

```tsx
useEffect(() => {
  const timer = setTimeout(() => {
    if (isDirty) {
      saveContent();
    }
  }, 2000);

  return () => clearTimeout(timer);
}, [source, isDirty]);
```

### Load Document by ID

```tsx
useEffect(() => {
  fetch(`/api/documents/${id}`)
    .then((res) => res.json())
    .then((data) => {
      setSource(data.source);
      setTitle(data.title);
    });
}, [id]);
```
