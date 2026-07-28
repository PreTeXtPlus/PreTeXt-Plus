# Copilot Instructions for @pretextbook/web-editor

## Project Overview

`@pretextbook/web-editor` is a TypeScript/React library providing an in-browser editor for [PreTeXt](https://pretextbook.org/) documents. It combines a Monaco-powered code editor with a visual (WYSIWYG) editor provided by `@pretextbook/visual-editor` and an optional full preview pane.

The package is published to npm and consumed as a React component library. It is **not** a standalone application—consumers import `Editors` (the main component) and its CSS into their own React apps.

## Tech Stack

- **React 18/19** with TypeScript (strict mode)
- **`@pretextbook/visual-editor`** for the visual editor implementation
- **Monaco Editor** (`@monaco-editor/react`) for the code editor
- **Vite** for both library builds (`npm run build`) and the dev demo (`npm run dev`)
- **Tailwind CSS v4** (pre-compiled into the bundled CSS; consumers do **not** need Tailwind)
- **ESLint** with `typescript-eslint` for linting

## Repository Layout

```
src/
  components/       # React components (Editors, CodeEditor, LivePreveiw, MenuBar, …)
  index.ts          # Package entry point — exports public API
  defaultContent.ts # Starter PreTeXt content used when no content prop is provided
  types.d.ts        # Shared TypeScript types
.github/
  workflows/
    publish.yml     # Manually triggered npm publish workflow
```

## Common Commands

```bash
npm install          # Install dependencies
npm run dev          # Start the Vite dev server (demo app at index.html)
npm run build        # Build the library (outputs to dist/)
npm run build:demo   # Build the full demo application
npm run lint         # Run ESLint across all TypeScript/TSX files
```

There are currently **no automated tests**. Manual verification via `npm run dev` is the primary way to validate changes.

## Coding Conventions

- All source files use **TypeScript**; avoid `any` where possible (the lint rule is currently set to `off` but prefer typed alternatives).
- React components are written as **function components** with hooks.
- CSS class names for the library use the `pretext-plus-editor__` prefix (BEM-style) to avoid collisions with consumer styles.
- The public API surface is defined in `src/index.ts`; only add exports there for things consumers need.
- Visual-editor behavior and PreTeXt-tag support should be implemented in `@pretextbook/visual-editor`, not in this repository.

## Building and Publishing

The library is built in two modes via Vite:

- **lib mode** (`npm run build`): produces `dist/index.js`, `dist/index.es.js`, `dist/index.d.ts`, and `dist/web-editor.css`.
- **demo mode** (`npm run build:demo`): builds the standalone demo app from `index.html`.

Publishing to npm is handled by the `publish.yml` GitHub Actions workflow (manual trigger, choose patch/minor/major bump).

## Key Design Notes

- The `Editors` component owns content state and passes it down to both sub-editors; changes in either editor propagate upward via `onContentChange`.
- Responsive layout: screens narrower than 800 px switch to a tab-based layout; wider screens use a resizable split panel (`react-resizable-panels`).
- The optional `onPreviewRebuild` prop on `Editors` enables a full-page iframe preview; without it the preview pane shows the visual editor component.
