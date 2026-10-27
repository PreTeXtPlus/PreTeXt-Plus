# Generated assets

Plan of record for assets whose picture is *computed from source* — PreFigure first,
`latex-image` after — where the author writes the generator's source in the editor and
watches the picture render, the document carries that source as ordinary PreTeXt, and
builds generate the picture from it like any other PreTeXt asset.

**Status:** decided 2026-10-19, revised 2026-10-27 after three things changed under it:
the Content model (#480), the full build server's own asset cache and `/generate`
route, and the PreFigure maintainer's advice to use the repo's rust-wasm build. The
first version of this plan shipped the browser's picture to the build server with a
`--keep-generated` flag so builds would not rerun the generator; that is gone — the
build server caches generated assets per project itself, so nothing here is a build
input. **The browser render is a preview.**

## What exists (2026-10-27)

On the `generated-assets-plan` branch, rebased onto #480's head, verified in a headless
Chromium against the dev server: a PreFigure asset is created from its tab, the wasm
engine starts when the asset opens, the diagram renders with MathJax labels as the
author types, the SVG is stored with the asset and the server reads it as current.

| Part | State |
| --- | --- |
| 1 Rails model / JSON | Done. `Content#kind: generated_asset (4)`, `generator`, `output_source_digest`, `render_input`, `output_current?` (`Content::GeneratedAssetBehavior`); the picture is the content's one file. |
| 2 registry + assembly | Done. `packages/web-editor/src/generators/`; generated assets always assemble to the source form; `prefigure` is verbatim for ref scanning and code for spell check. |
| 3 create/edit UI | Done. PreFigure tab, generator shown in settings, Replace/Duplicate hidden, Download SVG. |
| 4 browser engine + pane | Done for SVG. PreFigure's `prefig-wasm` (MathJax variant, 1.3 MB) vendored under `vendor/prefigure`, MathJax 4 in the worker with the docinfo `<macros>` in scope. **No tactile/braille**, **no diagcess iframe** (the pane shows the SVG as an image). |
| 4.3 document preview | **Not started.** The live document preview renders `<image><prefigure>` through pretext-html, which looks for `generated/prefigure/<ref>.svg`; the preview worker is not given the stored picture yet. |
| 5 browser-rendered save | Done, as a multipart PATCH per render (`onAssetOutput`): the SVG as `file` + the digest. |
| 6 `latex-image` via `/generate` | Not started. |

## Context

A `Content` that is an asset ([content.rb](../app/models/content.rb)) is one of three things:

| kind | what it is | how it is assembled |
| --- | --- | --- |
| `file_asset` | uploaded bytes | `<image source="ref.ext">`; the bytes land in `source/external/ref.ext` |
| `authored_asset` | raw PreTeXt in `source` (a hand-written `<latex-image>`, say) | `<image>` + the source, verbatim |
| `generated_asset` | source for a `generator` in `source`, plus the picture rendered from it as the file | `<image>` + `wrapSource(source, ref)`: `<prefigure label="ref">…</prefigure>` |

The picture of a generated asset is what the asset list thumbnails, what a peer without
an engine or a reload sees, and the "current / stale" line in the preview pane. The
archive ships nothing for it: the build server generates the asset from the document's
source and keeps it in the project's cache (below).

### PreFigure's wasm engine (2026-10-27)

- **Repo:** <https://github.com/davidaustinm/prefigure>, a monorepo. `packages/prefig-wasm`
  compiles the Rust port (`packages/prefig-rust`) to WebAssembly; the playground offers
  it beside Pyodide. The maintainer's advice is to use it; it tracks the Python package
  (0.7.9), with every handler ported except `<circuit>` (`prefig-rust/PORTING.md`).
- **API** (`prefig-wasm/src/lib.rs`): `default(init)`, `set_host_api(api)`, `version()`,
  `build_from_string("svg" | "tactile", source) → { svg, annotations | null }`. The
  `environment` is fixed to `"pyodide"` (random id prefix, annotations invented when the
  author wrote none); neither matters for a preview.
- **Two variants, one API.** *MathJax* (`pkg-web`, default): the host's `processMath`
  typesets labels — what a real build does too, so labels look alike; 1.3 MB. *RaTeX*
  (`--features ratex`): math rendered in-module, KaTeX-styled, no MathJax; 4.4 MB. We
  vendor the MathJax variant. Both still ask the host for `measure_text` (canvas) and,
  for tactile only, `translate_text`/`processBraille`.
- **Not published.** No npm package, no GitHub release: the playground's CI builds it
  with `wasm-pack` and bundles it. `script/build-prefig-wasm.sh` clones the repo at a
  pinned commit and writes `vendor/prefigure/` (needs `cargo` with the
  `wasm32-unknown-unknown` target and `wasm-pack`; the devcontainer provides both).
- **Macros.** The wasm host path ignores `add_macros`, so the worker puts the docinfo
  `<macros>` in scope itself by prepending them to every expression MathJax typesets
  (`compat-api.ts`). That is why `render_input` includes the macros: they are an input.
- **Licenses:** PreFigure is GPL-3.0; this app is AGPL-3.0.

### The full build server (pretext-plus-build-full, 2026-10-22)

- **Per-project asset cache.** A build names its `project_id` (sent since #478) and the
  server bind-mounts that project's persistent cache over the CLI's `.cache/<type>`
  dirs, so an asset generated by an earlier build is copied, not regenerated.
- **`POST /generate`.** Same archive as `/builds`; runs `pretext generate <types> -t
  <target>` on its own quick queue and returns the CLI's `.cache/` (md5-keyed files),
  harvesting them into the project's cache too. This is the producer for generators
  that cannot run in the browser (Part 6) — a previewed figure is then already cached
  when the full build runs.
- Nothing in this app needs to ship generated files or pass flags; both ideas from the
  first plan are retired.

### How PreTeXt consumes it (unchanged)

- Authored form: `<image><prefigure xmlns="https://prefigure.org" label="ref"><diagram>…</diagram></prefigure></image>`.
  `@label` is the output basename; our `REF_REGEX` is a valid label, so **the asset's
  ref is the label**.
- Annotated diagrams in HTML are not an `<img>`: core emits a `ChemAccess-element` div
  reading `-diagcess.svg` and `-annotations.xml`. Builds make those; the preview does not.

---

## Decisions

1. **A generated asset is a `Content` of kind `generated_asset` with a `generator` and
   one file.** `source` holds the generator's input (for PreFigure the `<diagram>`
   element, never the `<image>`/`<prefigure>` wrapper). The picture is the content's
   single attachment, so `url`, `thumbnail_url`, the asset list, `external/:ref` and
   `Project#full_dup` work unchanged. `attachments_fit_kind` admits it; it must be SVG.

2. **The document always carries the source form.** `transformImageAsset` emits
   `<image>` + `<shortdescription/>` + `wrapSource(source, ref)` for every generated
   asset, for every target, for the preview. A downloaded project is ordinary PreTeXt.

3. **The picture is a preview, with a currency claim.** `output_source_digest` is the
   sha256 of `render_input` (source + the docinfo elements the generator reads) the
   picture was built from; `output_current?` compares it to the input as it is now.
   Nothing reads a boolean off the row. A peer who edits the source without an engine
   simply makes the digest mismatch.

4. **Builds regenerate; the build server's cache makes that cheap.** No archive
   shipping, no flags, no CLI change.

5. **The browser engine is PreFigure's wasm build, MathJax variant, in a Web Worker we
   own,** ported from the playground's worker: the glue and binary served from
   `public/assets/prefigure/`, MathJax 4 bundled in the worker, one shared runtime per
   page, started when a generated asset's pane mounts (it is a few megabytes, so no
   "load" button). Never on page load.

6. **The generator abstraction is a registry, like `editorConfigs`.** One
   `AssetGenerator` per generator: id, label, Monaco language, starter source,
   `wrapSource`, `docinfoInputElements`, optional `createRuntime`. Nothing outside the
   registry names a generator.

7. **The picture rides the existing upload pipeline.** `onAssetOutput` sends
   `assets_attributes[0]` with `id`, `file` (the SVG) and `output_source_digest` through
   `patchProjectAssetUpload`, once per distinct digest, only for a render of the source
   as it is now.

---

## Part 1 — Model (Rails) — done

Migration on `contents`: `generator`, `output_source_digest`. `kind` gains
`generated_asset: 4` (additive; integer enums are never renumbered). The legacy spelling
`generated` is accepted like `file`/`authored`. `Content::GeneratedAssetBehavior`:
`GENERATORS`, `DOCINFO_INPUT_ELEMENTS` (`prefigure → macros, prefigure-preamble`),
`render_input`, `docinfo_element_inner` (regex, not Nokogiri, so the browser produces the
same bytes), `output_current?`, SVG-only validation. JSON adds `generator`,
`output_source_digest`, `output_current`. **The render input is defined twice, in Ruby
and TypeScript; one fixture hex pins both** (`content_test.rb`, `generators.test.ts`).

## Part 2 — Registry and assembly (web-editor) — done

`src/generators/`: `types.ts`, `index.ts` (`generators`, `runtimeFor`), `renderInput.ts`,
`prefigure/definition.ts`. `VERBATIM_SOURCES` and the spell checker's `latexImage` scope
list `prefigure`.

## Part 3 — Creating and editing — done

`NewAssetForm` grows one tab per registry entry → `onCreateGenerated(generator, title)`;
the host persists `kind: "generated_asset"`, the generator and the starter source.
Settings show the generator; Replace and Duplicate are hidden; Download SVG is `url`.

## Part 4 — Engine and pane — done for SVG

`prefigure/runtime.ts` (main thread: load once, latest-wins render queue),
`prefigure/worker/` (`protocol.ts` pins the engine's filenames and version;
`handler.ts` imports the glue from the host's URL, `init`s the binary, `set_host_api`;
`compat-api.ts` is the host: MathJax, canvas text metrics, macros). The host bundles
`src/prefigureWorker.ts` as `app/javascript/prefigure_worker.js` and passes
`prefigureWorkerUrl` + `prefigureAssetsUrl`. `GeneratedAssetPreview.tsx`: stored picture
and whether it matches, auto-start, debounced render, error strip, retry on a failed
load. `__tests__/prefigureWasm.test.ts` drives the real vendored engine through the
handler with a stub host in Node.

### 4.3 Document preview (follow-up)

The live preview's HTML references `generated/prefigure/ref.svg` relative to the
project. Give the preview worker's mount reader the stored pictures (pending browser
renders answered from memory, saved ones from `external/:ref`), so a section embedding a
PreFigure asset shows it. Until then the document preview shows a broken image for a
generated asset while the asset's own pane shows the diagram.

## Part 6 — `latex-image` via `/generate`

`latex-image` cannot run in the browser, so it has no `createRuntime`. A
`GenerateAssetJob` builds a one-figure archive with the project's real docinfo and
publication, POSTs `/generate` with `assets=latex-image`, `target=web`, the
`project_id` and a callback, and on success attaches the returned SVG as the asset's
file with `output_source_digest` computed **at enqueue time** (so a source edit during
the render leaves the result stale rather than wrongly current). `wrapSource` is
`<latex-image>${source}</latex-image>`; `docinfoInputElements` is `latex-image-preamble`
+ `macros`. The full build then finds the figure already in the project's cache.
Existing `authored` assets that are a bare `<latex-image>` can be migrated by
unwrapping; a rake task, not part of this plan.

---

## Open questions

| Question | Blocks | Suggested answer |
| --- | --- | --- |
| Build `vendor/prefigure` from source or take the playground's deploy? | — | From source via `script/build-prefig-wasm.sh` (the devcontainer now has the toolchain); the current files are a stopgap from the deploy, noted in `vendor/prefigure/BUILD`. |
| MathJax or RaTeX variant? | — | MathJax: labels look like a build's and MathJax is already in the worker. RaTeX drops MathJax (smaller worker bundle, bigger wasm) at the cost of KaTeX-styled labels. |
| Should a docinfo macros edit re-render every PreFigure asset? | — | Only the open one renders; the rest show "source changed" until opened. Fine. |
| Is `diagcess` redistribution acceptable for an annotated preview? | 4 | Load PreTeXt's shipped copy; ask Volker Sorge before vendoring. |
| Should `tryit` get PreFigure? | 4 | No — nothing to save to. |

## Traps

- **`output_source_digest` is a claim, not a fact.** Compare to `sha256(render_input)` at
  the moment of use; never read a boolean off the row.
- **`render_input` is defined twice, in Ruby and TypeScript.** Pin both to one fixture hex.
  Trim nothing, normalize nothing in one place that the other does not.
- **Macros are an input.** The worker prepends them to every label; a change to them is a
  change to the picture, and the digest says so.
- **Ref is label is basename.** Embedding one asset twice puts the same `@label` in the
  document twice; core extracts to one file.
- **Assembly is synchronous.** Keep the digest on the pool entry, never hash inside
  `transformImageAsset`.
- **Never auto-load the engine on page load** — only when a generated asset's pane mounts.
- **Esbuild has no code splitting here.** MathJax rides in the worker bundle; the wasm is a
  runtime fetch; neither belongs in `application.js`.
- **`VERBATIM_SOURCES` must include `prefigure`** or a `<plus:` string in a label is
  mis-parsed as a placeholder.
- **The vendored engine and `PREFIG_WASM_VERSION` move together.** The handler warns on
  a mismatch; `prefigureWasm.test.ts` fails on one.
