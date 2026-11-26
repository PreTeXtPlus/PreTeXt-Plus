# Braille for PreFigure's tactile diagrams

PreFigure's tactile output (`build_from_string("tactile", …)`) asks its host for
braille: text labels through `translate_text`, math labels through
`processBraille`. This module answers both, and is bundled on its own
(`@pretextbook/web-editor/prefigure-braille`; the Rails host's
`app/javascript/prefigure_braille.js`) so that the PreFigure worker fetches its
few megabytes only on an author's first tactile render.

| file | what |
| --- | --- |
| `liblouis.ts` | text → contracted Unified English Braille (`en-ueb-g2.ctb`, as PreFigure's Python package asks `louis` for), as Unicode cells |
| `nemeth.ts`, `sreFeature.ts` | MathML → Nemeth through Speech Rule Engine, its locale files bundled rather than fetched from a CDN |
| `liblouis/build-no-tables-utf32.js` | liblouis 3.32.0 compiled to JavaScript by emscripten (32-bit widechars, no tables) |
| `liblouis/tables.json` | the nine liblouis tables UEB grade 2 needs, by filename, written into the build's in-memory file system on first use |

## Where liblouis comes from

Both liblouis files are from the PreFigure playground
(`packages/playground/src/worker/liblouis` in
<https://github.com/davidaustinm/prefigure>, at the commit
`script/build-prefig-wasm.sh` pins), which took the build from liblouis's own
CI (<https://github.com/liblouis/js-build>) and the tables from that
repository's `tables/`. `tables.json` is those `.ctb`/`.uti`/`.dis`/`.cti` files
as `{ filename: text }`, so that every bundler reads it without a raw-text
loader.

Changes made here to `build-no-tables-utf32.js`, each marked `PreTeXt-Plus:`:

- It exports its factory as `createLiblouis` instead of calling it, so
  `liblouis.ts` can name the environment (`WEB`): its own guess fails in Node's
  ESM and differs by bundler.
- `getCFunc`'s `eval('_' + name)` fallback and `cwrap`'s eval'd wrapper are
  gone (every function called is exported on `Module`; `cwrap` now calls
  through `ccall`), and three duplicated `case` labels in a generated `switch`
  are removed — all of which esbuild warns about on every build.
- The Node-only `require('crypto')` reads `globalThis.require`, so bundlers
  don't try to resolve `crypto` for the browser.

The playground's wrapper (`easy-api.ts`) was not taken: it tells liblouis the
output buffer holds as many characters as it has *bytes*, which lets a label
whose braille outgrows its print overrun the heap. `liblouis.ts` sizes it in
characters.

## Licences

liblouis and its tables are LGPL-2.1-or-later. Speech Rule Engine is
Apache-2.0. The use of both follows the PreFigure playground (GPL-3.0); see the
NOTICE in `../worker/`.
