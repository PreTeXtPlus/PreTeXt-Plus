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

## `tailwind-stub.css`

A different problem, aliased in the root app's `esbuild` command only —
**never** in `vite.config.ts`. `src/index.css` activates Tailwind v4 via
`@import "tailwindcss";`, which only a Tailwind-aware processor (the Vite
plugin, a PostCSS plugin, or the Tailwind CLI) can resolve; plain esbuild has
no idea what to do with it and fails the build. The root app already runs its
own Tailwind v4 pipeline (`tailwindcss-rails`, driven by
`bin/rails tailwindcss:watch`), which generates this package's utility
classes too — Tailwind's CLI auto-scans the whole project tree by default, so
it already picks up class names from this package's `.tsx` files. Aliasing
`tailwindcss` to this empty file just stops esbuild from trying (and failing)
to resolve that one `@import`; it doesn't touch the rest of `index.css` (the
two Monaco-specific rules below the import still bundle normally), and it
doesn't affect Vite, which still needs the real import to generate this
package's own `dist/web-editor.css`.
