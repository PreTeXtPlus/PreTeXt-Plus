import { describe, it, expect } from 'vitest'
import { createConversionWorkerClient } from '../workers/conversionWorkerClient'
import type { Division } from '../types/sections'

/** Minimal stand-in for a `Worker`, controlled by the test via `respond`/`fail`. */
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  posted: unknown[] = []
  terminated = false

  postMessage(message: unknown) {
    this.posted.push(message)
  }

  terminate() {
    this.terminated = true
  }

  respond(response: { id: number; xml?: string; error?: string }) {
    this.onmessage?.({ data: response } as MessageEvent)
  }

  fail() {
    this.onerror?.({})
  }
}

const division: Division = {
  xmlId: 's1',
  title: 'One',
  type: 'section',
  sourceFormat: 'latex',
  source: '\\section{One}\n\nBody.',
}

describe('createConversionWorkerClient', () => {
  it('returns null when the factory throws, instead of propagating', () => {
    const client = createConversionWorkerClient(() => {
      throw new Error('Worker is not defined')
    })
    expect(client).toBeNull()
  })

  it('resolves convert() with the matching response by id', async () => {
    const fake = new FakeWorker()
    const client = createConversionWorkerClient(() => fake as unknown as Worker)
    expect(client).not.toBeNull()

    const promise = client!.convert(division)
    expect(fake.posted).toEqual([{ id: 0, division }])
    fake.respond({ id: 0, xml: '<section>...</section>' })

    await expect(promise).resolves.toBe('<section>...</section>')
  })

  it('resolves concurrent jobs independently, out of order', async () => {
    const fake = new FakeWorker()
    const client = createConversionWorkerClient(() => fake as unknown as Worker)!

    const first = client.convert({ ...division, xmlId: 's1' })
    const second = client.convert({ ...division, xmlId: 's2' })

    // Respond to the second job first — resolution must be id-matched, not order-matched.
    fake.respond({ id: 1, xml: 'second-xml' })
    fake.respond({ id: 0, xml: 'first-xml' })

    await expect(first).resolves.toBe('first-xml')
    await expect(second).resolves.toBe('second-xml')
  })

  it('rejects convert() when the response carries an error', async () => {
    const fake = new FakeWorker()
    const client = createConversionWorkerClient(() => fake as unknown as Worker)!

    const promise = client.convert(division)
    fake.respond({ id: 0, error: 'boom' })

    await expect(promise).rejects.toThrow('boom')
  })

  it('rejects every pending job when the worker itself errors', async () => {
    const fake = new FakeWorker()
    const client = createConversionWorkerClient(() => fake as unknown as Worker)!

    const first = client.convert({ ...division, xmlId: 's1' })
    const second = client.convert({ ...division, xmlId: 's2' })
    fake.fail()

    await expect(first).rejects.toThrow()
    await expect(second).rejects.toThrow()
  })

  it('terminate() tears down the underlying worker and rejects pending jobs', async () => {
    const fake = new FakeWorker()
    const client = createConversionWorkerClient(() => fake as unknown as Worker)!

    const pending = client.convert(division)
    client.terminate()

    expect(fake.terminated).toBe(true)
    await expect(pending).rejects.toThrow()
  })

  it('ignores a response whose id was never requested (or already resolved)', async () => {
    const fake = new FakeWorker()
    const client = createConversionWorkerClient(() => fake as unknown as Worker)!

    const promise = client.convert(division)
    // No matching pending job for id 999 — must be a no-op, not a crash.
    expect(() => fake.respond({ id: 999, xml: 'unrelated' })).not.toThrow()
    fake.respond({ id: 0, xml: 'real-xml' })

    await expect(promise).resolves.toBe('real-xml')
  })
})
