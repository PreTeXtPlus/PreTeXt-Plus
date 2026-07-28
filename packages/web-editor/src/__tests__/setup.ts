// Registers the jest-dom matchers (toBeInTheDocument, toHaveAttribute, ...)
// and their types on Vitest's `expect`. The matchers only touch the DOM when
// actually called, so this is safe to load in the default `node` environment.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

// Vitest only auto-cleans when `globals: true`; this project uses explicit
// imports, so unmount between tests to keep the DOM isolated. Loaded lazily so
// the node-environment suites never pull in a library that needs a document.
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react')
  afterEach(cleanup)
}
