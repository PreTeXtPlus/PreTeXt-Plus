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
   `version`, …), where for a designer exercise they are the `<exercise>`'s.
   The wrapper an activity is placed in needs nothing but its `xml:id`/`label` and
   title; the interactive is what has a size. A new activity starts with
   `width="100%"`. (Until 2026-11-24 also `aspect="4:3"`; see Decision 8 for why
   assembly now drops it.)
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
4. **Assembly writes the slate as one CDATA section.** `wrapExerciseSource(exercise, tag)`
   builds `<interactive xml:id="x-doenet" label="x-doenet" platform="doenetml" …>` with
   a `<slate surface="doenetml">` holding the source verbatim inside `<![CDATA[ … ]]>`
   (`doenetmlCdata`), and
   the wrapper around it with the record's ref as its `xml:id` and `label` and its
   title. A bare placement puts the ref on the `<interactive>` itself. `slate` joins
   `OPAQUE_ELEMENTS` so instance qualification never looks inside it.
   CDATA replaced entity escapes (`&lt;` for every tag) on 2026-11-14: the
   assembled `main.ptx` is also what an author downloads, and escaped DoenetML
   there could be neither read nor pasted back into Doenet. To PreTeXt the two
   are the same text node — pretext-html 0.20.0 was run on both and wrote the
   same `<script type="text/doenetml">`, byte for byte, including for a source
   holding `]]>`, a `<section xml:id>` and a bare `<`. The only rewriting left
   is that a `]]>` in the source is split across two sections. The activity's
   wrap is not passed through `expandRefs`, so a `<plus:… ref/>` typed into
   DoenetML stays DoenetML. A separate file per activity pulled in with
   `<xi:include parse="text"/>` — what PreTeXt authors are told to do — is the
   better form for a download and belongs to the planned rework of source
   downloads (see Later); the preview has no filesystem and keeps CDATA either
   way.
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

8. **A wrapped activity is a *dual* exercise, with a fixed static half, in a frame
   sized by PreTeXt's `responsive` behavior** (2026-11-24).
   - Every wrapper placement — `<plus:exercise>`, `<plus:project>`, `activity`,
     `exploration`, `investigation` — assembles to that element holding
     `<dynamic><statement><interactive …/></statement></dynamic>` and
     `<static>…</static>`. PreTeXt classifies only that shape as `dual`
     (`pretext-assembly.xsl`, which matches `exercise` and the project-likes
     alike), and only a classified one reaches a Runestone manifest: a wrapper
     holding a bare `<interactive>` is "static" there, so it could not be assigned
     or graded through SPLICE. Each output takes one half — HTML the activity, a
     PDF, braille or a solutions manual the static one. The sample is
     `examples/sample-book/rune.xml`'s `doenet-average-velocity` (marked
     experimental upstream, 2025-11-05); Active Calculus places Doenet in
     project-likes this way on Runestone.
   - **The schema lags for the project-likes.** The development schema admits the
     dual form for `<exercise>` only, so a dual project-like is reported at its
     `<dynamic>`, `<static>` and closing tag. Those lines are inside the expanded
     placement, so the live lint draws nothing on the author's buffer;
     `doenet.test.ts` pins the exact complaints so it fails once the schema
     catches up.
   - **The static half is always `DOENET_STATIC_FALLBACK`**, a statement saying
     the activity is available online. A per-activity static version was built and
     withdrawn the same day: Doenet is to supply a static rendering itself, so the
     record grows no field for one. A bare `<plus:interactive>` has no static half;
     PreTeXt draws it in a PDF as its preview and QR code.
   - **No `aspect`, and `resize-behavior="responsive"`, for every placement,
     bare included.** Doenet's viewer posts its content's height (a SPLICE
     `lti.frameResize`, height only) and PreTeXt's `lti_iframe_resizer.js`, on
     every page, applies it, so the frame's height follows the activity: `aspect`
     only set the height it opened at. Assembly drops a stored one (an attribute
     an author writes on the placeholder itself still passes through, as every
     placement attribute does). The horizontal scroll bar authors saw was the
     *width*: under PreTeXt's default `fixed-height`, `width="100%"` is a fixed
     `width:600px`, while an exercise's knowl box is 570px wide (and a phone's
     ~300px), so `.interactive-iframe-container` (`overflow-x: auto`) scrolled
     sideways. `responsive` writes `max-width: 100%; width: 100%` instead.
     Measured 2026-11-24 with pretext-html 0.21.1 and `@doenet/standalone` 0.7.29
     in headless Chromium at 1280, 900, 700 and 390px: with `fixed-height` every
     frame overflowed its container by 30px (296px at 390); with `responsive` none
     did, and the height still followed the content. `aspect` made no difference
     to either.

9. **A placement decides whether its exercise is titled** (2026-11-25). A `title`
   attribute on any exercise placement — designer exercise or activity, every
   wrapper tag — replaces the record's title for that placement: `title="no"` (or
   empty) leaves the wrapper untitled, anything else is the title, as XML text.
   Assembly consumes it (`resolveExerciseRef`), so it never reaches the element as
   an attribute; on a bare `<plus:interactive>` it does nothing. The placement, not
   the record, because the choice follows where the exercise sits (untitled in an
   `<exercises>` division, titled as a project) and one record can be placed both
   ways under `instance`; and because the record's title is also its name in the
   explorer, tabs and title bar, which a blank title would leave to the ref.
   Context-based defaults (untitled inside `<exercises>`) were considered and left
   until authors show they want them. The LaTeX converter keeps the braces of
   `\plus[title={A, B}]` in the value — an upstream fix, not one made here.
   - The duplicate-placement lint compares exercise placements by record, not by
     tag: `<plus:exercise ref="x"/>` and `<plus:project ref="x"/>` both write
     `xml:id="x"` and `x-doenet`, and a bare interactive is `x`, so a second
     unnamed placement under a different tag needs an `instance` just as one
     under the same tag does.

10. **A doenet.org embed code pasted into a PreTeXt buffer becomes an iframe
    interactive** (2026-11-25), a third way in beside the record and Insert's
    in-place activity: `<interactive iframe="https://doenet.org/embed/<id>"
    width="100%" resize-behavior="responsive"/>`, the activity staying on
    doenet.org. Only the `/embed/<id>` page: measured in headless Chromium, it
    posts `lti.frameResize` with its content's height (and SPLICE
    `getState`/score messages, which PreTeXt's Runestone SPLICE wrapper reads for an
    `@iframe` in a dual exercise). Rendered with pretext-html 0.21.1 at 1280 and
    390px, bare and inside an `<exercise>`, the resizer set each frame to the
    activity's height (about 850px) and no frame overflowed its box. Any lone
    `<iframe>` pasted is read as the link in its `src`, so YouTube's, Desmos's and
    GeoGebra's embed codes convert too (`mediaUrls.ts`).

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
the CDATA wrap, the docinfo version reader and the editor page; `DoenetEditorPane.tsx`;
`NewExerciseForm`'s type picker; `ExerciseSettings`' width/aspect fields and
wrapper picker for the embed code; `Editors` renders the pane for a `doenetml` record;
Insert → Interactives & Media gains a DoenetML activity typed in place. Tests:
`doenet.test.ts` (wrap, CDATA, version default, every wrapper through the schema,
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

- **`xi:include` in the downloaded archive** — proof of concept in place
  (2026-11-14). `assembleProjectFiles` returns the document as files: each
  activity as `source/doenet/<ref>.doenet`, included with `parse="text"`, each
  placed division as `source/<ref>.ptx`, each generated asset's source as
  `source/<generator>/<ref>.<ext>`, the docinfo as `source/docinfo.ptx`.
  Uploads moved to `assets/`, beside `source/`, in every archive, declared in
  the docinfo (`<directories external="../assets"/>`, added by the server's
  assembly); the publication file keeps only `generated="../generated-assets"`.
  `projects#download` uses it (`ProjectArchiveBuilder`'s `modular: true`); a
  build still takes the single file. Tests expand the includes (libxml2's
  XInclude, in `SourceAssemblerTest`) and compare with the single file. Not yet
  done: a real `pretext build` of a downloaded archive, files for snippets and
  designer exercises, and LaTeX/Markdown divisions in
  their own format (they are converted to PreTeXt).
- **Static outputs.** A wrapped activity's static half is a fixed note (Decision 8)
  until Doenet can render a static version of an activity itself; that, not a
  field on the record, is where a real one will come from.
- **Doenet's version per record** (`@version` on the interactive) is already an
  `attrs` entry assembly writes through; the settings drawer does not offer it.
- **Runestone/SCORM** builds give the activity an id and SPLICE messaging; nothing
  here is in their way, and nothing here tests them.
- **Pinning the version in the stored docinfo** rather than at assembly, so the
  author sees it in the docinfo editor; today it is the assembly default unless they
  write one.

## Traps

- **The slate's text is raw in the page.** PreTeXt writes `<script type="text/doenetml">`
  with the text unescaped, so the CDATA section in `wrapExerciseSource` is the one place
  the DoenetML becomes XML; nothing may escape it as well.
- **Text scans of the assembled document see the DoenetML as written.** DoenetML has
  its own `<section>`, `<title>` and `<exercise>`. `nextTag` skips CDATA, and so must
  anything new that walks assembled XML; a bare regex over it will find those tags.
- **`attrs` mean different things by format** (Decision 2). `wrapExerciseSource`
  reads the format before deciding which element gets them.
- **Never widen the editor frame's sandbox.** It runs a collaborator's DoenetML on the
  editor's origin otherwise.
- **An outside change recreates the editor** and loses its cursor; the pane therefore
  sends `ptx-doenet-set` only when the stored source differs from what the frame last
  reported, never as the echo of the frame's own change.
- **`expandRefs` falls through to divisions.** A tag not dispatched explicitly is read
  as a division placeholder; the wrapper tags must be matched before that fallback.
