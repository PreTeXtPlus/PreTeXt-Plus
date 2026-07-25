# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`@pretextbook/web-editor` is a **React component library** (not a standalone app) that provides an in-browser editor for [PreTeXt](https://pretextbook.org/) documents. It is published to npm and consumed by host applications — the primary export is the `<Editors />` component.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start demo app at http://localhost:5173
npm run build        # Build the library (dist/)
npm run build:demo   # Build the standalone demo application
npm run lint         # ESLint across all TypeScript/TSX files
npm run typecheck    # tsc -b (covers src/, including tests)
npm run test         # Run the Vitest suite once
npm run test:watch   # Vitest in watch mode
npm run test:coverage # Vitest with a v8 coverage report
```

## Testing

Tests run on **Vitest** and live in `src/__tests__/`. `.github/workflows/test.yml` runs lint, typecheck, test, and the library build on every PR.

- Vitest is configured in `vitest.config.ts`, separate from `vite.config.ts` (tests need only the React plugin, not Tailwind or the library rollup settings).
- The default environment is **node**, since most tests cover pure source-manipulation utilities. Component tests opt into a DOM with a `@vitest-environment jsdom` docblock at the top of the file — see `ErrorBoundary.test.tsx`.
- Globals are **off**; import `describe`/`it`/`expect`/`vi` from `vitest` explicitly.
- `src/__tests__/setup.ts` registers the jest-dom matchers and cleans up React trees between tests.
- `tsconfig.build.json` excludes `src/__tests__`, so tests are type-checked but never emitted into `dist/`.

Coverage is concentrated on the source-manipulation layer (`sectionUtils.ts`, `contentConversion.ts`, `xmlUtils.ts`) and `ErrorBoundary`. Tests deliberately pin down the malformed-XML fallbacks and the per-format isolation of `<plus:* ref>` include parsing, since both are easy to regress silently.

`npm run build:demo` is currently broken upstream (top-level await in `@pretextbook/libxslt-wasm` under the iife worker format) and is therefore not part of CI. For interactive checks use `npm run dev`, whose demo app (`src/App.tsx`) has four loaders covering PreTeXt, LaTeX, Markdown, and Book editing modes.

## Architecture

### Main Component: `Editors` (`src/components/Editors.tsx`)

The root component owns all content state and layout. It:

- Holds `EditorContentState` (includes `pretextSource` or `pretextError`)
- Renders a responsive layout: tabs on screens < 800px, resizable split panels on wider screens (via `react-resizable-panels`)
- Fires `onContentChange(value, meta)` to the host app on every edit
- Conditionally renders `LivePreview` (when `onPreviewRebuild` prop is provided) or `VisualEditor`

### Editing Modes

Two source formats are supported: `"pretext"` (XML) and `"latex"`. Markdown is auto-detected on input but is converted to PreTeXt internally. Auto-detection logic lives in `src/contentConversion.ts`.

Two editing structures exist:

- **Document mode**: one contiguous source string
- **Sectioned mode**: source split into sections managed by `useSectionedEditing` hook (`src/components/useSectionedEditing.ts`). The host is responsible for persisting sections individually via `onSectionsChange` and `onSectionChange` callbacks.

Book projects add a chapter layer: the host passes a `chapters` array, and the editor calls `onChapterSelect`, `onChaptersReorder`, `onChapterContentChange`, etc.

### Sub-editors

- **CodeEditor** (`src/components/CodeEditor.tsx`): Monaco Editor with PreTeXt/LaTeX/Markdown syntax highlighting and completions (`src/components/codeEditorCompletions.ts`)
- **VisualEditor**: from `@pretextbook/visual-editor` (external package). Only active when source is PreTeXt; read-only otherwise.
- **LivePreview** (`src/components/LivePreview.tsx`): iframe-based preview; posts content to `https://build.pretext.plus` via `postToIframe.ts`

### Content Conversion (`src/contentConversion.ts`)

- Converts LaTeX → PreTeXt via `@pretextbook/latex-pretext`
- Converts Markdown → PreTeXt via `@pretextbook/remark-pretext`
- Formats output via `@pretextbook/format`
- Auto-detects format from content heuristics (XML tags, LaTeX markers, Markdown headings)

### Section Utilities (`src/sectionUtils.ts`)

Splits and merges PreTeXt documents at section boundaries. Supported section types: `<section>`, `<introduction>`, `<worksheet>`, `<handout>`, `<exercises>`, `<references>`, `<glossary>`, `<solutions>`, `<reading-questions>`, `<conclusion>`.

### Table of Contents (`src/components/TableOfContents.tsx` + `src/components/toc/`)

- Article mode: flat section list
- Book mode: chapter list with expandable sections
- Drag-and-drop reordering via `@dnd-kit`
- Hooks: `useBookChapters`, `useSectionDnd`, `useSectionEdit`

### Public API (`src/index.ts`)

Only exports meant for consumers should be added here. Exported types include `EditorContentChange`, `FeedbackSubmission`, `PretextProjectCopyRequest`, `DocumentSection`, `DocumentChapter`, `DocinfoEditorProps`.

## Coding Conventions

- All TypeScript; prefer typed over `any`.
- Function components with hooks only.
- CSS class names use the `pretext-plus-editor__` prefix (BEM-style) to avoid collision with consumer styles.
- Visual-editor behavior and PreTeXt-tag support belong in `@pretextbook/visual-editor`, not here.
- Tailwind CSS v4 is used internally; it is **pre-compiled** into `dist/web-editor.css`. Consumers import the CSS file and do not need Tailwind installed.

## Build Output

`npm run build` produces:

- `dist/index.js` — CommonJS bundle
- `dist/index.es.js` — ES module bundle
- `dist/index.d.ts` — TypeScript declarations
- `dist/web-editor.css` — all styles (Tailwind + component CSS)

Publishing is handled by `.github/workflows/publish.yml` (manual trigger, choose patch/minor/major bump).
