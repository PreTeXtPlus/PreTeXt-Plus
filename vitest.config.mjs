import { defineConfig } from "vitest/config";

// `app/javascript` is the Rails-side half of the editor -- the collaboration
// transport, the Rails <-> editor state mapping, the import engines -- and until
// now it had no test home: `packages/web-editor` runs its own vitest, and the
// plain `node:test` files under `test/javascript` cannot load anything that
// reaches the editor package (TypeScript, CSS imports).
//
// Tests live in `__tests__` beside the code they cover, the same convention the
// editor package uses. `npm run build` globs `app/javascript/*.*`, one level
// deep, so nothing here is bundled into the app.
export default defineConfig({
  test: {
    include: ["app/javascript/**/__tests__/**/*.test.mjs"],
    environment: "node",
  },
});
