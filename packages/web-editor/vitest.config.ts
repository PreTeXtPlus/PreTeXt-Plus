import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Standalone from vite.config.ts: tests need only the React plugin (for JSX),
// not Tailwind or the library-build rollup settings.
export default defineConfig({
  plugins: [react()],
  test: {
    // Most tests cover pure source-manipulation utilities and run fine (and
    // much faster) without a DOM. Component tests opt in per-file with a
    // `@vitest-environment jsdom` docblock.
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/__tests__/**',
        'src/main.tsx',
        'src/App.tsx',
      ],
    },
  },
})
