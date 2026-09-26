# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`@pretextbook/web-editor` is a **React component library** (not a standalone app) that provides an in-browser editor for [PreTeXt](https://pretextbook.org/) documents. It is published to npm and consumed by host applications — the primary export is the `<Editors />` component.

## Commands

```bash
npm install          # Install dependencies
npm run build        # Build the library (dist/)
npm run lint         # ESLint across all TypeScript/TSX files
npm run typecheck    # tsc -b (covers src/, including tests)
npm run test         # Run the Vitest suite once
npm run test:watch   # Vitest in watch mode
npm run test:coverage # Vitest with a v8 coverage report
```

This package has no demo/dev app — its only real consumer, the PreTeXt-Plus
Rails app, bundles this package's source directly via esbuild (see the root
`package.json`'s `build` script), not the `dist/` build. `npm run build`
exists for a future npm-publishing host.

## Testing

Tests run on **Vitest** and live in `src/__tests__/`. `.github/workflows/test.yml` runs lint, typecheck, test, and the library build on every PR.

- Vitest is configured in `vitest.config.ts`, separate from `vite.config.ts` (tests need only the React plugin, not Tailwind or the library rollup settings).
- The default environment is **node**, since most tests cover pure source-manipulation utilities. Component tests opt into a DOM with a `@vitest-environment jsdom` docblock at the top of the file — see `ErrorBoundary.test.tsx`.
- Globals are **off**; import `describe`/`it`/`expect`/`vi` from `vitest` explicitly.
- `src/__tests__/setup.ts` registers the jest-dom matchers and cleans up React trees between tests.
- `tsconfig.build.json` excludes `src/__tests__`, so tests are type-checked but never emitted into `dist/`.

Coverage is concentrated on the source-manipulation layer (`sectionUtils.ts`, `contentConversion.ts`, `xmlUtils.ts`) and `ErrorBoundary`. Tests deliberately pin down the malformed-XML fallbacks and the per-format isolation of `<plus:* ref>` include parsing, since both are easy to regress silently.

There is no demo app for interactive checks — verify changes via the Vitest suite and, for anything the tests can't cover, the PreTeXt-Plus Rails app's editor/tryit pages.

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
- **Editor menus** (`TopBar.tsx`, `CodeEditorMenu.tsx`, `MenuDropdown.tsx`, `documentActionMenuEntries.ts`, `editorCommands.ts`, `editorConfigs/snippets.ts`): `TopBar` is the unified ~64px top bar — logo, a title/language row, and a File/Edit/Insert/Tools menubar (`CodeEditorMenu` rendered with a `File` `leadingMenus` entry and `showDocumentActionsInTools={false}`). `CodeEditor` no longer renders its own toolbar; it reports the Monaco-derived reactive state (`canUndo`/`canRedo`/`hasSelection`/the clipboard-select-all-insert actions/find-in-file status) up to `Editors` via `onMenuStateChange`, which `TopBar` renders from. Every format gets the same Edit/Insert/Tools shape — only contents differ — with the format-specific document actions (Format PreTeXt, Import, Clean up LaTeX, Edit Macros vs. Edit Preamble, Assets, Snippets, Display Full Source) built once by `buildDocumentActionEntries` in `documentActionMenuEntries.ts` and placed in File (Tools keeps only the generic Monaco commands). "Convert to PreTeXt" is the one action that changes what the project *is*: it stays a button (in `CodeEditor`, floating next to the source-format badge) rather than being folded into the menu-driven document actions, but Tools also carries it as a plain item for discoverability.
- **Import dialog** (`ImportDialog.tsx`, `importConvert.ts`): Tools → Import… (PreTeXt divisions only) converts outside material and hands it back as text to copy — it never writes to the project, so the result reaches undo, collab, and the host as an ordinary paste. Text in the left pane (typed, pasted, or a `.tex`/`.md`/`.ptx` file) goes through this package's own converters, LaTeX clean-up included — or, if the author ticks "Convert with … instead", through the host's alternative engine for that format (`alternateTextEngine`, the same `alternateFor` pick the import wizard offers; pandoc in the Rails app), which receives the cleaned text as an `import.tex`/`import.md` file. The source-format override lists only LaTeX and Markdown: detection settles documents and LaTeX, but ties go to LaTeX, so short Markdown snippets with `$…$` math, blockquotes or pipe tables need it; PreTeXt is only ever a detection result, meaning "nothing to convert". Any other file goes to the host's `importEngines` (falling back to `@pretextbook/import`'s built-in converter) and the left pane shows only its name. Both paths end in `fitImportForDivision`: cut down to the body (an engine returns a whole `<pretext>` document), retarget divisions one rung below the open division, rename ids the project already uses (records *and* in-source `xml:id`s), wrap loose text in `<p>`. The importer's own insert destination is deliberately not used — it treats the whole document as the inserted division, keeping the `<article>` wrapper and pushing its sections two rungs down. Images an engine extracts are reported, not carried: a clipboard holds text only.
  - `editorCommands.ts` holds every Monaco action id in one place, plus the operations Monaco can't serve from a menu. Clipboard actions go through `navigator.clipboard` rather than Monaco's own `clipboardCopyAction` and friends, which copy whatever the *document* selection is — by the time a menu item is clicked that's the menu, not the buffer. Reading the clipboard is the one thing a browser may refuse outright, so `paste` resolves `false` and the menu says so instead of doing nothing. Select All is ours too (`selectEditableRegion`): it selects only the editable body (see `lockedRegion.ts`), since a selection covering the locked wrapper lines can't be typed over or cut. `CodeEditor` rebinds Mod+A to the same handler, scoped to `editorTextFocus` so Monaco's own select-all still serves the find box; a read-only buffer selects everything, there being nothing editable to narrow to.
  - The Insert menu is **one shared catalog** with per-format bodies, so a construct has the same label in the same group in all three formats and only the inserted text changes. A format omits a key its converter can't handle (Markdown has no table, figure or link support in `@pretextbook/remark-pretext` yet — they become `<TODO>` placeholders). `__tests__/snippets.test.ts` runs every body through the real PreTeXt schema and the real LaTeX/Markdown converters, so the catalog can't drift from what the pipeline accepts; that test is what caught PreTeXt requiring lists and displayed math *inside* a `<p>`, deprecating `<me>` for `<md>`, and `<program>` wanting `<code>` rather than `<input>`. A PreTeXt body is run through `assembleFullProjectSource` before it is validated, exactly as the schema linter does, since a body may contain a `<plus:* ref/>` placeholder (the Figure snippet writes one for its image) that only assembly can expand into something the grammar accepts.
  - PreTeXt decides legality by parent, so each catalog entry carries a `placement` and `editorConfigs/insertContext.ts` fits the body to the cursor rather than assuming the caret is somewhere the snippet happens to fit. An `in-paragraph` construct (every inline element, lists, displayed math) is written bare and gains its own `<p>` only when the cursor isn't already in one; a `block` construct (paragraph, theorem, figure, table, program) is inserted *after* the enclosing `</p>` when it is, since it can't nest there. Bodies therefore hold no wrapper of their own — `wrapInParagraph` supplies it — and the schema test checks each `in-paragraph` body both ways. Only PreTeXt buffers are gated: a `<p>` in LaTeX or Markdown source would be literal text, not the structure the walk reads it as.
  - Snippets are inserted through Monaco's `snippetController2` so tab stops are live; the cursor is first moved out of any locked structural line (see `lockedRegion.ts`), since an insert there would be silently reverted. `CodeEditor` also declines a placement move onto a locked line — an unterminated `<p>` running past the division body — and inserts at the caret instead.
  - `editorConfigs/xmlTags.ts` holds the tolerant tag primitives shared by the placement gate and the spell checker's `xmlRegions.ts`: both read half-typed markup, and both must degrade into doing *less* rather than throwing.
- **VisualEditor**: from `@pretextbook/visual-editor` (external package). Only active when source is PreTeXt; read-only otherwise.
- **Spell check** (`src/components/editorConfigs/spellcheck/`): registered from all three configs' `registerMonacoExtensions`, publishing `Info` markers under the `pretext-spellcheck` owner (distinct from `pretext-schema` and the flavor linters' owners, since `setModelMarkers` replaces everything for an owner). The seven scopes in `scopes.ts` deliberately mirror `pretext-tools.spellCheck.checkErrorsInsideScope` in the PreTeXt VS Code extension so authors get identical behavior; keep the vocabulary in step, but do **not** port that extension's ignore regexes, which exist only because cSpell has no PreTeXt grammar. The Hunspell dictionary is fetched at runtime (never imported) — hosts bundle in one esbuild pass with no code splitting, so importing it would weld ~550KB into the main bundle; see `dictionary.ts` and the README.
  - The only per-format part is the `RegionFinder` (`regions.ts`) that says which slices of a source are prose; the dictionary, word extraction, markers and quick fixes are shared, so a new format is taught to spell check by writing one finder. `spellcheck/index.ts` maps format → finder.
  - `xmlRegions.ts` is a purpose-built XML scanner — not a pass over Monaco tokens, because the PreTeXt flavor uses Monaco's *built-in* `xml` grammar whose token names we don't own, and because the scopes that matter are element-shaped (`<m>`, `<latex-image>`) and need an element stack. It emits text runs directly, since XML markup announces itself with `<`.
  - `latexRegions.ts` and `markdownRegions.ts` work the other way round: prose is the default, so they collect what to *hide* and `checkableRegions` complements it. Their structural work is done by `scanDocument` from `@pretextbook/latex-style-pretext` / `@pretextbook/markdown-style-pretext` — the same scanners that back those flavors' completions and lint — which is why they read the math and verbatim environment sets from those packages rather than keeping lists of their own. Scopes map to a flavor's constructs by **what the converter turns them into** (`\begin{program}` → `<program>` → `blockCode`), so one setting behaves the same in all three formats; that rule is what decides the awkward cases (an environment's `[title]` argument is checked, because it becomes a `<title>` element, while an image's alt text follows `tags`, because it becomes an attribute).
  - `words.ts` judges a word partly by the characters touching it, and consults only those the finder left *inside* a region. That is what lets Markdown's `_term_` be checked while `snake_case` is still skipped: the emphasis delimiters are suppressed as markup, the word-internal underscore is not.
- **LivePreview** (`src/components/LivePreview.tsx`): iframe-based preview; posts content to `https://build.pretext.plus` via `postToIframe.ts`

### Content Conversion (`src/contentConversion.ts`)

- Converts LaTeX → PreTeXt via `@pretextbook/latex-pretext`
- Converts Markdown → PreTeXt via `@pretextbook/remark-pretext`
- Formats output via `@pretextbook/format`
- Auto-detects format from content heuristics (XML tags, LaTeX markers, Markdown headings)

### Section Utilities (`src/sectionUtils.ts`)

Splits and merges PreTeXt documents at section boundaries. Supported section types: `<section>`, `<introduction>`, `<worksheet>`, `<handout>`, `<exercises>`, `<references>`, `<glossary>`, `<solutions>`, `<reading-questions>`, `<conclusion>`.

**Placeholder attributes pass through to the resolved element.** Every attribute on a `<plus:* ref/>` placeholder except `ref` is copied onto the markup that replaces it during assembly (`applyPlaceholderAttrs`). This is a blanket rule, not a list of known attributes: `@component`, `@width`, `@xml:lang` are all the same kind of fact — a property of *this inclusion*, not of the included record, which is exactly what cannot live on the record when one division/asset/snippet is embedded in more than one place. A `@component` on a division that is included by reference has nowhere else to go at all, since the division's own source is shared by every include of it.

- The copy happens on resolution *output*, never inside resolution: `divisionToPretext` caches per `xml:id`, so attributes baked in earlier would be shared by every reference to that division.
- It lands on each **top-level** element, so a `@component` tags the division and not every paragraph inside it. A snippet is the case that makes the plural necessary — it can resolve to several sibling elements with no single tag to hang the attribute on.
- On a collision the placeholder wins, replacing the value rather than appending (a duplicated attribute is not well-formed XML).
- A LaTeX holder has nowhere inline to write them, so `\plus` takes an optional argument: `\plus[component=teacher]{section}{x}`. Both converters already emit these as real attributes; the helpers here only have to tolerate and preserve the shape. The placeholder *writers* stay on the bare form — the optional argument is the author's to add.
- `renameDivisionRef` rewrites a placeholder in place rather than rebuilding it from type and id, precisely so these attributes survive an `xml:id` rename. Rebuilding drops them silently, which shows up much later as a division that quietly starts appearing in every build.

### Project Explorer (`src/components/ProjectExplorer.tsx` + `src/components/toc/`)

The left sidebar is an always-visible icon rail plus a panel for the selected
view. The store's `explorerView` names the view and `isTocCollapsed` whether the
panel is shown; `selectExplorerView` is the rail click (clicking the open view's
icon collapses to the rail, and that choice is remembered), `showExplorerView` is
for code that needs a view on screen (Tools → Find in Project, the wrapper-line
properties form) and never collapses.

- **Contents** (`toc/ArticleToc.tsx`): the document's tree, root down through
  every placed `<plus:* ref/>`. Unplaced divisions are deliberately *not* here.
- **Divisions** (`toc/DivisionList.tsx`): every division as a flat list — root,
  placed in document order, then unplaced (marked "not placed"), which is the
  only place unplaced divisions and their Place-in-document action appear.
  Row actions shared with Contents live in `toc/useDivisionActions.ts`.
- **Snippets** / **Assets** (`toc/SnippetList.tsx`, `toc/AssetList.tsx`); hidden
  along with their rail icons by `hideSnippets` / `hideAssets`.
- **Find** (`toc/FindReplacePanel.tsx`): project-wide find/replace. Escape
  collapses it; its inputs persist in the store's `findPanelState`.
- Rail icons are inline SVG components in `toc/explorerIcons.tsx` that stroke
  with `currentColor`, so the button's text color styles them.
- **"Add new division" creates nothing.** It opens a draft properties form
  (`pendingNewDivision` in the store, rendered by `toc/NewDivisionRow.tsx` at the
  position the division will take); the record, the parent's `<plus:* ref/>`
  placeholder and the host notification all happen in one go when the form is
  saved (`handleDivisionCreate` in `Editors.tsx`). So Cancel leaves the project
  untouched, and a new division is never renamed — it is created with the id the
  author chose, which is why only *existing* divisions reach
  `syncParentDivisionRef`.
- Any explorer action that rewrites a division's source computes it from the pool,
  and the code editor reports typing on a 500 ms debounce — so it must call
  `settledDivisions()` (flush the pending keystroke, then re-read the store)
  rather than this render's `divisions`. Skipping that lets the late delivery
  land on top of the structural write and undo it; see
  `__tests__/pendingEditFlush.test.tsx`.

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
