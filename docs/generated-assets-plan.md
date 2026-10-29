# Generated assets

Plan of record for assets whose picture is *computed from source* — PreFigure first,
then TikZ and other `latex-image`s — where the author writes the generator's source in the editor and
watches the picture render, the document carries that source as ordinary PreTeXt, and
builds generate the picture from it like any other PreTeXt asset.

**Status:** decided 2026-10-19, revised 2026-10-27 after three things changed under it:
the Content model (#480), the full build server's own asset cache and `/generate`
route, and the PreFigure maintainer's advice to use the repo's rust-wasm build. The
first version of this plan shipped the browser's picture to the build server with a
`--keep-generated` flag so builds would not rerun the generator; that is gone — the
build server caches generated assets per project itself, so nothing here is a build
input. **The browser render is a preview.** Revised again 2026-10-29: a generated asset
is no longer a kind of its own but an authored asset whose `source_format` is a
generator's (Decision 1). Extended 2026-10-29 with TikZ as the second generator with a
browser preview (Part 7), after a survey of browser TeX engines.

## What exists (2026-10-27)

On the `generated-assets-plan` branch, rebased onto #480's head, verified in a headless
Chromium against the dev server: a PreFigure asset is created from its tab, the wasm
engine starts when the asset opens, the diagram renders with MathJax labels as the
author types, the SVG is stored with the asset and the server reads it as current.

| Part | State |
| --- | --- |
| 1 Rails model / JSON | Done. An `authored_asset` with `source_format: prefigure (3)`; `preview_input_digest`, `render_input`, `preview_current?`, `generated_element` (`Content::GeneratedAssetBehavior`); the picture is the content's one file. |
| 2 registry + assembly | Done. `packages/web-editor/src/generators/`; generated assets always assemble to the source form; `prefigure` is verbatim for ref scanning and code for spell check. |
| 3 create/edit UI | Done. PreFigure tab, generator shown in settings, Replace/Duplicate hidden, Download SVG. |
| 4 browser engine + pane | Done for SVG. PreFigure's `prefig-wasm` (MathJax variant, 1.3 MB) vendored under `vendor/prefigure`, MathJax 4 in the worker with the docinfo `<macros>` in scope. **No tactile/braille**, **no diagcess iframe** (the pane shows the SVG as an image). |
| 4.3 document preview | Done for stored pictures: `generated/:element/:ref.svg` serves the asset's stored picture, which is where pretext-html's `<img>` points. A render not yet stored is not shown there. |
| 5 browser-rendered save | Done, as a multipart PATCH per render (`onAssetOutput`): the SVG as `file` + the digest. |
| 6 `latex-image` via `/generate` | Not started. |
| 7 TikZ | Not started. Planned below; the browser engine waits on a spike (7.3). |

## Context

A `Content` that is an asset ([content.rb](../app/models/content.rb)) is one of three things:

| kind | what it is | how it is assembled |
| --- | --- | --- |
| `file_asset` | uploaded bytes | `<image source="ref.ext">`; the bytes land in `source/external/ref.ext` |
| `authored_asset`, `source_format: pretext` | raw PreTeXt in `source` (a hand-written `<latex-image>`, say) | `<image>` + the source, verbatim |
| `authored_asset`, a generator's `source_format` (`prefigure`) — a *generated asset* | the generator's input in `source`, plus the picture rendered from it as the file | `<image>` + `wrapSource(source, ref)`: `<prefigure label="ref">…</prefigure>` |

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

### How PreTeXt builds a `latex-image` (2026-10-29)

- `extract-latex-image.xsl` writes one document per image: `\documentclass[<font-size>]{article}`
  with `geometry`; `\usepackage{amsmath,amssymb}`; the first `<latex-image-preamble>`
  *without `@syntax`*; `\ifdefined\tikzset \tikzset{ampersand replacement = \amp}\fi`; the
  docinfo `<macros>`; then the image's text in `\resizebox{\width}{\height}{…}` on an
  empty page.
- The CLI compiles it with the project's `latex-engine`, **xelatex unless one is set**,
  crops the PDF (pdfCropMargins) and converts it with PyMuPDF, which writes glyphs as
  paths (`individual_latex_image_conversion` in core's `pretext.py`). Under xelatex the
  text font is Latin Modern; math is Computer Modern either way.
- `@label` on `<latex-image>` is the output basename, as for PreFigure
  (`image-source-basename` in pretext-common.xsl); pretext-html refers to
  `generated/latex-image/<label>.svg`.
- Our assembly puts `\usepackage{tikz, pgf}` (`DEFAULT_LATEX_IMAGE_PREAMBLE`) first in that
  preamble for every build, adding the element when there is none.

### TikZ in the browser (surveyed 2026-10-29)

| Engine | What runs | Text in the SVG | Packages | First load | Status |
| --- | --- | --- | --- | --- | --- |
| [mp-tikz-wasm](https://github.com/jmckalex/mp-tikz-wasm) 0.5.0 | pdfTeX 1.40.27 (TeX Live 2025, DVI mode) + dvisvgm 3.4.3, both wasm; real kpathsea | Glyph paths (woff2 optional): self-contained | Any preamble its bundles satisfy: every PGF library, pgfplots, tikz-cd, circuitikz, chemfig, tikz-3dplot, amsmath, mathtools, xcolor… | ≈4.7 MB; ≈60 MB of bundles on the server, fetched per file | LGPL-3.0 library, GPL engines. Created 2026-09-13, seven releases, one author, not on npm |
| [@drgrice1/tikzjax](https://github.com/drgrice1/tikzjax) 1.0.0-beta24 | web2js e-TeX from a frozen memory image (`standalone`, `xcolor[svgnames]`, TikZ preloaded) → DVI → dvi2html | `<text font-family="cmr10">` against BaKoMa webfonts | 171 bundled files: amsmath/amssymb, pgfplots, tikz-cd, tikz-3dplot, xparse, every TikZ library; no circuitikz | ≈6.5 MB (core.dump.gz 5.9 MB) + packages per file | GPL-3.0+. npm 2025-01; repo dependency updates 2026-06. What Labs uses |
| rod2ik/tikzjax, isomorphic-tikzjax | The TikZJax engine | As TikZJax | Adds circuitikz, chemfig | Similar | Forks; worker quirks |
| BusyTeX, SwiftLaTeX, Siglum + mupdf.js | Full TeX Live → PDF | Via PDF → SVG | Everything | 30–400 MB, or a TeX Live server, or cross-origin isolation for the whole page | Too heavy for a preview |

- **mp-tikz-wasm** claims output byte-identical to native `latex` + `dvisvgm` (its golden
  corpora, the whole PGF manual) and, on Apple silicon, about 120 ms a TikZ figure and
  270 ms a pgfplots axis. It runs in a Web Worker by default, reads files with synchronous
  XHR there, and kills a run that stalls. Its files must keep their names (they are TeX's
  lookups), and its README warns that `\special{dvisvgm:raw …}` puts arbitrary markup in
  the SVG.
- **TikZJax**'s `tikzjax.js` is only a page loader that watches for
  `<script type="text/tikz">`; the worker behind it (`run-tex.js`, exposing
  `load(urlRoot)` and `texify(input, dataset)`) can be driven directly. A file outside the
  bundle, or an option clash with the preloaded `xcolor`, fails the run; adding a file
  means rebuilding against a local TeX Live. A file it does not bundle falls back to
  `fetch(filename)` — any URL the TeX names.

### PreTeXt-Plus-Labs' TikZ applet (2026-10-28)

Steven's "TikZ Image" applet (PreTeXtPlus/PreTeXt-Plus-Labs#1, `src/applets/latex-image/`)
runs TikZJax through its page loader: it puts a `<script type="text/tikz">` in a
container, watches for the SVG or the broken-image placeholder, and reads the TeX
transcript off `console.log`; one compile at a time, 600 ms debounce. A form holds the
environment (`tikzpicture` or `tikzcd`), its options and body, packages from TikZJax's
list, libraries and extra preamble, and emits a `<latex-image label>` plus the `<docinfo>`
preamble the image needs. Export inlines the woff2 faces the SVG names as data URIs and
rasterizes that to a 300 DPI PNG. Worth taking: the TeX error excerpt (the first `!` line
and what follows) and splitting a pasted environment. Not: the page loader, or a preamble
per image — PreTeXt has one per document.

---

## Decisions

1. **A generated asset is an `authored_asset` whose `source_format` is a generator's,
   with one file.** `source` holds the generator's input (for PreFigure the `<diagram>`
   element, never the `<image>`/`<prefigure>` wrapper). The picture is the content's
   single attachment, so `url`, `thumbnail_url`, the asset list, `external/:ref` and
   `Project#full_dup` work unchanged. `attachments_fit_kind` admits it; it must be SVG.
   - *Why `source_format`:* it already means "the language `source` is written in", and
     for divisions and snippets it already decides the editor's language, completions
     and conversion — the same switch a generated asset needs for its preview engine and
     tooling. Divisions set the precedent: `kind: division` plus `division_type` and
     `source_format`, not a kind per division type. Divisions and snippets accept only
     the prose formats; file assets only `pretext`.
   - *Why not a kind per type* (`prefigure_asset`, `tikz_asset`, …): `kind` is the storage
     role (bytes attached or not, how it is assembled); a type change would be a kind
     change, and every kind check would grow. Types are not even one-to-one with PreTeXt
     elements — TikZ is written inside `<latex-image>` — so a future `tikz` format can
     wrap in `<latex-image>` and still get its own preview and completions.
   - *Why not infer it from the source* (`<prefigure>` present ⇒ PreFigure): the format
     decides the preview engine and the editor's tooling, which must not flicker while a
     tag is half typed or switch when one is deleted. It is chosen at creation; changing
     it is a deliberate act (for `pretext` ↔ a generator, wrapping or unwrapping the
     generator's element).

2. **The document always carries the source form.** `transformImageAsset` emits
   `<image>` + `<shortdescription/>` + `wrapSource(source, ref)` for every generated
   asset, for every target, for the preview. A downloaded project is ordinary PreTeXt.

3. **The picture is a preview, with a currency claim.** `preview_input_digest` is the
   sha256 of `render_input` (source + the docinfo elements the generator reads) the
   picture was built from; `preview_current?` compares it to the input as it is now. A
   digest, not a copy, because every use is an equality check: it is fixed-size, it
   rides the collab doc (replicated, append-only) cheaply, and it cannot be mistaken for
   a second source.
   Nothing reads a boolean off the row. A peer who edits the source without an engine
   simply makes the digest mismatch.

4. **Builds regenerate; the build server's cache makes that cheap.** No archive
   shipping, no flags, no CLI change.

5. **The browser engine is PreFigure's wasm build, MathJax variant, in a Web Worker we
   own,** ported from the playground's worker: the glue and binary served by the asset
   pipeline from `app/assets/builds/prefigure/` under digested names (a rebuilt engine
   keeps its filenames, and `/assets` is cached for a year), MathJax 4 bundled in the
   worker, one shared runtime per
   page, started when a generated asset's pane mounts (it is a few megabytes, so no
   "load" button). Never on page load.

6. **The generator abstraction is a registry, like `editorConfigs`.** One
   `AssetGenerator` per generator: id, label, Monaco language, starter source,
   `wrapSource`, `docinfoInputElements`, optional `createRuntime`. Nothing outside the
   registry names a generator.

7. **The picture rides the existing upload pipeline.** `onAssetOutput` sends
   `assets_attributes[0]` with `id`, `file` (the SVG) and `preview_input_digest` through
   `patchProjectAssetUpload`, once per distinct digest, only for a render of the source
   as it is now.

---

## Part 1 — Model (Rails) — done

Migration on `contents`: `preview_input_digest`. `source_format` gains `prefigure: 3`
(additive; integer enums are never renumbered), allowed only on an authored asset.
`Content::GeneratedAssetBehavior`: `ELEMENTS` (format → the element its source is
wrapped in, also its `generated/` directory), `DOCINFO_INPUT_ELEMENTS`
(`prefigure → macros, prefigure-preamble`), `generated_asset?`, `generated_element`,
`render_input`, `docinfo_element_inner` (regex, not Nokogiri, so the browser produces the
same bytes), `preview_current?`, SVG-only validation. JSON carries every asset's
`source_format`, and a generated asset's `preview_input_digest` and `preview_current`.
`GET (*)/generated/:element/:ref.svg` serves the stored picture (Part 4.3). **The render
input is defined twice, in Ruby and TypeScript; one fixture hex pins both**
(`content_test.rb`, `generators.test.ts`).

## Part 2 — Registry and assembly (web-editor) — done

`src/generators/`: `types.ts`, `index.ts` (`generators`, `runtimeFor`), `renderInput.ts`,
`prefigure/definition.ts`. `VERBATIM_SOURCES` and the spell checker's `latexImage` scope
list `prefigure`.

## Part 3 — Creating and editing — done

`NewAssetForm` grows one tab per registry entry → `onCreateGenerated(generator, title)`;
the host persists an `authored_asset` with `source_format` = the generator and its
starter source. In the editor, `Asset.sourceFormat` (`AssetSourceFormat`, apart from the
prose `SourceFormat`) carries it, and `generatorFor(asset.sourceFormat)` is the one test
for a generated asset.
Settings show the generator; Replace and Duplicate are hidden; Download SVG is `url`.

## Part 4 — Engine and pane — done for SVG

`prefigure/runtime.ts` (main thread: load once, latest-wins render queue),
`prefigure/worker/` (`protocol.ts` pins the engine's filenames and version;
`handler.ts` imports the glue from the host's URL, `init`s the binary, `set_host_api`;
`compat-api.ts` is the host: MathJax, canvas text metrics, macros). The host bundles
`src/prefigureWorker.ts` as `app/javascript/prefigure_worker.js` and passes
`prefigureWorkerUrl` + `prefigureAssetUrls` (each engine file's digested URL).
`GeneratedAssetPreview.tsx`: stored picture and whether it matches, auto-start,
debounced render, error strip, retry on a failed load or a failed store. `__tests__/prefigureWasm.test.ts` drives the real vendored engine through the
handler with a stub host in Node.

### 4.3 Document preview

The live preview's HTML references `generated/prefigure/<label>.svg`. The editor rewrites
those references to the asset's stored picture, versioned by its digest so a newly
stored picture replaces the old one (`generators/previewImages.ts`); that also covers a
placement's qualified label (`graph-ch3`, see "Ref is label is basename" below), which
nothing else serves. Unrewritten, the srcdoc iframe resolves the path against the editor
page and `ProjectsController#generated_file` answers for the plain label (the not-found
image before the first render). One gap remains: a render not yet stored is not shown
there.

## Part 6 — `latex-image` via `/generate`

A `latex-image` in general cannot run in the browser (TikZ can, Part 7), so it has no
`createRuntime`. A `GenerateAssetJob` builds a one-figure archive with the project's real
docinfo and publication, POSTs `/generate` with `assets=latex-image`, `target=web`, the
`project_id` and a callback, and on success attaches the returned SVG as the asset's
file with `preview_input_digest` computed **at enqueue time** (so a source edit during
the render leaves the result stale rather than wrongly current). `wrapSource` is
`<latex-image label="ref">` around the source escaped as XML text (7.1);
`docinfoInputElements` is `macros` + `latex-image-preamble`. The full build then finds
the figure already in the project's cache. It is a `latex_image` `source_format`; `tikz`
shares its wrapper and uses this job as its server render (7.4). Existing `pretext`
authored assets that are a bare `<latex-image>` can be converted by unwrapping and
setting the format; a rake task or an author's action, not part of this plan.

## Part 7 — TikZ

An `authored_asset` with `source_format: tikz`, wrapped in `<latex-image>`, previewed in
the browser by a TeX engine in a Web Worker. Parts 1–5 carry over unchanged; this is
what is new.

### 7.1 Decisions

1. **`source` is TeX: the text of the `<latex-image>`,** usually one `tikzpicture`.
   `wrapSource` escapes it as XML text (`&`, `<`, `>`) inside
   `<latex-image label="ref">`. PreFigure's source is XML and goes in verbatim; TeX is
   not, and an author typing `x < y` or a `tikzcd` row should not have to write entities.
   The document still carries ordinary PreTeXt, and the locked wrapper lines
   (`generatorWrapperLines`) still show the `<latex-image>` tags around the buffer.
2. **The preamble is the document's.** `DOCINFO_INPUT_ELEMENTS["tikz"]` is
   `macros latex-image-preamble`. Packages and `\usetikzlibrary` lines live in the
   docinfo's `<latex-image-preamble>`, which the DocinfoEditor already edits; the asset
   has no preamble of its own (unlike the Labs applet). When TeX reports a missing library
   or command, the pane can offer to add the line there. A preamble edit makes every TikZ
   asset stale, which is true of the build too.
3. **The browser compiles the document PreTeXt compiles.** The worker builds it:
   `amsmath,amssymb`; `\usepackage{tikz, pgf}` and then the preamble; core's guarded
   `\tikzset{ampersand replacement=\amp}`; the macros; the source. It uses `standalone`
   (no border) instead of `article` + crop + `\resizebox`, which gives the same picture
   with one conversion fewer. So the preview fails where the build would (an `&` that
   wants `\amp`, a macro the preamble lacks) and not where it would not.
4. **The SVG is sanitized before it is shown or stored.** PGF's SVG driver uses
   `\special{dvisvgm:raw …}`, so TeX can put `<script>`, event handlers and `javascript:`
   links in the SVG, and a collaborator's source compiles in my browser. DOMPurify with
   its SVG profile, keeping only same-document `<use>` references, runs on the main thread
   (it needs a DOM) before the pane shows the SVG or `onAssetOutput` sends it.
5. **The engine sits behind `GeneratorRuntime` and the worker;** nothing else knows which
   TeX it is, so changing engines (7.3) is a worker change.
6. **Engine files are served from a versioned directory, not as digested assets.** Either
   engine fetches hundreds of files by name (TeX's own lookups), which a per-file
   `assetUrls` map cannot carry. `script/copy-static-assets.js` copies the pinned engine
   to `public/engines/<engine>-<version>/` (gitignored); a new version is a new
   directory, so long caching is safe. The host passes the worker's URL and that base URL
   (`GeneratorRuntimeOptions` grows an optional `baseUrl`).

### 7.2 Work

1. **Rails.** `source_format` gains `tikz: 4`; `ELEMENTS["tikz"] = "latex-image"`;
   `DOCINFO_INPUT_ELEMENTS["tikz"]`; a TikZ fixture hex beside PreFigure's in
   `content_test.rb` and `generators.test.ts`. `generated_file` and its route already
   accept `latex-image`.
2. **Registry.** `GeneratorId` gains `"tikz"`; `generators/tikz/definition.ts` (label
   "TikZ"; starter: axes, a plotted function, a labelled point, like PreFigure's).
   `VERBATIM_SOURCES` and the spell checker's `latexImage` scope already list
   `latex-image`. The create tab, the settings and Download SVG follow from the registry.
3. **Editor language.** `AssetGenerator.language` is a prose `SourceFormat`, and `latex`
   is LaTeX-flavoured PreTeXt, whose cleanup diagnostics (`\vspace` and friends) and
   conversions are wrong for TikZ. Add a plain TeX language (highlighting, bracket
   matching; TikZ completions later) and widen the type.
4. **Runtime.** Lift the engine-independent half of `prefigure/runtime.ts` (worker
   lifecycle, status and progress, the latest-wins queue) into a helper both use. Widen
   `RenderOptions` from `macros` to the docinfo inputs by element. `src/tikzWorker.ts` is
   bundled as `app/javascript/tikz_worker.js`; host props `tikzWorkerUrl` and the
   engine's base URL are wired like PreFigure's through `editor_controller.js` and
   `editor.jsx`.
5. **Pane.** `GeneratedAssetPreview` already takes any runtime. Add the TeX log under the
   error strip (the excerpt from the first `!` line; the full transcript collapsed) and a
   first-load note (a few megabytes).
6. **Later.** "Convert to TikZ" on a `pretext` authored asset whose source is one bare
   `<latex-image>` (unwrap, unescape, set the format), and back. Part 6's `/generate` as
   "Render on the server" (7.4).

### 7.3 Engine: mp-tikz-wasm, after a spike

Recommendation: **mp-tikz-wasm**, with @drgrice1/tikzjax as the fallback.

- **Any preamble works.** Authors write the preamble freely, and it applies to every TikZ
  asset. With TikZJax, one package outside its 171 files, or a
  `\usepackage[dvipsnames]{xcolor}` clashing with the preloaded one, breaks the preview of
  every TikZ asset in the project.
- **Closest to the build.** Real pdfTeX and dvisvgm from TeX Live 2025; what remains
  different is xelatex's Latin Modern text.
- **Self-contained SVG.** Glyphs are paths, so the stored picture shows the same as an
  `<img>` with no font-inlining step.
- **Smaller first load:** about 4.7 MB against about 6.5 MB.

The risk is its age: six weeks old, one author, not on npm. A pinned release cannot
disappear on us, the picture is a preview (no build depends on it), and 7.1.5 limits a
switch to TikZJax to the worker. Its default bundles add about 60 MB to the deployed
image.

**Spike** (half a day, before 7.2.4), in our own worker:
- Compile the starter, a `tikzcd` with `\amp` and one with `&`, a pgfplots axis, a
  circuitikz figure, and real `latex-image-preamble`s from production projects.
- Measure cold and warm render times in Chromium and Firefox, and the first-load
  transfer.
- Try running it in our worker against letting it start its own (its stall watchdog needs
  a worker it can terminate).
- Compare against the same figures from `pretext generate latex-image`.
- Check that sanitizing keeps shadings, patterns, opacity and clipping, and that TeX can
  read nothing outside the bundle directory.

If it fails: TikZJax, driving `run-tex.js` directly, inlining fonts as Labs does, and
listing the bundled packages in the pane.

### 7.4 The server render

Neither engine is TeX Live as the build runs it. Part 6's `/generate` job serves `tikz`
unchanged (same wrapper) and covers xelatex-only preambles (`fontspec`), packages outside
the bundle and the exact final picture. It is offered when a browser render fails on a
missing file, and as an explicit action.

---

## Open questions

| Question | Blocks | Suggested answer |
| --- | --- | --- |
| Build `vendor/prefigure` from source or take the playground's deploy? | — | From source via `script/build-prefig-wasm.sh` (the devcontainer now has the toolchain); the current files are a stopgap from the deploy, noted in `vendor/prefigure/BUILD`. |
| MathJax or RaTeX variant? | — | MathJax: labels look like a build's and MathJax is already in the worker. RaTeX drops MathJax (smaller worker bundle, bigger wasm) at the cost of KaTeX-styled labels. |
| Should a docinfo macros edit re-render every PreFigure asset? | — | Only the open one renders; the rest show "source changed" until opened. Fine. |
| Is `diagcess` redistribution acceptable for an annotated preview? | 4 | Load PreTeXt's shipped copy; ask Volker Sorge before vendoring. |
| Should `tryit` get PreFigure? | 4 | No — nothing to save to. |
| Does a literal `&` in a `tikzcd` survive core's `ampersand replacement=\amp`? | — | Test in the spike. If not, the pane's error should name `\amp`; Labs' `tikzcd` sample uses `&`. |
| Commit the mp-tikz-wasm release, or fetch it at build? | 7.2.4 | Fetch a pinned version with a checksum, as `build-prefig-wasm.sh` pins a commit; the bundles are about 60 MB. |
| Load `lmodern` in the preview to match xelatex's text font? | — | Decide from the spike's side-by-side; it is one line in the worker's document. |
| Is a separate `latex_image` format (Part 6) still wanted? | 6 | Only for non-TikZ LaTeX pictures no browser engine runs; `tikz` covers the common case. |

## Traps

- **`preview_input_digest` is a claim, not a fact.** Compare to `sha256(render_input)` at
  the moment of use; never read a boolean off the row.
- **`render_input` is defined twice, in Ruby and TypeScript.** Pin both to one fixture hex.
  Trim nothing, normalize nothing in one place that the other does not.
- **Macros are an input.** The worker prepends them to every label; a change to them is a
  change to the picture, and the digest says so.
- **Ref is label is basename.** Embedding one asset twice would put the same `@label` in
  the document twice, which PreTeXt reports as an error. Every placement but one names an
  `instance` (`<plus:image ref="graph" instance="ch3"/>`), and assembly qualifies the
  identifiers inside it (`graph-ch3`); the editor flags an unnamed second placement and
  offers a name. The name is written down, not derived from order, so labels never move.
  Builds generate one file per label; the CLI's content-keyed cache makes the copies hits.
- **Assembly is synchronous.** Keep the digest on the pool entry, never hash inside
  `transformImageAsset`.
- **Never auto-load the engine on page load** — only when a generated asset's pane mounts.
- **Esbuild has no code splitting here.** MathJax rides in the worker bundle; the wasm is a
  runtime fetch; neither belongs in `application.js`.
- **`VERBATIM_SOURCES` must include `prefigure`** or a `<plus:` string in a label is
  mis-parsed as a placeholder.
- **The vendored engine and `PREFIG_WASM_VERSION` move together.** The handler warns on
  a mismatch; `prefigureWasm.test.ts` fails on one.
- **TikZ: `wrapSource` escapes; the worker does not.** The buffer is TeX; only the
  document's copy is XML. Escape exactly `&`, `<` and `>`, so converting `pretext` ↔ `tikz`
  round-trips.
- **The docinfo pieces are XML, and the worker needs TeX.** Unescape the preamble and macros
  before compiling; the digest stays over their raw inner text.
- **Core reads the first `<latex-image-preamble>` without `@syntax`; `docinfoElementInner`
  reads the first of any.** A docinfo with an `@syntax` one first would preview and digest
  the wrong preamble. Teach Ruby and TypeScript the rule together, and move the fixture.
- **The default `\usepackage{tikz, pgf}` is assembly's, not the docinfo's.** The render
  input digests the stored docinfo; the worker adds the line itself, as assembly does for
  builds.
- **No network from TeX.** TikZJax fetches a file it does not bundle by its name as a URL,
  so `\input{https://…}` in a collaborator's source would make every viewer's browser
  fetch it. Remove that fallback if TikZJax is the engine.
