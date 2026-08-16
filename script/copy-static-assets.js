// Copies runtime assets that must be *served* rather than bundled.
//
// Both files below are large binaries or data blobs that are located at runtime
// by URL, so esbuild never sees them. They land in public/assets (gitignored)
// and are refreshed on every `npm run build`.

const fs = require("fs");
const path = require("path");

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`copied ${to}`);
};

// The XSLT engine finds its 1.3MB binary with `new URL("libxslt.wasm",
// import.meta.url)`, which is why the package is external to the editor's
// bundle — see packages/web-editor/vite.config.ts.
copy(
  require.resolve("@pretextbook/libxslt-wasm/output/libxslt.wasm"),
  "public/assets/libxslt.wasm",
);

// Hunspell dictionary for the editor's spell checker: ~650KB of plain text the
// editor fetches at runtime (see DEFAULT_DICTIONARY_SOURCE in
// packages/web-editor/src/components/editorConfigs/spellcheck/dictionary.ts).
// Fetching rather than importing keeps it out of the main bundle entirely —
// the app bundles in a single esbuild pass with no code splitting, so an import
// would weld the dictionary into the bundle and parse it on every page load,
// whether or not anyone spell checks anything.
//
// `dictionary-en` exports only its root, so the data files are located relative
// to the resolved entry point rather than by subpath.
const dictionary = path.dirname(require.resolve("dictionary-en"));
copy(path.join(dictionary, "index.aff"), "public/assets/dictionaries/en.aff");
copy(path.join(dictionary, "index.dic"), "public/assets/dictionaries/en.dic");
