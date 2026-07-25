/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ErrorBoundary from '../components/ErrorBoundary'

/**
 * Whether {@link Boom} throws on its next render. Module scope rather than a
 * prop on purpose: when the boundary resets it re-renders the children it
 * already holds, so the child has to stop throwing *before* that re-render for
 * recovery to be observable at all.
 */
let boom = true

function Boom() {
  if (boom) throw new Error('malformed XML')
  return <div>recovered</div>
}

beforeEach(() => {
  boom = true
  // React logs caught render errors, and componentDidCatch logs its own copy.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('renders children while nothing throws', () => {
    boom = false
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('recovered')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an inline alert carrying the error message instead of crashing', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('malformed XML')).toBeInTheDocument()
  })

  it('reports the error to onError with its component stack', () => {
    const onError = vi.fn()
    render(
      <ErrorBoundary onError={onError}>
        <Boom />
      </ErrorBoundary>,
    )

    expect(onError).toHaveBeenCalledOnce()
    const [error, info] = onError.mock.calls[0]
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('malformed XML')
    expect(info.componentStack).toEqual(expect.any(String))
  })

  it('renders a custom fallback in place of the default UI', () => {
    render(
      <ErrorBoundary fallback={(error) => <p>caught: {error.message}</p>}>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('caught: malformed XML')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('recovers when the retry button is pressed and the cause is gone', async () => {
    const user = userEvent.setup()
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    boom = false
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(screen.getByText('recovered')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('exposes a working reset to a custom fallback', async () => {
    const user = userEvent.setup()
    render(
      <ErrorBoundary
        fallback={(_error, reset) => (
          <button type="button" onClick={reset}>
            retry
          </button>
        )}
      >
        <Boom />
      </ErrorBoundary>,
    )

    boom = false
    await user.click(screen.getByRole('button', { name: 'retry' }))

    expect(screen.getByText('recovered')).toBeInTheDocument()
  })

  // Editing past a bad state should recover on its own — the host passes the
  // content that produced the crash as a reset key.
  it('clears the error when a reset key changes', () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={['<bad']}>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    boom = false
    rerender(
      <ErrorBoundary resetKeys={['<good/>']}>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText('recovered')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stays in the error state while the reset keys are unchanged', () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={['<bad']}>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    boom = false
    rerender(
      <ErrorBoundary resetKeys={['<bad']}>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('recovered')).not.toBeInTheDocument()
  })
})
