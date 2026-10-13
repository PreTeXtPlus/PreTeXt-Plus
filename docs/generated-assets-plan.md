# Generated assets

Plan of record for assets whose picture is *computed from source* — PreFigure first,
`latex-image` and the rest after — where the editor itself produces the output and the
build server never has to.

**Status:** draft, nothing started. Written 2026-10-13 against `main` at `2672227`.

## Context

An `Asset` today is one of two things ([asset.rb:9](../app/models/asset.rb#L9)):

| kind | what it is | how it is assembled |
| --- | --- | --- |
| `file` | uploaded bytes (ActiveStorage) | `<image source="ref.ext">` and the bytes land in `source/external/ref.ext` |
| `authored` | raw PreTeXt in `source`, meant to be a hand-written `<latex-image>` or `<asymptote>` | `<image>` + the source, verbatim |

The transform is `transformImageAsset` in
[assetTransforms.ts:33](../packages/web-editor/src/assetTransforms.ts#L33); the archive
entry is written at
[project_archive_builder.rb:84](../app/services/project_archive_builder.rb#L84). Nothing
in the repo generates anything. An `authored` asset shows "Preview coming soon" in the
preview pane ([AssetPreview.tsx:24](../packages/web-editor/src/components/AssetPreview.tsx#L24)),
and the live preview banner tells authors that `latex-image`/`sageplot` need a real build.

A **generated asset** is the missing third thing: authored source that the editor turns
into a file. The author writes PreFigure XML, watches the diagram render live, and when
they save, the SVG is stored with the asset exactly as if they had uploaded it. From then
on the document embeds it as an **external** image. The full build server
(`pretext-plus-build-full`) does not run `prefig` for it, the preview shows it without a
build, and a PDF target gets a PDF without TeX ever seeing the diagram source.

### What PreFigure gives us (researched 2026-10-13)

- **Repo:** <https://github.com/davidaustinm/prefigure> is now a monorepo. The playground
  is `packages/playground/`, deployed to <https://davidaustinm.github.io/prefigure/>.
  PyPI package `prefig` 0.7.9 (pure Python wheel, 182 KB).
- **The playground runs the real Python package in Pyodide 0.26.4 inside a Web Worker**
  (`src/worker/compiler.ts`). The pieces PreFigure normally shells out for are replaced by
  JS callbacks registered as a Python module (`src/worker/compat-api.ts`): math labels
  through MathJax 4 TeX→SVG, braille through speech-rule-engine (Nemeth) and a liblouis
  JS build, text metrics through `OffscreenCanvas.measureText`. No node, no pycairo, no
  system fonts.
- **Engine entry point** (`packages/prefig/engine.py`):
  `build_from_string(format, input_string, environment="pyodide")` → `(svg, annotations)`.
  Builds only the first `<diagram>`; raises on malformed XML. The playground's class is
  `PreFigureCompiler.compile(mode: "svg" | "tactile", source) → { svg, annotations }`.
- **Cost:** ≈95–100 MB cold (scipy alone is 47 MB; Pyodide core ≈14 MB), **15–20 s on a
  cold cache**, a few hundred MB of worker memory. The Rust/WASM port exists precisely to
  fix this but is incomplete (no tactile, no `<network>` layout, no `<read>`, no
  histogram/scatter) and not published to npm.
- **Pyodide-mode differences from the CLI:** the SVG id prefix is a random hash rather
  than deterministic, and annotations are auto-generated when the author wrote none.
  The CLI also writes `<label>-11.svg`, `<label>-diagcess.svg`, `.pdf`, `.png`; the
  browser engine produces SVG 2 and the annotations XML, nothing else.
- **Published alternative:** `@doenet/prefigure` (npm, AGPL-3.0, pins prefig 0.7.6,
  145 MB unpacked) is a straight extraction of the playground worker with a
  `compilePrefigure(xml, { mode })` API.
- **Licenses:** PreFigure is GPL-3.0; this app is AGPL-3.0, so vendoring playground
  code is compatible (GPLv3 §13). `diagcess` — the keyboard-exploration script PreTeXt
  itself ships for annotated diagrams — is `UNLICENSED` on npm. We can load the copy
  PreTeXt's HTML already carries, but should not redistribute it as our own package
  without asking Volker Sorge.

### How PreTeXt consumes it

- Authored form: `<image><prefigure xmlns="https://prefigure.org" label="…"><diagram>…</diagram></prefigure></image>`.
  The `@label` is the output basename; without one core warns about unreliable filenames.
- `pretext generate prefigure` writes `generated/prefigure/<label>.svg` (+ `-annotations.xml`,
  `-diagcess.svg` when annotated, `.pdf`/`.png` via rsvg-convert). Per target the CLI
  needs (`pretext-cli/pretext/constants.py` `ASSET_FORMATS`): html family → `svg`,
  pdf/latex → `pdf`, kindle → `png`.
- An **annotated** diagram in HTML is not an `<img>`: core emits
  `<div class="ChemAccess-element" data-src="…-diagcess.svg" data-cml="…-annotations.xml">`
  plus `diagcess.js`. **There is no way to get that markup from `<image source>`.**
- An external `<image source="ref">` with no extension means "the author supplies
  `ref.svg` *and* `ref.pdf`"; HTML picks the first, LaTeX the second.
- The CLI's "only regenerate what changed" cache is one SHA-256 per asset *type* over the
  assembled source, stored in `generated/.<target>_assets.json`
  (`pretext-cli/pretext/project/__init__.py:731`). Pre-seeding `generated/` from the
  browser so the CLI skips `prefig` would mean reproducing core's assembly serialization
  bit-for-bit. **Rejected** — the external route is the robust one, and the full build
  server already has `prefig` installed for whatever still falls through.

---

## Decisions

1. **A generated asset is a `file` asset with provenance.** New enum value
   `kind: generated (2)`, plus `assets.generator` (string: `"prefigure"`, later
   `"latex-image"`, …). Its `source` column holds the *generator's input* (for PreFigure,
   the `<diagram>` element; never the `<image>`/`<prefigure>` wrapper). Its output is the
   existing `has_one_attached :file`. Everything that already understands a file — `url`,
   `thumbnail_url`, `external_filename`, the archive's `external/` entry, the asset list
   thumbnail, the `/external/:ref` route, `Project#full_dup` — works unchanged.

2. **Assembly emits the external form only when the output is trustworthy, and falls
   back to the generator's own PreTeXt otherwise.** `assets.output_source_digest` records
   the SHA-256 of the source the output was built from. If it matches the current
   source, `transformImageAsset` writes `<image source="ref.svg">`. If it does not (never
   rendered, render failed, source edited by a peer who never loaded the engine), it
   writes `<image><prefigure xmlns=… label="ref">source</prefigure></image>` and the build
   server generates it. **A stale picture is never shipped**; the document is always
   buildable. This is also what makes collaboration safe: the output is bytes the host
   holds, like an upload, and a peer who edits the source without an engine just
   invalidates it.

3. **Annotated PreFigure diagrams keep the source form in builds.** Decision 2's fallback
   is also used when the diagram has `<annotations>`, because the external form has no
   way to carry diagcess. The preview pane still shows the browser-rendered SVG *with*
   diagcess, and the output is still stored (it is what the preview and the thumbnail
   show). *Alternative if accessibility-in-builds matters less than build time:* always
   emit external. One flag in the generator definition; not a design change. **Needs the
   user's call.**

4. **Which form a target gets is decided at assembly, per target.** The assembler takes
   `assetNeeds: "svg" | "pdf" | "png"` derived from `Target::Catalog` (mirroring the
   CLI's `ASSET_FORMATS`). An asset whose stored outputs cover the need is external;
   otherwise it falls back to source. In phase 1 only SVG exists, so HTML-family builds
   and the preview skip `prefig`, and PDF builds still run it — the common case is
   covered first. Phase 6 adds PDF/PNG renditions and the extensionless
   `<image source="ref">` form, after which no target generates.

5. **The engine runs in a Web Worker we own, built from the playground's worker code,
   not from `@doenet/prefigure`.** The Doenet package pins an older prefig, vendors
   145 MB into our bundle, and its blob-URL worker trick exists for a cross-origin case we
   do not have. Our worker is ~3 files (`compiler.ts`, `compat-api.ts`, the liblouis
   build) with attribution, loads Pyodide from jsDelivr (CORS-enabled, immutable URLs,
   shared browser cache with every other Pyodide site) and the `prefig` + `segno` wheels
   from `public/` (copied by `script/copy-static-assets.js`, like `libxslt.wasm` and the
   Hunspell dictionaries). Esbuild has no code splitting here, so the worker is a
   separate esbuild entry and everything heavy is fetched at runtime by URL — the same
   rule the spell checker's dictionary already follows.

6. **Loading the engine is explicit, once per page.** 100 MB is not something to start
   because an author clicked a row in the asset list. The preview pane shows what is
   stored and a **Load PreFigure engine (~100 MB, first time only)** button; after that
   the engine stays warm for the session and every PreFigure asset renders live. The
   same `GeneratorRuntime` object is shared across assets; it is terminated after a
   long idle (memory) and recreated on demand.

7. **The generator abstraction is a registry, like `editorConfigs`.** One
   `AssetGenerator` definition per generator (id, label, Monaco language, starter
   source, `wrapSource` for the fallback form, `needsFallback(source)` for decision 3,
   `createRuntime()`), looked up by `asset.generator`. Adding `latex-image` is a new
   entry whose runtime calls a server instead of a worker (Part 7). Nothing outside the
   registry names a specific generator; tests iterate the registry.

8. **Output upload rides the existing save pipeline, not a new endpoint.** The host
   already multipart-PATCHes `project[assets_attributes][0][file]`
   (`patchProjectAssetUpload`, [editor.jsx:797](../app/javascript/controllers/react/editor.jsx#L797)).
   A render result becomes part of the editor's working copy for that asset and is sent
   with the next save alongside `source` and `output_source_digest`. One transaction,
   one place that knows how to persist an asset.

---

## Part 1 — Model and storage (Rails)

### 1.1 Migration

```ruby
add_column :assets, :generator, :string              # nil for file/authored
add_column :assets, :output_source_digest, :string   # sha256 of `source` the file was built from
```

`kind` gains `generated: 2` — additive, integer enums are never renumbered
(`docs/build-targets.md`, Traps). No backfill: no row is generated yet.

### 1.2 `Asset`

- `GENERATORS = %w[ prefigure ].freeze`; validate `generator` present and in the list
  iff `generated_kind?`, absent otherwise.
- `output_current?` → `file.attached? && output_source_digest == Digest::SHA256.hexdigest(source.to_s)`.
  This is the single predicate decision 2 hangs on; the assembler reads it through JSON,
  the archive builder reads it directly.
- `CONTENT_TYPE_EXTENSIONS` already has `image/svg+xml → svg`, so `external_filename`
  is `ref.svg` for free. Phase 6 adds `application/pdf → pdf` for renditions.
- The quota (`within_asset_quota`) counts rows, not bytes; a generated asset is one row.
  Fine for now; worth remembering if outputs grow (a PreFigure SVG with MathJax labels is
  tens of KB, not MB).

### 1.3 Params, JSON, archive

- `projects_controller.rb:443` permits `generator` and `output_source_digest` on
  `assets_attributes`. The digest is **client-supplied** — it is a statement about which
  source the bytes match, and only the client that rendered knows. The server verifies
  nothing beyond the format; `output_current?` is what consumes it.
- `_asset.json.jbuilder` adds `generator`, `output_source_digest`, `output_current`.
  `railsAssetToEditor` maps them to `generator`, `outputSourceDigest`; the editor computes
  currency itself (it has the live source, the server does not).
- `ProjectArchiveBuilder` keeps writing every attached file to `source/external/`. It
  **also** writes a stale output (harmless, unreferenced) rather than growing a branch —
  the assembler decides what the document references, and that is the only place the
  decision lives.
- `ProjectDocProjection` (Yjs → rows) and `Project#full_dup` need the two new columns
  carried; `full_dup` already shares blobs.

### 1.4 Tests

`asset_test.rb`: enum/validation matrix, `output_current?` flips on a source edit.
`project_archive_builder_test.rb`: a generated asset lands in `external/ref.svg`.
Controller: `generator`/digest round-trip through `assets_attributes`.

---

## Part 2 — The generator registry and assembly (web-editor)

### 2.1 `src/generators/`

```ts
export interface AssetGenerator {
  id: GeneratorId;                      // "prefigure" | "latex-image"
  label: string;                        // tab + title bar: "PreFigure"
  language: "xml" | "latex";            // Monaco language for the source buffer
  starterSource: string;                // what a new asset opens with
  /** The PreTeXt child of <image> for this source — the fallback (build-side) form. */
  wrapSource(source: string, ref: string): string;
  /** Decision 3: this source must be generated by the build even if an output exists. */
  requiresBuildGeneration?(source: string): boolean;
  /** Formats the browser runtime can produce. Phase 1: ["svg"]. */
  produces: OutputFormat[];
  createRuntime(opts: GeneratorRuntimeOptions): GeneratorRuntime;
}

export interface GeneratorRuntime {
  readonly status: "idle" | "loading" | "ready" | "failed";
  load(onProgress?: (p: LoadProgress) => void): Promise<void>;
  render(source: string, opts: { format: OutputFormat }): Promise<RenderResult>;
  dispose(): void;
}

export interface RenderResult {
  /** The external file(s): name is the bare extension ("svg"); bytes go to the host. */
  outputs: { format: OutputFormat; blob: Blob }[];
  /** What the preview pane shows; may be richer than the stored output (diagcess). */
  previewHtml: string;
  diagnostics: { severity: "error" | "warning"; message: string }[];
  sourceDigest: string;                 // sha256 of the exact source rendered
}

export const generators: Record<GeneratorId, AssetGenerator> = { prefigure };
```

`prefigure.wrapSource` emits
`<prefigure xmlns="https://prefigure.org" label="${ref}">${source}</prefigure>` (the
label is the ref so a build-generated file has the same basename as our output would).
`requiresBuildGeneration` is `source` contains `<annotations` (decision 3).
`starterSource` is a small axes-and-graph diagram with one TeX label, so the engine's
MathJax path is exercised on the very first render.

### 2.2 `Asset` type and `transformImageAsset`

[editor.ts:5](../packages/web-editor/src/types/editor.ts#L5) gains
`generator?: GeneratorId` and `outputSourceDigest?: string`. `isFile` stays what it is
(mirrors `kind === "file"`); a generated asset is `isFile: false, generator: "prefigure"`.

`transformImageAsset(asset, ref, needs)`:

```
generated + output current + covers `needs` + !requiresBuildGeneration  →  <image source="ref.svg">…</image>
generated otherwise                                                      →  <image>\n<shortdescription/>\n{wrapSource(source, ref)}\n</image>
file / authored                                                          →  unchanged
```

"Output current" is `sha256(asset.source) === asset.outputSourceDigest`, computed in the
editor (a tiny sync SHA-256 or the Web Crypto async one hoisted out of the render path;
`assembleFullProjectSource` is synchronous, so cache the digest on the pool entry when
the source or digest changes rather than hashing during assembly).

`needs` defaults to `"svg"` (the preview). `assembleFullProjectSource` and
`assembleProjectJson` thread it through; `script/assemble-source.mjs` reads it from the
project JSON `SourceAssembler` sends, which `ProjectArchiveBuilder` sets from
`Target::Catalog` (`website`/`scorm`/`revealjs`/`epub` → svg, `pdf`/`latex`/`beamer` → pdf,
`kindle` → png, `braille` → svg).

### 2.3 Verbatim and spell-check scopes

`VERBATIM_SOURCES` ([sectionUtils.ts:1773](../packages/web-editor/src/sectionUtils.ts#L1773))
gains `prefigure` so a `<plus:…>`-looking string inside a diagram is never scanned; the
spell checker's `xmlRegions` treats `prefigure` like `latex-image` (code, not prose).

### 2.4 Tests

- `assetTransforms.test.ts`: the three-way branch above, for every generator in the
  registry, every `needs`, with and without annotations, with a matching and a
  mismatched digest.
- `snippets.test.ts`-style: each generator's `starterSource` wrapped by `wrapSource`
  inside `<image>` validates against the real PreTeXt schema (the schema already
  includes `pf-adapter.rnc`, so a bad starter fails here, not in a build).
- `assembleFullProjectSource` end-to-end: one generated asset embedded twice, placeholder
  `@width` copied onto both `<image>`s in both forms.

---

## Part 3 — Creating and editing a PreFigure asset

### 3.1 The creation tab

`NewAssetForm` grows one tab per registry entry after **Custom**: **PreFigure** (and
later **LaTeX image**). It is the "add a tab for prefigure" the feature asks for, built
so the next generator is a registry entry, not a form edit. The tab asks only for a
title (ref derived, as Custom does) and calls `onCreateGenerated(generator, title)`.

Host: `onCreateGenerated` in `editor.jsx`, a sibling of `onCreateAuthored`
([editor.jsx:1021](../app/javascript/controllers/react/editor.jsx#L1021)), sends
`{ ref, kind: "generated", generator, title, source: generators[generator].starterSource }`.
The starter source is *persisted* on create (not synthesized on open), so a peer or a
reload sees the same thing and `output_source_digest` has something to be stale against.

`handleAssetCreated` is unchanged: pool + doc, embed code to clipboard, `openAsset`.

### 3.2 The buffer

`resolveEditorTarget` already hands the code editor `asset.source` with
`lockStructure={false}`. Two additions:

- The Monaco language comes from `generators[asset.generator].language` rather than
  always PreTeXt XML. (PreFigure is XML; the win is `latex-image` later. CodeMirror from
  the playground is *not* brought over — Monaco is the editor here, and the playground's
  LSP only checks well-formedness, which Monaco's XML mode flags already.)
- `assetWrapperLines` draws the locked virtual wrapper as
  `<image>` / `<prefigure xmlns="https://prefigure.org" label="ref">` … `</prefigure>` /
  `</image>` — the fallback form, because that is literally what the source *is* in
  PreTeXt terms; the external form is an optimization the author should not have to
  think about. The title bar chip says **PreFigure** and, from Part 5, whether the stored
  output is current.

### 3.3 Settings drawer

`AssetSettings` shows the generator as read-only text and, for a generated asset, hides
**Replace image…** (replacing the picture of a generated asset is editing its source).
**Duplicate** copies source + generator, no file (the copy renders on open). A new
**Download SVG** action is just the existing `url`.

---

## Part 4 — The PreFigure runtime and the preview pane

### 4.1 The worker

`packages/web-editor/src/generators/prefigure/worker/` — ported from
`packages/playground/src/worker/{compiler,compat-api,index}.ts` and `liblouis/`, with a
NOTICE crediting the playground (Jason Siefken / David Austin, GPL-3.0). Comlink stays
(it is tiny and the playground's shape is proven). Changes from the playground:

- `indexURL` for Pyodide is `https://cdn.jsdelivr.net/pyodide/v0.26.4/full/` by default,
  overridable by the host; the `prefig` and `segno` wheel URLs come from the host
  (`/assets/prefigure/prefig-0.7.9-py3-none-any.whl`). The prefig version is pinned in
  one constant next to the wheel copied by `script/copy-static-assets.js`, with a test
  that the two agree.
- `loadPackage([...])` not `micropip` (the playground is right: no dependency
  resolution, no PyPI, and `lxml>=6` is unsatisfiable on Pyodide 0.26). Moving to
  Pyodide 0.28 is a one-line bump once prefig's deps are checked against its lock file.
- Progress events from `loadPackage` are forwarded so the pane can show "Loading
  scipy… (47 MB)" instead of a spinner for twenty seconds.
- The worker is its own esbuild entry (`app/javascript/prefigure-worker.js` → built file
  under `/assets`), created with `new Worker(url, { type: "module" })`. The web-editor
  receives the URL through a `generatorRuntimes` prop
  (`{ prefigure: { workerUrl, wheelBaseUrl, pyodideIndexUrl? } }`); with no entry the
  PreFigure tab is hidden, exactly as `hideAssets` hides the panel for `tryit`.

### 4.2 `GeneratedAssetPreview`

`AssetPreview` branches on `asset.generator`. The generated pane has three states:

1. **Engine not loaded.** Shows the stored output if `url` is set (an `<img>`, as today),
   a "last rendered from the current source" / "source changed since this was rendered"
   line, and the **Load PreFigure engine** button (decision 6). Memory of "the author
   already loaded it this session" lives on the shared runtime, so re-opening an asset
   never asks twice.
2. **Rendering.** Debounced 1 s after typing (the `LivePreview` cadence), using the
   buffer's live source (the pool, via `settledDivisions`-style flush, not the saved
   record). In flight, the previous render stays visible; a diagnostics strip shows the
   Python error text (PreFigure's messages are decent: `ValueError: PreFigure source is
   not well-formed XML: …`, element-specific errors) with a line number when the message
   has one.
3. **Rendered.** `previewHtml` in a `<iframe srcdoc sandbox="allow-scripts">`. Sandboxed,
   unlike `LivePreview` — this iframe never needs same-origin DOM access, and diagcess is
   third-party script we did not write, so there is no reason to grant it. The srcdoc is
   the playground's wrapper (`<div class="ChemAccess-element"><div class="svg">…</div><div class="cml">…</div></div>` + `diagcess.Base.init(true)`),
   with `diagcess.js` served from the copy PreTeXt core already carries, and the Braille29
   font for tactile. A **SVG / Tactile** toggle maps to `mode`; tactile is preview-only in
   phase 1 (its output is a PDF the browser cannot make).

Theme: the pane follows the editor theme by background only; the SVG is the author's.

### 4.3 Resource hygiene

- One runtime per page, lazily created, `dispose()`d after ~10 min without a render
  (several hundred MB of WASM heap is not something to leave in a tab all afternoon).
  Disposal is invisible: the next render shows the loading state again.
- Renders are serialized with a "latest wins" queue; a stale render's result is dropped
  rather than flashed.
- `renderPreviewHtml` in `wasmPreview.ts` needs JSPI; Pyodide does not, so Firefox and
  Safari users — who already fall back to the server preview — still get live PreFigure.
  Worth a system test on the Playwright Chromium and a manual check elsewhere.

---

## Part 5 — Saving the output

The author never clicks "save SVG". Saving the project saves the picture.

### 5.1 Editor side

`EditorContentChange` for an asset ([editor.ts](../packages/web-editor/src/types/editor.ts))
gains an optional `output`:

```ts
{ kind: "asset", id, ref, source, output?: { format: "svg", blob: Blob, sourceDigest: string } }
```

`GeneratedAssetPreview` reports a successful render to `Editors` → `applyRecordSourceChange`
path → `onContentChange` with `output` attached **only when `sourceDigest` equals the
digest of the source being reported**. The pool entry's `outputSourceDigest` is updated
optimistically so the assembler (preview) switches to the external form immediately,
*but* the preview's `<img src="external/ref.svg">` would 404 until the save lands — so
the preview resolver (Part 5.3) serves the blob directly.

Decision 2 keeps this honest under collaboration: the output's bytes go only to the
host, the digest goes into the Y.Map as LWW metadata like `url` does (schema.ts), and a
peer whose source edit arrives after the render simply produces a mismatch.

### 5.2 Host side

`editor.jsx`'s working copy keeps `pendingAssetOutputs: Map<id, {blob, sourceDigest}>`,
latest wins. The bulk save (`editorStateToRailsPayload` / `changedRecordSources`,
[editor.jsx:170](../app/javascript/controllers/react/editor.jsx#L170)) is JSON today;
when any pending output exists it becomes the multipart form `patchProjectAssetUpload`
already builds, with `file`, `source` and `output_source_digest` in the same
`assets_attributes[i]`. One request, atomic per asset. Autosave (10 s) therefore uploads
at most one SVG per asset per 10 s regardless of typing speed. The flush before a
navigation/unload that already exists for typed text covers the output too.

On the response, `railsAssetToEditor` carries the new `path`/`extension`, and the pool's
`url` updates — which is what the asset list thumbnail and the engine-not-loaded state
show.

### 5.3 Preview resolution

The live preview's `<img src="external/ref.svg">` resolves through
`/projects/:id/external/:ref` today, which redirects to the stored blob — stale until the
save lands, or 404 before the first save. Switch the preview to pretext-html's
`rewriteAssetUrls` (unused so far; `node_modules/@pretextbook/pretext-html/dist/assets.d.ts`)
with a resolver that answers `external/ref.svg` from the in-memory output blob
(`URL.createObjectURL`) when one is pending and falls back to the route otherwise. This
is a small, contained change that also fixes a latent issue: the preview currently shows
the *saved* version of an uploaded replacement until the save completes.

### 5.4 Server side

Nothing new: nested attributes, ActiveStorage, `touch: :source_updated_at` marks targets
stale. One guard in `Asset`: a `generated` asset's `file` must be `image/svg+xml` (or a
phase-6 rendition type) — an authored upload of a PNG as "the output" is a bug, not a
feature.

---

## Part 6 — PDF and PNG renditions (later)

Phase 1 leaves PDF/LaTeX/kindle builds generating PreFigure on the server. Closing that:

- `has_many_attached :renditions` on `Asset`, each named `ref.<ext>` by content type;
  the archive writes all of them to `external/`; `transformImageAsset` emits the
  extensionless `<image source="ref">` when both `svg` and `pdf` exist, else the current
  per-`needs` logic.
- **Where the PDF comes from.** The browser cannot run rsvg-convert, and SVG→PDF in JS
  (svg2pdf.js) is good enough for MathJax path output but not proven for PreFigure's
  gradients/clip paths. Recommended: a `POST /convert` endpoint on the lite build server
  (`rsvg-convert`, which the image already has for `prefig`), called from a Rails job
  (`AssetRenditionJob`) after a generated asset's SVG is saved with a current digest,
  through the same proxy pattern `ProjectsController#preview` uses. Renditions are
  derived data; the job is idempotent on `(asset_id, output_source_digest)`.
- A rendition is only trusted when its own digest matches, same rule as the primary.

---

## Part 7 — The second generator: `latex-image`

The proof that Part 2 is general. `latex-image` cannot run in the browser (TikZ needs a
TeX engine; TikZJax exists but covers a fraction of what authors use, and the output
drifts from a real build). So its `createRuntime` is a **server runtime**: `render()`
POSTs the source plus the project's `<latex-image-preamble>` and `docinfo/macros` to a
lite-build-server endpoint that runs `pretext`'s own latex-image pipeline for one image
and returns the SVG. Same `RenderResult`, same preview pane, same save path, same
assembly rule. The only differences are: `language: "latex"`, no engine-load step
(`load()` resolves immediately), a longer debounce (2–3 s; a TeX run is seconds, not
milliseconds), and rate limiting on the server.

`wrapSource` is `<latex-image>${source}</latex-image>`; the preamble is *not* part of the
asset — it is docinfo, and the runtime reads it from the project at render time, so
changing the preamble invalidates nothing in storage but does make the next render differ.
Worth hashing the preamble into `sourceDigest` so a preamble change marks every
`latex-image` output stale; the digest is the editor's to define per generator.

Existing `authored` assets that are a bare `<latex-image>` could be migrated to
`generated/latex-image` by unwrapping; a one-off rake task, not part of this plan.

---

## Sequencing

| Part | Depends on | Ships value on its own? |
| --- | --- | --- |
| 1 Rails model | — | No visible change |
| 2 Registry + assembly | 1 | Yes: a generated asset created by hand in the console builds correctly in both forms |
| 3 Create/edit UI | 2 | Yes: authors can write PreFigure with the fallback form (server generates) — already better than `authored` |
| 4 Runtime + preview | 3 | Yes: live PreFigure preview |
| 5 Save output | 4 | **The feature:** HTML builds and previews skip `prefig` |
| 6 Renditions | 5 | PDF builds skip `prefig` |
| 7 latex-image | 2, 5 | Second generator |

Parts 1–3 are one PR with no heavy dependencies and are worth landing early so the data
model is settled before the worker work (which is where the surprises will be). Part 4
is the risky one: budget time for the Pyodide load path across browsers and for the
MathJax/liblouis port.

---

## Open questions

| Question | Blocks | Suggested answer |
| --- | --- | --- |
| Annotated diagrams: source form in builds (accessible) or external (fast)? | Part 2 | Source form (decision 3). Flip per generator later if build time wins. |
| Pyodide from jsDelivr or self-hosted? | Part 4 | jsDelivr: CORS-ready, shared cache, immutable. Self-host only if an institution's network blocks it, in which case `pyodideIndexUrl` is already a prop. |
| Is `diagcess` redistribution acceptable? | Part 4 | Load PreTeXt's shipped copy; ask Volker Sorge before vendoring. Preview works without it (static SVG) if the answer is no. |
| Does a generated asset's output count against anything? | Part 5 | Not now. Row quota applies; outputs are small. Revisit with renditions. |
| Should `tryit` get PreFigure? | Part 4 | No — `projectAssets={[]}`, `hideAssets`. Nothing to save to. |

## Traps

- **`output_source_digest` is a claim, not a fact.** The server stores what the client
  says. Anything that *trusts* an output (assembler, archive, future renditions job) must
  compare it to `sha256(source)` at that moment, never read a boolean off the row.
- **Digest the exact string that was rendered.** Trim nothing, normalize nothing in one
  place that the other does not; a whitespace-only difference between what Monaco holds
  and what the worker received makes every output permanently stale.
- **Assembly is synchronous.** Do not call Web Crypto inside `transformImageAsset`; keep
  the digest on the pool entry.
- **Never auto-load the engine** on open, on hover, or on project load. 100 MB and a
  hundreds-of-MB heap are the author's to opt into.
- **Esbuild has no code splitting here.** Anything Pyodide-, MathJax- or liblouis-sized
  must be a separate entry or a runtime fetch, or it welds itself into the editor bundle.
- **`VERBATIM_SOURCES` must include `prefigure`** or a diagram containing `<plus:` text
  (unlikely, but a `<label>` can say anything) will be mis-parsed as a placeholder.
- **The preview iframe for generated output is sandboxed; `LivePreview` is not.** Do not
  "unify" them — the live preview needs same-origin for click-to-source sync, the
  generated preview runs third-party script.
- **The external form loses `@label` continuity.** A build that falls back to source
  names the generated file `ref.svg` under `generated/prefigure/`; the external form puts
  `ref.svg` under `external/`. Same basename, different directories — nothing collides,
  but a reader of the build output should not expect one directory to hold all diagrams.
- **`image/svg+xml` served inline** is already an override in `Asset#url`; a generated
  SVG from the engine contains `<script>`-free markup, but the asset list renders it as
  `<img>` only, same as uploads. Keep it that way.
