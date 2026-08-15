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

### Collaboration (`src/collab/`)

Optional real-time co-editing via Yjs, activated by passing a `collaboration` prop (`{ doc, awareness, user }`) to `Editors`. The **host owns the transport** — it creates, seeds (`seedDocFromState`), and syncs the `Y.Doc` with its server; the editor only binds to it. `yjs` and `y-protocols` are **peer dependencies** so host and editor share one instance.

- `schema.ts` — doc layout: `divisions` map (key = record id → entry with `xmlId`/`sourceFormat`/`title`/`type` + `Y.Text` source), `assets` map (key = record id → LWW metadata only — an asset's *bytes* stay with the host, since the doc is replicated to every peer and persisted as an append-only log), `meta` map (`title`, `docinfo`, `useCommonDocinfo`, all LWW), and `deleted` map (tombstones, record id → `"division" | "asset"`). Division *order* lives in parent sources as `<plus:* ref/>` placeholders, so it needs no structure. `seedDocFromState`/`docToState`/`clearDeletions` are exported for hosts.
- Tombstones exist because removing an entry from a Y.Map leaves nothing a later save can act on: the peer that removed a record persists that immediately, but if the request never lands, a full reload from the host would resurrect the row. The session leader replays each tombstone as a `_destroy` until the host confirms it, then calls `clearDeletions`. This requires the host's delete to be idempotent — as its create must be, since the same record can be sent by both the acting client and the next bulk save.
- `bridge.ts` — `CollabBridge` keeps doc ↔ Zustand store equal. Local writes flow through the same `EditorsInner` choke points that update the store (`emitContentChange`, `applyDivision*`, the asset add/update/remove handlers, title/docinfo commits); remote transactions are translated into pure store pool actions (which never fire host persistence callbacks). Origin tags distinguish the two — anything not registered as local is remote. The doc keys assets by record id while the store pool keys them by kind+ref, so the bridge maintains its own index between the two and replays a remote `ref` change as a pool *rename*.
- `bridge.transact(fn)` (via `collabTransact` in `Editors.tsx`) groups writes that belong together into one update — creating a division and inserting the parent `<plus:* ref/>` that points at it, or renaming an xml:id across division, record, and parent — so peers never observe a placeholder referring to a division they don't have.
- `monacoBinding.ts` — Monaco ↔ `Y.Text` binding, reimplemented instead of using `y-monaco` because y-monaco imports the `monaco-editor` npm package while this library gets Monaco from `@monaco-editor/react`'s CDN loader. Also publishes/renders cursor presence via relative positions in awareness.
- `PresenceAvatars.tsx` — avatar chips in the menu bar, driven by awareness.
- `editGuard.ts` — keeps a division's structural lines read-only in collab mode. The `constrained-editor-plugin` used for solo editing can't serve here: it reverts an out-of-range change with `model.undo()` from a content listener that can't distinguish local typing from a remote CRDT delta, so it would undo a peer's edit and re-broadcast that undo. The guard instead *prevents*, discriminating by entry point — local edits reach the model through `pushEditOperations`, remote deltas through `applyEdits`. Both modes read their geometry from `components/lockedRegion.ts`, so they lock the same lines.
- In collab mode, `CodeEditor` swaps plugin enforcement for that guard, recomputes the locked lines on every content change (the plugin's own range tracking is gone, and a PreTeXt closing tag is always the last line), and skips the `content`-prop → model sync (the binding owns the model).
- Record ids are minted by the editor (`src/recordId.ts`), not asked of the host. A new division therefore reaches the doc **synchronously**, in the same transaction as the placeholder referencing it, and the host persists it under the id it was given (`onDivisionAdd`'s return value is unused). Assets are the exception in one direction only: their bytes must reach the host first, so the uploader publishes the finished record — with the host's URL on it — once the upload returns. Peers learn of an asset from the doc, never from re-fetching the host, so the `projectAssets` prop's "new identity = authoritative reset" behavior is suppressed whenever a bridge is attached.

The demo app's "Load Collab Demo" button renders two `Editors` relayed in-memory — the fastest way to exercise convergence, remote cursors, and structural sync without a host.

### Public API (`src/index.ts`)

Only exports meant for consumers should be added here. Exported types include `EditorContentChange`, `FeedbackSubmission`, `PretextProjectCopyRequest`, `DocumentSection`, `DocumentChapter`, `DocinfoEditorProps`, and the collaboration surface (`CollabSession`, `CollabUser`, `CollabDocState`, `CollabDocSnapshot`, `seedDocFromState`, `docToState`, `clearDeletions`, `newRecordId`).

## Coding Conventions

- All TypeScript; prefer typed over `any`.
- Function components with hooks only.
- Styling is inline Tailwind CSS v4 utility classes in JSX `className` props — no per-component CSS files. Conditional/variant classes use `clsx`. Shared dialog chrome lives in reusable subcomponents (`src/components/Dialog.tsx`: `DialogOverlay`, `Dialog`, `DialogHeader`, `DialogButton`, etc.) rather than repeated className strings. Elements queried by tests carry a `data-testid` (see `src/components/toc/SectionItem.tsx`) instead of being selected by class name. The only literal CSS left in the package is `src/index.css` (the `@import "tailwindcss";` entry point, plus two rules that style Monaco's own internally-generated DOM and can't be expressed as a React `className`) and `src/App.css` (three demo-only selectors for `html`/`body`/`#root`, which are outside any JSX this package renders).
- Visual-editor behavior and PreTeXt-tag support belong in `@pretextbook/visual-editor`, not here.
- Tailwind CSS v4 is used internally; it is **pre-compiled** into `dist/web-editor.css`. Consumers import the CSS file and do not need Tailwind installed.

## Build Output

`npm run build` produces:

- `dist/index.js` — CommonJS bundle
- `dist/index.es.js` — ES module bundle
- `dist/index.d.ts` — TypeScript declarations
- `dist/web-editor.css` — all styles (Tailwind-generated)

Publishing is handled by `.github/workflows/publish.yml` (manual trigger, choose patch/minor/major bump).
