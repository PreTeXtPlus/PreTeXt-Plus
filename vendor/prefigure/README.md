# PreFigure wasm engine

PreFigure's Rust port compiled to WebAssembly — the prefigure repo's
`packages/prefig-wasm` crate (<https://github.com/davidaustinm/prefigure>),
MathJax variant — which the editor's PreFigure worker runs to render a
diagram as the author types. `BUILD` records the commit and version.

| file | what |
| --- | --- |
| `prefig_wasm.js` | wasm-pack's `--target web` glue: `default(init)`, `set_host_api`, `version`, `build_from_string` |
| `prefig_wasm_bg.wasm` | the engine |

`script/copy-static-assets.js` copies both to `public/assets/prefigure/`, and
`packages/web-editor/src/generators/prefigure/worker/protocol.ts` pins the
filenames and the version the worker expects.

To update: bump the commit in `script/build-prefig-wasm.sh`, run it (needs
`cargo` with the `wasm32-unknown-unknown` target and `wasm-pack`), and bump
`PREFIG_WASM_VERSION` in `protocol.ts` if the crate's version changed.

PreFigure is GPL-3.0; this app is AGPL-3.0. See also the NOTICE in
`packages/web-editor/src/generators/prefigure/worker/`.
