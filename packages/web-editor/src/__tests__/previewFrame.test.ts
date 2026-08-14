import { describe, it, expect } from 'vitest'
import {
  FRAME_READY_MESSAGE,
  frameSrc,
  injectFrameBootstrap,
  isFrameReadyMessage,
  printoutIdFromSearch,
} from '../components/previewFrame'

describe('frameSrc', () => {
  it('returns the bare frame URL when nothing is being print-previewed', () => {
    expect(frameSrc('/preview-frame.html', null)).toBe('/preview-frame.html')
  })

  it('adds the printpreview parameter', () => {
    expect(frameSrc('/preview-frame.html', 'ws-one')).toBe(
      '/preview-frame.html?printpreview=ws-one',
    )
  })

  it('appends to a frame URL that already carries a query', () => {
    // Hosts version this URL to defeat a long cache lifetime, so the frame URL
    // having its own query string is the normal case, not an edge one.
    expect(frameSrc('/preview-frame.html?v=1', 'ws-one')).toBe(
      '/preview-frame.html?v=1&printpreview=ws-one',
    )
  })

  it('escapes ids that would otherwise alter the query', () => {
    expect(frameSrc('/preview-frame.html', 'a&b=c')).toBe(
      '/preview-frame.html?printpreview=a%26b%3Dc',
    )
  })
})

describe('printoutIdFromSearch', () => {
  it('reads the id the frame is previewing', () => {
    expect(printoutIdFromSearch('?printpreview=ws-one')).toBe('ws-one')
  })

  it('reads it alongside other parameters', () => {
    expect(printoutIdFromSearch('?v=1&printpreview=ws-one')).toBe('ws-one')
  })

  it('is null for a frame that is not in print preview', () => {
    expect(printoutIdFromSearch('')).toBeNull()
    expect(printoutIdFromSearch('?v=1')).toBeNull()
  })
})

describe('isFrameReadyMessage', () => {
  it('accepts a report with no token (a freshly navigated frame)', () => {
    expect(
      isFrameReadyMessage({ type: FRAME_READY_MESSAGE, search: '?v=1' }),
    ).toBe(true)
  })

  it('accepts a report carrying the write token', () => {
    expect(
      isFrameReadyMessage({ type: FRAME_READY_MESSAGE, search: '', token: 3 }),
    ).toBe(true)
  })

  it('rejects anything else on the window message bus', () => {
    // The listener runs on `window`, which carries every other embedder's
    // traffic too — Monaco, Turbo, extensions — so this guard is load-bearing.
    expect(isFrameReadyMessage(null)).toBe(false)
    expect(isFrameReadyMessage('pretext-plus:frame-ready')).toBe(false)
    expect(isFrameReadyMessage({ type: 'something-else', search: '' })).toBe(
      false,
    )
    expect(isFrameReadyMessage({ type: FRAME_READY_MESSAGE })).toBe(false)
  })
})

describe('injectFrameBootstrap', () => {
  const page = '<!doctype html><html><head><title>T</title></head><body>b</body></html>'

  it('inserts the bootstrap as the first thing in <head>', () => {
    const out = injectFrameBootstrap(page, 1)
    expect(out).toContain('<head><script>')
    // Ahead of the page's own head content, so the write handler is
    // re-registered before any CDN script gets a chance to throw.
    expect(out.indexOf('__ptxFrameWrite')).toBeLessThan(out.indexOf('<title>'))
  })

  it('bakes the write token into the page so it can identify itself', () => {
    expect(injectFrameBootstrap(page, 42)).toContain('token: 42')
  })

  it('defers the DOM work until the body it repairs exists', () => {
    // The script sits in <head>, where the print links it fixes have not been
    // parsed yet; repairing them inline would silently find nothing.
    expect(injectFrameBootstrap(page, 1)).toContain('DOMContentLoaded')
  })

  it('handles a <head> with attributes', () => {
    // PreTeXt emits <head xmlns:og="..." xmlns:book="...">.
    const withAttrs = '<html><head xmlns:og="http://ogp.me/ns#"><title>T</title></head></html>'
    expect(injectFrameBootstrap(withAttrs, 1)).toContain(
      '<head xmlns:og="http://ogp.me/ns#"><script>',
    )
  })

  it('returns a page with no <head> unchanged', () => {
    const headless = '<div>fragment</div>'
    expect(injectFrameBootstrap(headless, 1)).toBe(headless)
  })
})
