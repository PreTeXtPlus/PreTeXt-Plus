# Generated assets

Plan of record for assets whose picture is *computed from source* — PreFigure first,
`latex-image` and the rest after — where the editor produces the files PreTeXt would
have generated, ships them with the project, and the build server keeps them instead of
regenerating.

**Status:** decided 2026-10-19, nothing implemented. Supersedes the 2026-10-13 draft,
which routed the output through `<image source="ref.svg">` (the "external form"). That
route had no way to carry an annotated PreFigure diagram and needed a per-target branch
in the assembler; both problems go away below.

## Context

An `Asset` today is one of two things ([asset.rb:9](../app/models/asset.rb#L9)):

| kind | what it is | how it is assembled |
| --- | --- | --- |
| `file` | uploaded bytes (ActiveStorage) | `<image source="ref.ext">`; the bytes land in `source/external/ref.ext` |
| `authored` | raw PreTeXt in `source`, meant to be a hand-written `<latex-image>` or `<asymptote>` | `<image>` + the source, verbatim |

The transform is `transformImageAsset` in
[assetTransforms.ts:33](../packages/web-editor/src/assetTransforms.ts#L33); the archive
entry is written at
[project_archive_builder.rb:84](../app/services/project_archive_builder.rb#L84). Nothing
in the repo generates anything. An `authored` asset shows "Preview coming soon" in the
preview pane ([AssetPreview.tsx:24](../packages/web-editor/src/components/AssetPreview.tsx#L24)).

A **generated asset** is the missing third thing: authored source plus the files PreTeXt
would generate from it. The author writes PreFigure XML and watches the diagram render.
When they save, the SVG (and its companions) are stored with the asset. The document
still says `<image><prefigure label="ref">…</prefigure></image>` — true PreTeXt, buildable
anywhere — but the archive we send to the build server also contains
`source/generated/prefigure/ref.svg` and friends, and the build runs with a CLI flag
that says *keep what is already there*. The build server never runs `prefig` for a
current diagram; a downloaded project builds with a plain `pretext build` and simply
regenerates.

### What PreFigure gives us (researched 2026-10-13, extended 2026-10-19)

- **Repo:** <https://github.com/davidaustinm/prefigure>, a monorepo. The playground is
  `packages/playground/`, deployed to <https://davidaustinm.github.io/prefigure/>. PyPI
  package `prefig` 0.7.9 (pure Python wheel, 182 KB); the engine is `packages/prefig/engine.py`.
- **The playground runs the real Python package in Pyodide 0.26.4 inside a Web Worker**
  (`src/worker/compiler.ts`), with the pieces PreFigure shells out for replaced by JS
  callbacks (`src/worker/compat-api.ts`): MathJax 4 for TeX labels, speech-rule-engine +
  a liblouis build for braille, `OffscreenCanvas.measureText` for text metrics.
- **String entry point:** `engine.build_from_string(format, input_string, environment)`
  returns a **tuple** `(svg_string, annotations_xml_or_None)`. It takes no publication
  file, so docinfo `<macros>` and `<prefigure-preamble>` are not applied — core writes
  both into `pf_publication.xml` for a real build (`extract-prefigure.xsl`). Adding a
  `publication=` parameter is a small upstream PreFigure change; `mk_diagram` already
  accepts one.
- **Files a build writes** (`environment="pretext"`, `diagram.end_figure`): `<label>.svg`,
  `<label>-11.svg` (SVG 1.1, read only by the XSL-FO route: braille, `method="fo"` PDF),
  and when the author wrote `<annotations>`: `<label>-diagcess.svg` and
  `<label>-annotations.xml`. The diagcess file is the SVG with `width`/`height` removed
  and `style="aspect-ratio: W / H;"` added — derivable from the SVG in a few lines. The
  annotations file is `<diagram><annotations>…</annotations></diagram>`, exactly what the
  tuple's second item holds. PDF is `rsvg-convert` at 100 dpi over the SVG; PNG likewise.
- **The caption core injects is used only for tactile output.** `extract-prefigure.xsl`
  inserts a `pf:caption` ("Figure 2.3 (5)") into every extracted diagram; PreFigure uses it
  solely as the braille title. SVG, PDF and PNG from a pre-render without it are the same
  picture. Tactile stays with the build.
- **Pyodide-mode differences:** random SVG id prefix instead of `figure`, and annotations
  auto-generated when the author wrote none. Neither affects HTML or PDF output in a way a
  reader sees; `environment="pretext"` is what a server render should pass.
- **Cost of the browser engine:** ≈95–100 MB cold (scipy 47 MB, Pyodide core 14 MB),
  15–20 s on a cold cache, a few hundred MB of worker memory.
- **Licenses:** PreFigure is GPL-3.0; this app is AGPL-3.0, so vendoring playground code
  is compatible. `diagcess` is `UNLICENSED` on npm; load the copy PreTeXt's HTML already
  ships rather than redistributing it.

### How PreTeXt and the CLI consume it (pretext-cli 2.55.1, core 2026-10)

- Authored form: `<image><prefigure xmlns="https://prefigure.org" label="ref"><diagram>…</diagram></prefigure></image>`.
  `@label` is the output basename (`pretext-common.xsl`, `image-source-basename`); core
  warns without one. Our `REF_REGEX` (`[A-Za-z_][A-Za-z0-9_-]*`) is a valid label, so
  **the asset's ref is the label is the filename**.
- Per target the CLI needs (`constants.ASSET_FORMATS`): html/revealjs/epub → `svg`,
  pdf/latex/beamer → `pdf`, kindle → `png`, braille → `all`.
- Annotated diagrams in HTML are not an `<img>`: core emits
  `<div class="ChemAccess-element" data-src="…-diagcess.svg" data-cml="…-annotations.xml">`
  (`pretext-html.xsl` ≈6579) plus `diagcess.js`. **This is why the external form was
  abandoned**: nothing in `<image source>` can produce that markup.
- **The CLI's per-asset cache cannot be pre-seeded for PreFigure.** `generate.individual_prefigure`
  looks in `<project>/.cache/prefigure/<md5>.svg`, where the md5 is of the *extracted*
  diagram file — which carries the injected caption (enclosing block's number and a
  document-wide serial), two comments and copied indentation. Move a figure and the key
  changes. (For `latex-image` the extracted file is preamble + macros + body, so its key
  *is* position-independent — the seeding scheme in #471 is sound for that type.)
- **The hook is `ext_converter`.** `core.prefigure_conversion(…, ext_converter=…)` calls
  the CLI's `individual_prefigure(pfdiagram, outformat, tmp_dir)` per diagram, which
  checks the cache, else runs `prefig`, then core copies `tmp/output/` onto
  `generated/prefigure/`. A "keep what exists" check belongs in that function, next to
  the cache check. Same shape for `individual_latex_image`, `_asymptote`, `_sage`.
- `pretext build -q/--no-generate` skips `generate_assets` wholesale and never checks
  that `generated/` holds anything. Everything in `ASSET_TO_XPATH` is skipped — datafiles,
  QR codes, dynamic substitutions, CSL references, codelens, mermaid — not only images.
  Usable only when the document has nothing else to generate; **not** the mechanism here.
- CLI cache gap worth fixing alongside: the prefigure cache stores only `.svg` and
  `-annotations.xml`, so a cache hit on a fresh checkout lacks `-diagcess.svg` and `-11.svg`.

### Related work

- **PreTeXtPlus/PreTeXt-Plus#471** and **pretext-plus-build-full PR #12 (`/generate`, open).**
  The full server gains `POST /generate`: same archive as `/builds`, runs
  `pretext generate <types> -t <target>` on its own queue (1 CPU, 120 s), returns the
  project's `.cache/` as `<type>/<md5>.<ext>`. #471 plans to store those md5-keyed files
  and seed `.cache/` in full builds. That works for `latex-image`; for PreFigure the key
  does not survive a change of position, and `.cache` lacks the diagcess file. **With the
  `--keep-generated` flag below, the same endpoint serves every type with one mechanism**:
  have it return `source/generated/` (label-named, every companion present) instead of
  `.cache/`, store those files, ship them back. #471 should be revised to this; its
  Rails plumbing (job, HMAC callback, status) is still what Part 6 and Part 7 use.
- **The lite build server already has `POST /prefigure/`** (`PreTeXt-Plus-build/app.py`):
  `prefig.engine.build_from_string('svg', source, environment="pretext")`, with
  `prefig[pycairo]` installed. It hands the result tuple to `make_response`, so it works
  for unannotated diagrams by accident and fails for annotated ones. Fixed to return JSON
  `{svg, annotations}`, it is a second, synchronous producer with ~1 s latency.
- **Unrelated, found while reading:** `BUILD_COMMAND` on the full server seeds journal
  packages into `generated-assets/latex-packages/`; our publication file puts generated
  assets at `source/generated/`. Verify the seeding ever lands (tracked in #476's notes).

---

## Decisions

1. **A generated asset is a `file` asset with provenance and companions.** New enum value
   `kind: generated (2)` plus `assets.generator` (`"prefigure"`, later `"latex-image"`, …).
   `source` holds the generator's input (for PreFigure the `<diagram>` element, never the
   `<image>`/`<prefigure>` wrapper). The primary output stays `has_one_attached :file`
   (the SVG), so `url`, `thumbnail_url`, the asset list and `Project#full_dup` work
   unchanged. Companions — `ref-annotations.xml`, `ref-diagcess.svg`, later `ref.pdf`,
   `ref.png`, `ref-11.svg` — are `has_many_attached :renditions`, each blob's `filename`
   being exactly the name PreTeXt's generated directory uses. One digest,
   `assets.output_source_digest`, covers the set.

2. **The document always carries the source form.** `transformImageAsset` emits
   `<image>` + `<shortdescription/>` + `wrapSource(source, ref)` for every generated asset,
   for every target, for the preview. No external form, no per-target branch in the
   assembler, no `assetNeeds`. What is shipped alongside is decided in Ruby at archive
   time (decision 3). A downloaded project is ordinary PreTeXt.

3. **The archive ships current outputs into `source/generated/<type>/`, and the build is
   told to keep them.** For each generated asset whose `output_current?` holds (digest ==
   sha256 of the current render input), `ProjectArchiveBuilder` writes `file` and every
   rendition under `source/generated/prefigure/<filename>`. If it wrote any, `FullBuildJob`
   asks the server for `pretext build <target> --keep-generated prefigure`. The flag is
   per *file*: a diagram shipped as `.svg` only still gets its `.pdf` generated for a PDF
   target; a stale asset is simply not shipped and is generated like today. **A stale
   picture is never shipped; the document is always buildable.** This is also what makes
   collaboration safe: a peer who edits the source without an engine just invalidates
   the output.

4. **`--keep-generated` is an upstream pretext-cli feature, not a server hack** (Part 0).
   It is useful to anyone who commits a `generated/` directory, and it is the one piece
   this whole plan depends on. Until it is released, the full server can run the same
   builds without the flag (correct, just slower) — nothing here is blocked on it except
   the speedup itself.

5. **Outputs may come from any producer; the store does not care.** Phase 1 uses the full
   server's `/generate` (PR #12) returning label-named files, because it is the real
   pipeline — every companion, every format, docinfo macros applied — and the Rails
   plumbing for it is already designed (#471). Part 4 adds the browser engine for live
   rendering while typing, which can also produce the stored SVG for HTML targets. PDF and
   PNG always come from a server. The digest rule is the same whoever rendered.

6. **The browser engine runs in a Web Worker we own, built from the playground's worker
   code, loaded explicitly, once per page.** Unchanged from the draft: Pyodide from
   jsDelivr, `prefig`/`segno` wheels from `public/`, a separate esbuild entry, a **Load
   PreFigure engine (~100 MB, first time only)** button, one shared runtime disposed after
   a long idle. Never auto-loaded.

7. **The generator abstraction is a registry, like `editorConfigs`.** One `AssetGenerator`
   per generator: id, label, Monaco language, starter source, `wrapSource`, the list of
   output filenames it owns, `renderInput(source, docinfo)` (what gets digested), and an
   optional browser `createRuntime`. Nothing outside the registry names a generator.

8. **Output upload rides the existing save pipeline.** The host already multipart-PATCHes
   `project[assets_attributes][0][file]` (`patchProjectAssetUpload`,
   [editor.jsx:797](../app/javascript/controllers/react/editor.jsx#L797)); renditions and
   the digest travel in the same `assets_attributes[i]`. For server-produced outputs the
   job attaches them directly.

---

## Part 0 — pretext-cli: `--keep-generated`

In PreTeXtBook/pretext-cli. Small, self-contained, and the first thing to do because the
rest can be verified against it with a hand-placed file and no Rails code.

- **Option.** `pretext build` and `pretext generate` gain `--keep-generated TEXT`
  (repeatable; asset type names from `constants.ASSETS`, or `all`). Help text: *"Do not
  regenerate an asset of this type whose output file(s) already exist in the generated
  directory. For projects that commit or pre-populate `generated/`."*
- **Plumbing.** `Target.build(keep_generated=…)` → `generate_assets(keep_generated=…)` →
  each `partial(generate.individual_<type>, …)` gets `generated_dir=self.generated_dir_abspath() / "<type>"`
  and `keep_generated: bool`.
- **Behaviour**, in each `individual_*` before the cache check, per requested format:
  if `keep_generated` and `generated_dir / output_file.name` exists (for prefigure
  tactile: `generated_dir / "tactile" / …`), log `Keeping existing <file>` and `continue`.
  Nothing is copied — the file is already where core will copy `tmp/output` onto. For
  `latex-image` with `outformat="all"`, keep only if every format exists (mirrors its
  cache rule).
- **Companions.** For prefigure `svg`, keep only when `<stem>.svg` exists; the caller is
  responsible for `-annotations.xml`/`-diagcess.svg`. While there, make the cache copy
  `-diagcess.svg` and `-11.svg` too (the gap noted above).
- **Hash table.** `.<target>_assets.json` is untouched: extraction still runs (cheap XSLT),
  the per-type hash is still saved. `--keep-generated` and `-g` together: `-g` wins, warn.
- **Tests.** `tests/`: a project with one prefigure diagram and a pre-placed
  `generated/prefigure/<label>.svg`; `pretext build web --keep-generated prefigure` runs
  no `prefig` (assert the log) and the SVG in `output/` is the pre-placed one; without the
  flag it is regenerated; a PDF target with only `.svg` present generates `.pdf`.

Full build server (pretext-plus-build-full), after the CLI release reaches the warm image:
`POST /builds` gains `keep_generated` (comma/space list, validated against the same
shell-safe asset-name check PR #12 added); `BUILD_COMMAND` gains a `{flags}` slot;
`run_build` fills it with `--keep-generated <names>` or nothing. Unknown names → 422.

---

## Part 1 — Model and storage (Rails)

### 1.1 Migration

```ruby
add_column :assets, :generator, :string              # nil for file/authored
add_column :assets, :output_source_digest, :string   # sha256 of the render input the outputs were built from
```

`kind` gains `generated: 2` — additive, integer enums are never renumbered
(`docs/build-targets.md`, Traps). `has_many_attached :renditions`. No backfill.

### 1.2 `Asset`

- `GENERATORS = %w[ prefigure ].freeze`; validate `generator` present and in the list iff
  `generated_kind?`, absent otherwise.
- `render_input` → the string the digest is over. For prefigure:
  `[source, docinfo_macros, docinfo_prefigure_preamble].join("\n\u0000\n")`, with the two
  docinfo pieces read from `project.effective_docinfo` by Nokogiri. The editor computes
  the identical string (Part 2); **one definition per generator, spelled identically in
  Ruby and TypeScript, with a fixture test that pins both to the same hex.**
- `output_current?` → `file.attached? && output_source_digest == Digest::SHA256.hexdigest(render_input)`.
  The single predicate decision 3 hangs on. A docinfo edit therefore invalidates every
  PreFigure output, which is correct: macros are an input.
- `generated_files` → `[[filename, blob], …]`: `["#{ref}.svg", file.blob]` plus each
  rendition `[rendition.filename.to_s, rendition.blob]`. Rendition filenames are
  validated to start with `"#{ref}."` or `"#{ref}-"` — a rename of the asset renames
  them (`ref` is the label is the basename).
- `CONTENT_TYPE_EXTENSIONS` already maps `image/svg+xml → svg`, so `external_filename`
  is `ref.svg`. Not used for generated assets' archive path, but the asset list and `url`
  keep working.
- Guard: a generated asset's `file` must be `image/svg+xml`; renditions must be
  `image/svg+xml`, `application/xml`/`text/xml`, `application/pdf` or `image/png`.
- Quota counts rows, not bytes; a generated asset is one row. Fine for now.

### 1.3 Archive and build submission

- `ProjectArchiveBuilder#build`: after the `external/` loop,
  `@project.assets.generated_kind.select(&:output_current?)` → for each
  `generated_files` entry write `source/generated/#{asset.generator}/#{filename}`.
  Record `kept_generators` (the set of generator ids that shipped anything) on the
  builder. The `generated` directory is already declared in `PublicationFileBuilder::BASE`.
- `FullBuildJob`: add form field `keep_generated` = `kept_generators.join(",")` when
  non-empty. Until the server/CLI support it, the field is ignored and the build
  regenerates — still correct.
- `projects#download` hands authors the same archive: a downloaded project carries its
  generated files and builds with or without the flag.
- `ProjectDocProjection` (Yjs → rows) and `Project#full_dup` carry the two columns and
  copy renditions (blobs shared, as `file` already is).

### 1.4 Params and JSON

- `projects_controller.rb:443` permits `generator`, `output_source_digest`, `file`, and
  `renditions: []` on `assets_attributes`. The digest is client-supplied when the browser
  rendered — a statement about which input the bytes match; `output_current?` is what
  consumes it, never a boolean off the row.
- `_asset.json.jbuilder` adds `generator`, `outputSourceDigest`, `renditions` (filename +
  url). `railsAssetToEditor` maps them; the editor computes currency itself.

### 1.5 Tests

`asset_test.rb`: enum/validation matrix; `output_current?` flips on a source edit and on
a docinfo macros edit; rendition filename rule. `project_archive_builder_test.rb`: a
current generated asset lands at `source/generated/prefigure/ref.svg` + companions and
`kept_generators == ["prefigure"]`; a stale one ships nothing and the set is empty.
`full_build_job_test.rb`: `keep_generated` field present iff the set is non-empty.
Digest fixture shared with the web-editor test (2.4).

---

## Part 2 — The generator registry and assembly (web-editor)

### 2.1 `src/generators/`

```ts
export interface AssetGenerator {
  id: GeneratorId;                       // "prefigure" | "latex-image"
  label: string;                         // "PreFigure"
  language: "xml" | "latex";             // Monaco language for the source buffer
  starterSource: string;
  /** The PreTeXt child of <image> for this source. The only form the document ever carries. */
  wrapSource(source: string, ref: string): string;
  /** The exact string whose sha256 is output_source_digest. Must match Asset#render_input. */
  renderInput(source: string, docinfo: string): string;
  /** Output filenames this generator owns, for a given ref. */
  outputFilenames(ref: string, opts: { annotated: boolean }): string[];
  /** Optional browser runtime (Part 4). Absent → server-rendered only. */
  createRuntime?(opts: GeneratorRuntimeOptions): GeneratorRuntime;
}
```

`prefigure.wrapSource` → `<prefigure xmlns="https://prefigure.org" label="${ref}">${source}</prefigure>`.
`starterSource` is a small axes-and-graph diagram with one TeX label.

### 2.2 `Asset` type and `transformImageAsset`

[editor.ts:5](../packages/web-editor/src/types/editor.ts#L5) gains `generator?`,
`outputSourceDigest?`, `renditions?`. `isFile` stays `kind === "file"`; a generated asset
is `isFile: false, generator: "prefigure"`.

```
generated       →  <image>\n<shortdescription/>\n{wrapSource(source, ref)}\n</image>
file / authored →  unchanged
```

That is the whole change to assembly. `assetWrapperLines` draws the same wrapper as the
locked virtual lines around the buffer, so what the author sees is what is assembled.

### 2.3 Verbatim and spell-check scopes

`VERBATIM_SOURCES` ([sectionUtils.ts:1773](../packages/web-editor/src/sectionUtils.ts#L1773))
gains `prefigure`; the spell checker's `xmlRegions` treats it like `latex-image`.

### 2.4 Tests

- `assetTransforms.test.ts`: generated → source form, for every registry entry, with the
  placeholder's `@width` copied onto the `<image>`.
- Each `starterSource` wrapped by `wrapSource` inside `<image>` validates against the real
  PreTeXt schema (it already includes `pf-adapter.rnc`).
- `renderInput` digest fixture: same source + docinfo → the hex `asset_test.rb` pins.

---

## Part 3 — Creating and editing a PreFigure asset

### 3.1 The creation tab

`NewAssetForm` grows one tab per registry entry after **Custom**: **PreFigure**. It asks
for a title (ref derived, as Custom does) and calls `onCreateGenerated(generator, title)`.
Host: `onCreateGenerated` in `editor.jsx`, sibling of `onCreateAuthored`
([editor.jsx:1021](../app/javascript/controllers/react/editor.jsx#L1021)), sends
`{ ref, kind: "generated", generator, title, source: starterSource }`. The starter is
persisted on create so a peer or a reload sees the same thing.

### 3.2 The buffer

`resolveEditorTarget` already hands the code editor `asset.source` with
`lockStructure={false}`. The Monaco language comes from the registry; the locked wrapper
is `<image>` / `<prefigure … label="ref">` … `</prefigure>` / `</image>`. The title-bar
chip says **PreFigure** and, from Part 5, whether the stored output is current.

### 3.3 Settings drawer

Generator shown read-only; **Replace image…** hidden (replacing a generated picture is
editing its source); **Duplicate** copies source + generator, no files; **Download SVG**
is the existing `url`; a **Render now** action enqueues the server render (Part 5.2).

---

## Part 4 — The browser engine and the preview pane

### 4.1 The worker

`packages/web-editor/src/generators/prefigure/worker/`, ported from the playground's
`compiler.ts`, `compat-api.ts`, `index.ts` and `liblouis/`, with a NOTICE (Jason Siefken /
David Austin, GPL-3.0). Comlink stays. Changes from the playground: Pyodide `indexURL`
from jsDelivr by default, overridable; wheel URLs from the host
(`/assets/prefigure/prefig-0.7.9-py3-none-any.whl`, copied by `script/copy-static-assets.js`,
version pinned in one constant with a test); `loadPackage` not `micropip`; progress
events forwarded. Own esbuild entry (`app/javascript/prefigure-worker.js`), created with
`new Worker(url, { type: "module" })`; the web-editor gets the URL through a
`generatorRuntimes` prop; without it the engine button is absent and the pane is
server-rendered only.

`render()` returns the SVG and annotations from `build_from_string` plus the derived
diagcess SVG, as `{ filename, blob }[]` named by `outputFilenames`. Until PreFigure's
`build_from_string` accepts a publication, the worker prepends docinfo macros itself the
way `pf_publication.xml` does (or the browser output is marked not-current when the
docinfo has macros — decide once the upstream parameter is in or out).

### 4.2 `GeneratedAssetPreview`

`AssetPreview` branches on `asset.generator`. States:

1. **Stored output.** The SVG at `url` (annotated: an iframe with diagcess, below), a
   "rendered from the current source" / "source changed since this was rendered" line,
   **Render on server** (Part 5.2) and **Load PreFigure engine (~100 MB)**.
2. **Rendering** (engine loaded). Debounced 1 s, latest-wins queue, previous render stays
   visible, diagnostics strip with PreFigure's error text.
3. **Rendered.** `<iframe srcdoc sandbox="allow-scripts">` with the playground's wrapper
   (`ChemAccess-element` + `diagcess.Base.init(true)`), `diagcess.js` from the copy
   PreTeXt core ships, Braille29 font for tactile. **SVG / Tactile** toggle; tactile is
   preview-only.

### 4.3 Preview resolution for the document preview

The live preview's HTML now references `generated/prefigure/ref.svg` (and the diagcess
pair) relative to the project, as a build's does. Add
`get "(*_)/generated/:generator/:filename" => "assets#generated_file"` beside the
`external/:ref` route ([routes.rb:194](../config/routes.rb#L194)), resolving `filename`
through `Asset#generated_files` and redirecting to the blob. Pending (unsaved) browser
renders are answered from memory by a `rewriteAssetUrls` resolver in the preview
(pretext-html already exports it), exactly as the draft planned for `external/`.

### 4.4 Resource hygiene

One runtime per page, disposed after ~10 min idle; serialized renders; Pyodide needs no
JSPI so Firefox/Safari get it too.

---

## Part 5 — Producing and saving outputs

### 5.1 Browser-rendered

`EditorContentChange` for an asset gains an optional `outputs: { filename, blob }[]` and
`outputSourceDigest`, attached **only when the digest equals `sha256(renderInput)` of the
source being reported**. The host's working copy keeps `pendingAssetOutputs`, latest
wins; the bulk save becomes the multipart form `patchProjectAssetUpload` already builds
when any are pending — `file` = `ref.svg`, `renditions[]` = the rest, plus `source` and
`output_source_digest`, one `assets_attributes[i]`. Autosave uploads at most one set per
asset per 10 s.

### 5.2 Server-rendered (`GenerateAssetJob`)

The job #471 designs, pointed at label-named output:

- Build a one-figure archive with the project's real docinfo and publication
  (`ProjectArchiveBuilder#generate_archive(asset)`, same class as `#build` so layout
  cannot drift), containing the asset in source form.
- `POST /generate` with `assets=prefigure`, `target=web` (or `print` for `.pdf`,
  `kindle` for `.png`), `callback_url`. The server returns `source/generated/prefigure/`
  (PR #12 to be adjusted: output subdir selectable, `generated` alongside `.cache`).
- On success, attach `ref.svg` as `file`, the rest as `renditions`, set
  `output_source_digest = sha256(render_input)` **computed at enqueue time** so a source
  edit during the render leaves the result stale rather than wrongly current.
- Triggered by: **Render now**, asset create (so a new asset has a picture before anyone
  loads an engine), and a `source_updated_at`-debounced job on save when no browser
  output arrived. Idempotent on `(asset_id, digest)`.

### 5.3 Server side

Nested attributes + ActiveStorage; `touch: :source_updated_at` already marks targets
stale. Nothing new beyond the renditions attachment and the guard in 1.2.

---

## Part 6 — PDF and PNG

`GenerateAssetJob` with `target=print` yields `ref.pdf` (and `kindle` → `ref.png`) as
renditions, each covered by the same digest. The archive ships them; `--keep-generated
prefigure` keeps them; a PDF build runs no `prefig` and no `rsvg-convert`. Browser renders
never produce these, so an asset rendered only in the browser still gets its PDF
generated at build time until the job has run — correct either way.

---

## Part 7 — The second generator: `latex-image`

`latex-image` cannot run in the browser, so it has no `createRuntime`; Part 5.2 is its
only producer, with `assets=latex-image` and the project's `<latex-image-preamble>` +
`<macros>` in `renderInput`. `wrapSource` is `<latex-image>${source}</latex-image>`;
`outputFilenames` is `[ref.svg]` for HTML (a PDF target compiles it inline, `ASSET_FORMATS`
needs nothing). The archive ships `source/generated/latex-image/ref.svg` and the build
runs `--keep-generated prefigure,latex-image`. **#471's `.cache` seeding is not needed**:
one mechanism, one flag, for both. Existing `authored` assets that are a bare
`<latex-image>` can be migrated by unwrapping; a rake task, not part of this plan.

---

## Sequencing and the proof of concept

| Step | Where | Depends on | Proves |
| --- | --- | --- | --- |
| 0 | pretext-cli `--keep-generated` | — | the CLI keeps a hand-placed `generated/prefigure/x.svg` and runs no `prefig` |
| 1 | Rails model + archive + `keep_generated` field | — | an asset created in the console with a hand-rendered SVG builds with no `prefig` in the log |
| 1b | full server `{flags}` passthrough | 0 released | same, against the deployed server |
| 2 | registry + source-form assembly + create tab + buffer | 1 | authors can write PreFigure; builds generate it (already better than `authored`) |
| 3 | preview route + `GenerateAssetJob` via `/generate` (PR #12 adjusted) | 2 | **the feature**: picture stored on save, HTML and PDF builds skip `prefig` |
| 4 | browser engine + live pane + browser-rendered save | 2 | live rendering while typing |
| 5 | `latex-image` | 3 | second generator |

Steps 0 and 1 are independent and together are the proof of concept: no editor work,
one console-created asset, one website build, one log line missing. Step 0 is a day in
pretext-cli; step 1 is a day here. Step 3 before step 4 on purpose — the server producer
is the real pipeline and ships value with far less risk; the Pyodide port is the long
pole and is pure UX once 3 exists.

---

## Open questions

| Question | Blocks | Suggested answer |
| --- | --- | --- |
| `build_from_string(publication=…)` upstream in PreFigure? | Part 4 | Propose it; until then the worker applies macros itself or marks output not-current when docinfo has macros. |
| PR #12: return `generated/` instead of (or as well as) `.cache/`? | Part 5.2 | As well as, selected by a form field; `.cache` stays for #471's latex-image use if anyone still wants it. |
| Should a docinfo edit re-render every PreFigure asset automatically? | Part 5.2 | Yes, debounced, one job per stale asset; cheap on the generate queue. |
| Pyodide from jsDelivr or self-hosted? | Part 4 | jsDelivr; `pyodideIndexUrl` is a prop if a network blocks it. |
| Is `diagcess` redistribution acceptable? | Part 4 | Load PreTeXt's shipped copy; ask Volker Sorge before vendoring. |
| Should `tryit` get PreFigure? | Part 4 | No — nothing to save to. |

## Traps

- **`output_source_digest` is a claim, not a fact.** Compare to `sha256(render_input)` at
  the moment of use; never read a boolean off the row.
- **`render_input` is defined twice, in Ruby and TypeScript.** Pin both to one fixture hex.
  Trim nothing, normalize nothing in one place that the other does not.
- **Macros are an input.** A render that ignored docinfo macros must not be marked current
  for a document that has them.
- **Never pass `-q`.** It skips datafiles, QR codes, substitutions and references too.
- **Ref is label is basename.** Renaming an asset renames every rendition filename; the
  validation in 1.2 enforces it. Embedding one asset twice puts the same `@label` in the
  document twice — verify in step 2 that core tolerates this (it extracts to one file).
- **Assembly is synchronous.** Keep the digest on the pool entry, never hash inside
  `transformImageAsset`.
- **Never auto-load the engine** on open, hover or project load.
- **Esbuild has no code splitting here.** Pyodide-, MathJax- or liblouis-sized code is a
  separate entry or a runtime fetch.
- **`VERBATIM_SOURCES` must include `prefigure`** or a `<plus:` string in a label is
  mis-parsed as a placeholder.
- **The generated-output iframe is sandboxed; `LivePreview` is not.** Do not unify them.
- **`-11.svg` is not derivable from the string API.** Braille targets of an annotated
  diagram still run `prefig` until the server producer has rendered; that is fine.
