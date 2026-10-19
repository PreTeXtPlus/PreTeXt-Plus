# PreFigure wheels

The Python packages the editor's PreFigure engine loads into Pyodide in the
browser (`packages/web-editor/src/generators/prefigure/worker`). Copied to
`public/assets/prefigure/` by `script/copy-static-assets.js` on every build.

- `prefig-<version>-py3-none-any.whl` — PreFigure itself (GPL-3.0),
  <https://pypi.org/project/prefig/>
- `segno-<version>-py3-none-any.whl` — QR codes, a PreFigure dependency
  Pyodide does not ship (BSD-3-Clause), <https://pypi.org/project/segno/>

To upgrade: download the new wheels from PyPI, replace these, and update
`PREFIG_VERSION` / `PREFIGURE_WHEELS` in the worker's `protocol.ts` to match.
`prefig`'s other dependencies (lxml, numpy, scipy, shapely, click, networkx)
come from the Pyodide distribution.
