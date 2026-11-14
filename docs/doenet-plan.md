# Doenet activities

Plan of record for authoring DoenetML activities in PreTeXt-Plus and placing them in
the document as exercises, projects or bare interactives, so that PreTeXt builds them
as `<interactive platform="doenetml">`.

**Status:** decided 2026-11-14 after the spike below; built in the same session. What
remains is listed under "Later".

## What was measured (2026-11-14)

- **Doenet runs in the preview's sandbox.** `@doenet/standalone` 0.7.29 (the package
  PreTeXt's HTML loads from jsdelivr) was framed in a `srcdoc` iframe with
  `sandbox="allow-scripts"` and no `allow-same-origin` — the frame every
  `<interactive platform>` page gets in the live preview (`docs/interactives-plan.md`).
  Both its viewer (`renderDoenetViewerToContainer`) and its full editor
  (`renderDoenetEditorToContainer`: CodeMirror with DoenetML completions, context
  help, a diagnostics bar, a formatter and its own viewer beside it) loaded, drew a
  graph with a draggable point, a math input and a Check Work button. The only
  console noise is MathJax failing to read `localStorage`, which it survives. GeoGebra
  cannot do this; Doenet can, so no separate origin is needed.
- **The editor reports edits.** `DoenetEditor` takes `immediateDoenetmlChangeCallback`
  (every keystroke) and `doenetmlChangeCallback` (debounced), plus `readOnly`,
  `showViewer`, `viewerLocation`, `width`, `height`. Both callbacks fired in the
  sandbox. Its `doenetML` prop is the *initial* source: an outside change is applied
  by recreating the container (the package caches a React root per container
  element).
- **pretext-html 0.20.0 already returns the page.** Rendering a document holding a
  DoenetML interactive bare in a section, directly inside an `<exercise>`, and inside
  a `<statement>` gave three entries in `RenderResult.iframePages`, each the page
  PreTeXt writes: the standalone CSS and module script from
  `https://cdn.jsdelivr.net/npm/@doenet/standalone@<version>/`, a
  `div.doenetml-applet` and a `<script type="text/doenetml">` holding the slate's
  text **raw** (`<xsl:value-of select="text()"/>` under the HTML output method). The
  iframe in the main page carries `data-doenet-coordinate="true"`. So the preview
  shows a Doenet activity with no renderer change.
- **The schema** (`pretext-dev.json`) accepts `<interactive platform="doenetml">` as a
  direct child of `<exercise>` (no `<statement>` needed), inside a `<statement>`, as a
  block in a section, inside a `<figure>`, and with a `@version`; and
  `<docinfo><doenetml version="…"/>`.
- **The version.** Without `docinfo/doenetml/@version` PreTeXt loads
  `@doenet/standalone@latest`, so a book's activities would change under it. The
  assembled document therefore always names a version (Decision 5).

## Decisions

1. **A Doenet activity is an `exercise` record whose `source_format` is `doenetml`,**
   and whose `source` is the DoenetML text itself, never PreTeXt. The precedent is
   generated assets (`docs/generated-assets-plan.md`, Decision 1): `kind` is the
   storage role and `source_format` the language of `source`, which decides the
   editing surface. It lives in the Exercises view, is created from the New
   Exercise form's type picker, and reuses the pools, the collab map, the Rails
   nested attributes and the explorer rows unchanged. A new content kind would have
   meant a new placeholder tag in three syntaxes, a new explorer view and a new
   collab map for the same record.
2. **`attrs` are the `<interactive>`'s attributes** for a `doenetml` record (`width`,
   `aspect`, `version`, …), where for a designer exercise they are the `<exercise>`'s.
   The wrapper an activity is placed in needs nothing but its `xml:id`/`label` and
   title; the interactive is what has a size. A new activity starts with
   `width="100%" aspect="4:3"`.
3. **The placeholder's tag names the surrounding PreTeXt.** `<plus:exercise ref="x"/>`
   wraps the activity in an `<exercise>`; `<plus:project ref="x"/>`, `<plus:activity>`,
   `<plus:exploration>` and `<plus:investigation>` in the project-like element of that
   name; `<plus:interactive ref="x"/>` emits only the `<interactive>`, for a figure, a
   `<task>` the author writes inside their own exercise, or running text. The Markdown
   and LaTeX spellings follow (`::project{ref="x"}`, `\plus{project}{x}`): the
   converters map any directive or macro name to `<plus:name>`. For a designer
   exercise only `plus:exercise` resolves; the other tags leave a comment naming the
   problem. Placement attributes pass through as they do for everything else
   (`applyPlaceholderAttrs`), so `<plus:interactive ref="x" width="50%"/>` sizes that
   placement, and `instance` qualifies a second placement's identifiers.
4. **Assembly writes the slate as XML text.** `wrapExerciseSource(exercise, tag)`
   builds `<interactive xml:id="x-doenet" label="x-doenet" platform="doenetml" …>` with
   a `<slate surface="doenetml">` holding the source with exactly `&`, `<` and `>`
   escaped (TikZ's rule: the buffer is DoenetML, only the document's copy is XML), and
   the wrapper around it with the record's ref as its `xml:id` and `label` and its
   title. A bare placement puts the ref on the `<interactive>` itself. `slate` joins
   `OPAQUE_ELEMENTS` so instance qualification never looks inside it.
5. **The document always names a DoenetML version.** `wrapInPretextDocument` adds
   `<doenetml version="…"/>` to the docinfo whenever the body uses
   `platform="doenetml"` and the docinfo has no `<doenetml>` of its own — like
   `withDefaultLatexImagePreamble`, a splice the author's docinfo passes through
   otherwise unchanged, and one that covers a hand-typed interactive too. The default
   is `DEFAULT_DOENETML_VERSION` in `src/doenet/`, bumped deliberately. The editor
   frame loads the same version the document names (`docinfo` first, then the
   default), so what the author edits against is what the build runs.
6. **Doenet's editor edits the source, in a sandboxed iframe of its own.** It replaces
   the code editor for that record the way the exercise designer does (the code
   editor stays mounted, hidden). The page is built by this package
   (`doenet/editorPage.ts`), loads the standalone package from jsdelivr, renders the
   editor with its viewer to the right of the code (it has the whole width; see
   below), and talks to `DoenetEditorPane` with
   `postMessage`: the page posts `{ type: "ptx-doenet-change", source }` from the
   debounced callback, and the pane posts `{ type: "ptx-doenet-set", source }` for an
   outside change (a peer's edit, an undo), which the page applies by replacing the
   container. The pane accepts only messages whose `source` is its own frame's
   window. The sandbox is `allow-scripts` alone, as for every interactive page, and
   for the same reason: a collaborator's DoenetML runs there. Edits reach the project
   through `applyRecordSourceChange`, the typed-source path (working copy, collab
   `diffReplace`, autosave), never the per-edit host PATCH the designer uses for
   attribute changes. **The preview panel is withdrawn while an activity is open**
   (decided 2026-11-14, after a first version kept it): Doenet's editor has a viewer
   of its own, and a second copy of the activity rendered inside a PreTeXt page
   only competed with it. The editor pane takes the width in both layouts; the
   activity is still seen in its PreTeXt wrapper wherever it is placed, from the
   division that places it. The editor's light/dark mode is the host's
   `previewTheme` (the same three values as Doenet's `ThemeSetting`), and light
   when the host has none — this editor is light-only today, and Doenet's editor
   would otherwise follow the browser on its own.
7. **Monaco was not chosen** for the source. It would keep collab cursors, spell
   check and the Edit menu, but has no DoenetML completions, help or diagnostics, and
   the exercise designer has already set the shape "a record edited outside Monaco,
   whole-source writes". Project-wide Find still reads the record's source.

## Work

Rails: `source_format` gains `doenetml: 7`; an exercise accepts `pretext` or
`doenetml`; the JSON partial, permitted params (update and import), the assembler's
`exercise_json` and the doc projection carry `source_format`; tests in
`content_test.rb`, `projects_controller_test.rb`, `project_doc_projection_test.rb`.

web-editor: `Exercise.sourceFormat` (`ExerciseSourceFormat`, `"pretext"` when absent,
so every stored record and collab entry reads as before); the collab exercise entry
carries it; `sectionUtils` gains the placement tags (`EXERCISE_PLACEMENT_TAGS`), the
widened `parseExerciseRefs`/`renameExerciseRef`/`removeExerciseRef`/`exerciseEmbedCode`,
`wrapExerciseSource(exercise, tag)`, the dispatch in `expandRefs`, and
`withDefaultDoenetmlVersion`; `src/doenet/` holds the version, the starter activity,
the escape, the docinfo version reader and the editor page; `DoenetEditorPane.tsx`;
`NewExerciseForm`'s type picker; `ExerciseSettings`' width/aspect fields and
wrapper picker for the embed code; `Editors` renders the pane for a `doenetml` record;
Insert → Interactives & Media gains a DoenetML activity typed in place. Tests:
`doenet.test.ts` (wrap, escape, version default, every wrapper through the schema,
the LaTeX and Markdown spellings), `collab.test.ts`, the pane with jsdom.

Host: `railsProjectMapping.js` and `editor.jsx` pass `source_format` both ways.

## Checked in the real editor (2026-11-14, headless Chromium against the dev server)

- File → New Exercise… with type "Doenet activity" creates the record; the pane
  loads Doenet's editor from jsdelivr in under a second (after the first
  download), with its context help, diagnostics bar and viewer; the settings
  drawer shows width, aspect, the version in force and the "Place as" picker
  whose embed code follows it.
- Typing in Doenet's editor reaches the record and the live preview, which
  renders the exercise wrapper with Doenet's viewer inside it.
- A division holding `<plus:project ref/>` and, in a figure,
  `<plus:interactive ref instance="fig"/>` previews both: the project numbered,
  the figure captioned, each with the activity running in its own frame
  (`<ref>-doenet` and `<ref>-fig`), and the placement lint quiet.
- Not checked: a collaborator's concurrent edit (the set message path is
  unit-tested only through the page's contract), a full build on the build
  server, and the LaTeX/Markdown spellings beyond the converter tests.

## Later

- **Static outputs.** A PDF needs a `<static>` or `@preview` for every interactive;
  the existing lint notes that when the project has such a target. A Doenet record
  has nowhere to put one yet; a `static` field on the record is the natural home.
- **Doenet's version per record** (`@version` on the interactive) is already an
  `attrs` entry assembly writes through; the settings drawer does not offer it.
- **Runestone/SCORM** builds give the activity an id and SPLICE messaging; nothing
  here is in their way, and nothing here tests them.
- **Pinning the version in the stored docinfo** rather than at assembly, so the
  author sees it in the docinfo editor; today it is the assembly default unless they
  write one.

## Traps

- **The slate's text is raw in the page.** PreTeXt writes `<script type="text/doenetml">`
  with the text unescaped, so the escaping in `wrapExerciseSource` is the one place the
  DoenetML becomes XML; nothing may escape it twice.
- **`attrs` mean different things by format** (Decision 2). `wrapExerciseSource`
  reads the format before deciding which element gets them.
- **Never widen the editor frame's sandbox.** It runs a collaborator's DoenetML on the
  editor's origin otherwise.
- **An outside change recreates the editor** and loses its cursor; the pane therefore
  sends `ptx-doenet-set` only when the stored source differs from what the frame last
  reported, never as the echo of the frame's own change.
- **`expandRefs` falls through to divisions.** A tag not dispatched explicitly is read
  as a division placeholder; the wrapper tags must be matched before that fallback.
