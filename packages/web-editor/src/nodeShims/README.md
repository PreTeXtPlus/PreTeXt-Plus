# Node built-in shims

`@pretextbook/schema` — the RELAX NG validator behind PreTeXt diagnostics — has
no browser build. Its entry point statically imports `path` and `url`, and
`defaultFileReader` calls `require("fs")`:

```js
import * as M from "path";
import { fileURLToPath as q, pathToFileURL as Y } from "url";
// ...
function V() { const e = require("fs"); /* ... */ }
```

All of it serves `xi:include` resolution and URI↔path conversion, which this
editor never uses: it validates an already-assembled document with
`resolveXIncludes: false` and its own `readFile`. But a bundler still has to
*resolve* those specifiers, so a browser build fails outright without these
stand-ins.

The used surface is tiny — `path.dirname`, `path.isAbsolute`, `path.resolve`,
`url.fileURLToPath`, `url.pathToFileURL` — so these shims implement exactly
that, in posix terms, and `fs` throws if anything ever reaches it.

Wired up as bundler aliases in two places, which must stay in step:

- `vite.config.ts` (`resolve.alias`) — this package's dev server and lib build
- the root app's `esbuild` command (`--alias:`) — because the workspace
  `exports` points at `src/index.ts`, so the consuming app compiles this
  package's TypeScript itself rather than a prebuilt `dist/`

**These are deletable.** Upstream issue:
https://github.com/PreTeXtBook/pretext-tools/issues/256 asks for a `browser`
export condition on `@pretextbook/schema`. Once that ships, drop this
directory and both alias blocks.
