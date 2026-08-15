/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useBackgroundDivisionConversion } from '../workers/useBackgroundDivisionConversion'
import type { Division } from '../types/sections'

/** Minimal stand-in for a `Worker`, controlled by the test via `respond`. */
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  posted: { id: number; division: Division }[] = []
  terminated = false

  postMessage(message: { id: number; division: Division }) {
    this.posted.push(message)
  }

  terminate() {
    this.terminated = true
  }

  respond(id: number, xml: string) {
    this.onmessage?.({ data: { id, xml } } as MessageEvent)
  }
}

const pretextDivision: Division = {
  xmlId: 'root',
  title: 'Doc',
  type: 'article',
  sourceFormat: 'pretext',
  source: '<article xml:id="root"></article>',
}
const latexDivision: Division = {
  xmlId: 's1',
  title: 'One',
  type: 'section',
  sourceFormat: 'latex',
  source: '\\section{One}\n\nBody.',
}

describe('useBackgroundDivisionConversion', () => {
  it('queues only non-pretext divisions, and bumps the version once per resolved job', async () => {
    const fake = new FakeWorker()
    const { result, rerender } = renderHook(
      ({ divisions }: { divisions: Division[] }) =>
        useBackgroundDivisionConversion(divisions, () => fake as unknown as Worker),
      { initialProps: { divisions: [pretextDivision, latexDivision] } },
    )

    await waitFor(() => expect(fake.posted).toHaveLength(1))
    expect(fake.posted[0].division.xmlId).toBe('s1')
    expect(result.current).toBe(0)

    fake.respond(fake.posted[0].id, '<section>...</section>')
    await waitFor(() => expect(result.current).toBe(1))

    // Re-rendering with the exact same division objects must not re-queue them.
    rerender({ divisions: [pretextDivision, latexDivision] })
    await waitFor(() => expect(fake.posted).toHaveLength(1))
  })

  it('queues a newly-added division without re-queuing an existing one', async () => {
    const fake = new FakeWorker()
    const { rerender } = renderHook(
      ({ divisions }: { divisions: Division[] }) =>
        useBackgroundDivisionConversion(divisions, () => fake as unknown as Worker),
      { initialProps: { divisions: [latexDivision] } },
    )
    await waitFor(() => expect(fake.posted).toHaveLength(1))

    const secondDivision: Division = { ...latexDivision, xmlId: 's2' }
    rerender({ divisions: [latexDivision, secondDivision] })

    await waitFor(() => expect(fake.posted).toHaveLength(2))
    expect(fake.posted[1].division.xmlId).toBe('s2')
  })

  it('never queues anything when no workerFactory is provided', async () => {
    const { result } = renderHook(
      ({ divisions }: { divisions: Division[] }) =>
        useBackgroundDivisionConversion(divisions, undefined),
      { initialProps: { divisions: [latexDivision] } },
    )
    // Give any (unwanted) async work a turn to happen before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.current).toBe(0)
  })

  it('terminates the worker on unmount', () => {
    const fake = new FakeWorker()
    const { unmount } = renderHook(() =>
      useBackgroundDivisionConversion([latexDivision], () => fake as unknown as Worker),
    )
    unmount()
    expect(fake.terminated).toBe(true)
  })
})
