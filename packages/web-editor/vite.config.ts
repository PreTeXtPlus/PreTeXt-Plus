import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
// `@pretextbook/schema` (PreTeXt diagnostics) has no browser build: it
// statically imports `path`/`url` and reaches for `fs`, none of which this
// editor's use of it can ever execute. Point them at local stand-ins so a
// browser bundle resolves. See src/nodeShims/README.md — this whole block
// goes away when PreTeXtBook/pretext-tools#256 ships.
const nodeShimAliases = {
  path: path.resolve(__dirname, 'src/nodeShims/path.ts'),
  url: path.resolve(__dirname, 'src/nodeShims/url.ts'),
  fs: path.resolve(__dirname, 'src/nodeShims/fs.ts'),
}

export default defineConfig(({ mode }) => {
  if (mode === 'lib') {
    return {
      plugins: [
        react(),
        tailwindcss()
      ],
      resolve: { alias: nodeShimAliases },
      build: {
        lib: {
          entry: path.resolve(__dirname, 'src/index.ts'),
          name: 'PretextWebEditor',
          fileName: (format) => {
            if (format === 'es') return 'index.es.js'
            return 'index.js'
          }
        },
        rollupOptions: {
          // Regexes (not exact strings) so every subpath (react/jsx-runtime,
          // react-dom/client, use-sync-external-store/shim/with-selector, ...)
          // stays external too. Without this, transitive CJS deps that
          // `require('react')` get inlined with a runtime CJS-interop shim
          // that throws "Dynamic require of react is not supported" once the
          // consuming app's bundler processes it.
          // The WASM renderer stays external, unlike our other @pretextbook
          // deps which are bundled. Two reasons: libxslt-wasm locates its
          // 1.3MB binary with `new URL("libxslt.wasm", import.meta.url)`, so
          // bundling it would emit that asset into *our* dist and make every
          // consumer responsible for serving it — whereas leaving it external
          // lets their own bundler handle a pattern Vite and webpack already
          // understand. And it instantiates the WASM with a top-level await,
          // which we keep out of the graph by importing it dynamically (see
          // components/wasmPreview.ts).
          external: [
            /^react($|\/)/,
            /^react-dom($|\/)/,
            /^use-sync-external-store($|\/)/,
            /^@pretextbook\/pretext-html($|\/)/,
            /^@pretextbook\/libxslt-wasm($|\/)/,
            // Peer dependencies for collaboration: the host passes Y.Doc /
            // Awareness instances across the package boundary, so host and
            // editor MUST resolve the same module instance — bundling a copy
            // here would silently break that (instanceof checks, struct
            // sharing) in every collaborative session.
            /^yjs($|\/)/,
            /^y-protocols($|\/)/,
          ],
          output: {
            globals: {
              react: 'React',
              'react/jsx-runtime': 'React',
              'react-dom': 'ReactDOM',
              'use-sync-external-store/shim/index.js': 'useSyncExternalStoreShim',
              'use-sync-external-store/shim/with-selector.js': 'useSyncExternalStoreShimWithSelector',
              yjs: 'Y',
              'y-protocols/awareness': 'awarenessProtocol'
            }
          }
        },
        sourcemap: true,
        minify: true
      }
    }
  }
  
  return {
    plugins: [
      react(),
      tailwindcss()
    ],
    resolve: { alias: nodeShimAliases },
    // libxslt-wasm finds its 1.3MB binary with
    // `new URL("libxslt.wasm", import.meta.url)`. If Vite pre-bundles the
    // package into node_modules/.vite/deps/, that `import.meta.url` moves to
    // the deps directory, where the .wasm does not exist, and every render
    // fails at load. Excluding it keeps the glue code served from its real
    // location so the relative lookup resolves. Apps consuming
    // @pretextbook/web-editor need this same exclusion — see the README.
    optimizeDeps: {
      exclude: ['@pretextbook/libxslt-wasm']
    }
  }
})
