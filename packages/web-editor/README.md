# PreTeXt Plus Editor

An in-browser editor for PreTeXt documents with visual and code editing modes.

## Installation

```bash
npm install @pretextbook/web-editor
```

## Usage

### Basic Setup

```tsx
import React, { useState } from "react";
import {
  Editors,
  type FeedbackSubmission,
  type PretextProjectCopyRequest,
} from "@pretextbook/web-editor";
import "@pretextbook/web-editor/dist/web-editor.css";

function App() {
  const [source, setSource] = useState("");
  const [sourceFormat, setSourceFormat] = useState<"pretext" | "latex">(
    "pretext",
  );
  const [title, setTitle] = useState("My Document");

  const handleFeedbackSubmit = async (feedback: FeedbackSubmission) => {
    await fetch("/api/editor-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feedback),
    });
  };

  const handleCreatePretextProjectCopy = async (
    request: PretextProjectCopyRequest,
  ) => {
    await fetch("/api/projects/create_pretext_copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  };

  return (
    <Editors
      source={source}
      sourceFormat={sourceFormat}
      onContentChange={(value, meta) => {
        setSource(value || "");
        setSourceFormat(meta?.sourceFormat || "pretext");
      }}
      title={title}
      onTitleChange={setTitle}
      onSaveButton={() => console.log("Save clicked")}
      saveButtonLabel="Save"
      onCancelButton={() => console.log("Cancel clicked")}
      cancelButtonLabel="Cancel"
      projectUrl={window.location.href}
      onFeedbackSubmit={handleFeedbackSubmit}
      onCreatePretextProjectCopy={handleCreatePretextProjectCopy}
    />
  );
}

export default App;
```

### Styling

**Important:** This package uses Tailwind CSS internally, but **all styles are pre-compiled and bundled** in the CSS file. You don't need to install or configure Tailwind CSS in your project.

Simply import the CSS file:

```tsx
import "@pretextbook/web-editor/dist/web-editor.css";
```

Or in your CSS file:

```css
@import "@pretextbook/web-editor/dist/web-editor.css";
```

All button styles, layout, and MenuBar styling will work automatically without any additional setup.

```css
@import "@pretextbook/web-editor/dist/web-editor.css";
```

## Props

The `Editors` component accepts the following props:

```tsx
type SourceFormat = "pretext" | "latex";

interface FeedbackSubmission {
  context: string;
  email?: string;
  message: string;
  includeCurrentSource: boolean;
  currentSource?: string;
  projectUrl?: string;
  sourceFormat?: SourceFormat;
  title?: string;
  submittedAt: string;
}

interface PretextProjectCopyRequest {
  pretextSource: string;
  title: string;
  projectUrl?: string;
}

interface EditorContentChange {
  source: string;
  sourceFormat: SourceFormat;
  pretextSource?: string;
  pretextError?: string;
  docinfo?: string;
  commonDocinfo?: string;
  useCommonDocinfo?: boolean;
}

interface editorProps {
  source: string; // The canonical source content
  sourceFormat?: SourceFormat; // The canonical source format
  pretextSource?: string; // Optional derived PreTeXt for previewing LaTeX sources
  docinfo?: string; // Project-specific docinfo XML
  commonDocinfo?: string; // User-level common docinfo/preamble XML
  useCommonDocinfo?: boolean; // Use common docinfo for this project
  onUseCommonDocinfoChange?: (value: boolean) => void;
  onCommonDocinfoChange?: (value: string) => void;
  onContentChange: (
    value: string | undefined,
    meta?: EditorContentChange,
  ) => void;
  title?: string; // Document title
  onTitleChange?: (value: string) => void; // Called when title changes
  onSaveButton?: () => void; // Save button callback
  saveButtonLabel?: string; // Custom save button text
  onCancelButton?: () => void; // Cancel button callback
  cancelButtonLabel?: string; // Custom cancel button text
  onFeedbackSubmit?: (feedback: FeedbackSubmission) => void | Promise<void>;
  projectUrl?: string;
  onCreatePretextProjectCopy?: (
    request: PretextProjectCopyRequest,
  ) => void | Promise<void>;
  onSave?: () => void; // Keyboard save callback
  onPreviewRebuild?: (
    source: string,
    title: string,
    postToIframe: (url: string, data: any) => void,
  ) => void;
}

interface DocinfoEditorCloseValue {
  docinfo: string;
  commonDocinfo: string;
  useCommonDocinfo: boolean;
}

interface DocinfoEditorProps {
  docinfo: string;
  onClose: (value: DocinfoEditorCloseValue | undefined) => void;
  showCommonDocinfoControls?: boolean;
  commonDocinfo?: string;
  initialUseCommonDocinfo?: boolean;
}
```

`DocinfoEditor` is exported for host apps that want to edit user-level common docinfo directly.

For LaTeX-authored documents, the editor derives previewable PreTeXt on the fly. The simple preview remains read-only for the LaTeX source project; visual editing becomes available in the new PreTeXt copy your app creates.

When a document is in LaTeX mode and `onCreatePretextProjectCopy` is provided, the toolbar exposes a Convert to PreTeXt action. Clicking it opens a confirmation dialog and, if confirmed, sends the converted PreTeXt to your callback so your app can create a new project copy.

The current LaTeX project is not replaced by this action.

When `onFeedbackSubmit` is provided, the editor shows Give feedback links in the main menu and LaTeX conversion dialog. The popup collects:

- optional email address
- required feedback message
- optional inclusion of current source
- project URL (when available)

The collected payload is sent to your callback so your app can email it, store it, or route it to another workflow.

### Rails Integration Pattern

```tsx
const handleFeedbackSubmit = async (feedback: FeedbackSubmission) => {
  await fetch("/editor_feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editor_feedback: feedback }),
  });
};

const handleCreatePretextProjectCopy = async (
  request: PretextProjectCopyRequest,
) => {
  await fetch("/projects/create_pretext_copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_copy: request }),
  });
};
```

Typical server behavior:

- Feedback endpoint stores the message and optionally sends an email to support.
- Project-copy endpoint creates a new project with the same title and `pretextSource` as canonical source.
- Original project remains unchanged.

### Persistence recommendation

For consuming apps, the recommended storage model is:

- store one canonical source: `source` plus `sourceFormat`
- optionally store derived `pretextSource` as a cache for LaTeX-authored documents
- do not treat LaTeX and PreTeXt as two independently editable canonical sources

If your product needs an audit trail, keep the original LaTeX and created PreTeXt copy linked in your own persistence layer.

## Features

- **Visual Editor**: Intuitive WYSIWYG editor for PreTeXt documents via `@pretextbook/visual-editor`
- **Code Editor**: Monaco-powered code editor with syntax highlighting
- **Full Preview**: Full-page preview of your document
- **Synchronized Editing**: Changes in one editor instantly reflect in the other
- **Split View**: View code and visual editor side-by-side
- **Math Support**: KaTeX support for rendering mathematical expressions
- **Keyboard Shortcuts**: Intuitive keyboard navigation and commands

## Peer Dependencies

This package requires:

- `react` >= 16.8.0
- `react-dom` >= 16.8.0

These must be installed separately in your project.

## Full preview (in-browser builds)

The full preview renders PreTeXt to HTML **in the browser**, using the official
PreTeXt XSLT stylesheets compiled to WebAssembly
(`@pretextbook/pretext-html`). There is no build server to run and no token to
configure: a preview costs roughly 400ms the first time in a session and ~90ms
after that.

### Bundler configuration (required)

`@pretextbook/libxslt-wasm` locates its WebAssembly binary relative to its own
module URL. Bundlers that pre-bundle dependencies move that URL and break the
lookup, so exclude the package. With Vite:

```js
// vite.config.js
export default defineConfig({
  optimizeDeps: {
    exclude: ["@pretextbook/libxslt-wasm"],
  },
});
```

The renderer itself is loaded with a dynamic `import()` only when a preview is
first opened, so apps that never show one pay nothing for it.

### Fallback for browsers without JSPI

Local rendering needs WebAssembly JSPI (stack switching), which Chromium-based
browsers ship and some others do not. The editor feature-detects it:

- **JSPI available** — renders locally; no host wiring needed.
- **JSPI unavailable** — falls back to the `onPreviewRebuild` prop, if you
  provide one. Without it, the preview toggle is hidden on those browsers.

Keep `onPreviewRebuild` wired if you need to support non-Chromium browsers, or
if you want authoritative builds from the real PreTeXt toolchain — the WASM
renderer cannot generate `latex-image`/`sageplot` assets, which require the
Python toolchain.

When a render fails (most often because the document is not yet well-formed
mid-edit), the last successful preview stays on screen and a dismissible
banner reports the problem.

### Two-way sync

Clicking in the preview moves the cursor to the matching source line, and
moving the cursor scrolls the preview to the matching element. Both are
automatic — there is nothing for a host to wire up.

Sync works off a source map the renderer produces alongside the HTML, so it
follows the document's structure rather than guessing from scroll offsets. Two
consequences worth knowing:

- **The editor buffer and the rendered document are not the same text.** The
  preview renders the division with its `<plus:* ref="..."/>` placeholders
  expanded and a `<pretext>` wrapper added, so line numbers differ. The
  correspondence is recovered by matching line content (`previewSync.ts`).
  Lines with no counterpart — a placeholder, or any buffer whose rendered form
  is a conversion, as with LaTeX and Markdown divisions — simply do not sync.
- **Clicking content from an expanded child division opens that division** and
  lands the cursor on the matching line of its own source. Which division owns
  a click is read from the clicked element's rendered id: PreTeXt builds ids so
  that an authored `xml:id` resets the chain, so every id begins with the
  division that authored it (`sec-markdown-2-2-4` → `sec-markdown`). A click
  whose id belongs to no known division — page chrome, say — leaves the editor
  where it is rather than guessing.

Previews rebuild on save rather than on every keystroke, so between an edit and
the next rebuild a sync can land slightly off; the next rebuild restores it.
Switching to a different division *does* rebuild immediately — the preview has
to be showing the same division the editor is, or sync would be translating
between two unrelated documents.

Line-level sync covers PreTeXt divisions. A LaTeX or Markdown division is
converted to PreTeXt before rendering, and the conversion carries no source
map, so there is no line to land on and the cursor stays put. Clicking a
PreTeXt subsection *nested inside* such a division still opens that subsection,
since which division owns a click does not depend on line matching.

### Preview theme

The preview starts in light mode, matching the editor, which ships no dark mode
of its own. Authors can switch it from the preview's own readability menu, and
that choice persists across rebuilds — PreTeXt handles both, so there is nothing
to wire up.

One host-visible side effect: the preview iframe uses `srcdoc` and therefore
shares your page's origin, so PreTeXt reads and writes its theme setting in
**your app's `localStorage`, under the key `theme`**. If your app uses that same
key, the two will fight; namespace yours to avoid it.

## Browser Support

This package requires a modern browser with ES2020 support. The full preview
additionally requires WebAssembly JSPI; see above for the fallback.

## Development

For development setup:

```bash
npm install
npm run dev
```

To build the library:

```bash
npm run build
```

To build the demo application:

```bash
npm run build:demo
```

## Publishing

See [PUBLISHING.md](./PUBLISHING.md) for instructions on publishing to npm.

## License

MIT
