import { defineConfig } from "vitest/config";

/**
 * Separate from `vitest.config.ts` so the benchmarks never run in CI: they take
 * minutes, not seconds, and measure timing rather than asserting behaviour.
 *
 * `execArgv` enables WebAssembly JSPI, which `@pretextbook/pretext-html`
 * requires — the same capability `isLocalPreviewAvailable()` checks for in the
 * browser. Node 24 still has it behind a flag.
 */
export default defineConfig({
  test: {
    root: new URL("..", import.meta.url).pathname,
    environment: "node",
    include: ["bench/**/*.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    pool: "forks",
    maxForks: 1,
    minForks: 1,
    execArgv: ["--experimental-wasm-jspi"],
    disableConsoleIntercept: true,
  },
});
