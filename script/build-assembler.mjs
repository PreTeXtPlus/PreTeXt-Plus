// Bundles the Node scripts Rails shells out to (see NodeScript) into
// lib/assembler, which is gitignored. Run once by `npm run build:assembler`
// (bin/setup, and the rake hooks in lib/tasks/assembler.rake), or with --watch
// from Procfile.dev so a branch switch or an edit under packages/web-editor
// doesn't leave a stale bundle behind.

import * as esbuild from "esbuild";

const entries = {
  "script/assemble-source.mjs": "lib/assembler/assemble.mjs",
  "script/split-division-sources.mjs": "lib/assembler/split-divisions.mjs",
};

const shared = {
  bundle: true,
  format: "esm",
  platform: "node",
  loader: { ".css": "empty", ".png": "dataurl" },
  // The bundled dependencies include CommonJS that calls require(), which
  // doesn't exist in an ESM module.
  banner: {
    js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);",
  },
  logLevel: "info",
};

const options = Object.entries(entries).map(([entryPoint, outfile]) => ({
  ...shared,
  entryPoints: [entryPoint],
  outfile,
}));

if (process.argv.includes("--watch")) {
  for (const opts of options) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
  }
} else {
  await Promise.all(options.map((opts) => esbuild.build(opts)));
}
