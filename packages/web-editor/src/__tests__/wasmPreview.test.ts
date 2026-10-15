/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import {
  applyPrintPreview,
  cursorOutsideSubtree,
  describePreviewError,
  findEntryForLine,
  findWellformednessErrorLine,
  parsePreviewPage,
  patchPreviewPage,
  subtreeExtent,
  subtreeSourceMap,
} from '../components/wasmPreview'
import type { PtxSourceMap } from '@pretextbook/pretext-html'

/**
 * A context render's source map, shaped as the renderer really emits one.
 *
 * Two documents are described at once and both are stamped with the *context*
 * file: the surrounding book, whose lines count from the top of that document,
 * and the previewed division spliced into it, whose lines count from the top
 * of the editor's buffer. Start lines therefore jump backwards partway
 * through, which is exactly what `findSourceMapEntry` may not be handed.
 */
const CONTEXT_MAP: PtxSourceMap = [
  { id: 'root-1', file: '/source/main.ptx', line: 1, column: 1, endLine: 15 },
  { id: 'bk', file: '/source/main.ptx', line: 2, column: 1, endLine: 15, parent: 'root-1' },
  { id: 'ch1', file: '/source/main.ptx', line: 3, column: 1, endLine: 7, parent: 'bk' },
  { id: 'thm-a', file: '/source/main.ptx', line: 5, column: 1, endLine: 5, parent: 'ch1' },
  { id: 'ch2', file: '/source/main.ptx', line: 8, column: 1, endLine: 14, parent: 'bk' },
  // From here on, lines are the editor buffer's.
  { id: 's22', file: '/source/main.ptx', line: 1, column: 1, endLine: 10, parent: 'ch2' },
  { id: 's22-1', file: '/source/main.ptx', line: 2, column: 1, endLine: 2, parent: 's22' },
  { id: 'thm-b', file: '/source/main.ptx', line: 6, column: 1, endLine: 9, parent: 's22' },
  { id: 'thm-b-2', file: '/source/main.ptx', line: 8, column: 1, endLine: 8, parent: 'thm-b' },
  // A division *after* the previewed one, back in context coordinates. These
  // are the entries that would shadow the buffer's, being both later in the
  // list and higher-numbered.
  { id: 'ch3', file: '/source/main.ptx', line: 16, column: 1, endLine: 40, parent: 'bk' },
]

describe('findWellformednessErrorLine', () => {
  it('finds the line of a mismatched closing tag', () => {
    const source = '<pretext>\n<article>\n<p>unclosed\n</article>\n</pretext>'
    expect(findWellformednessErrorLine(source)).toBe(4)
  })

  it('returns undefined for well-formed XML', () => {
    const source = '<pretext>\n<article>\n<p>fine</p>\n</article>\n</pretext>'
    expect(findWellformednessErrorLine(source)).toBeUndefined()
  })
})

describe('describePreviewError', () => {
  it('names the line when one is given', () => {
    expect(describePreviewError(new Error('whatever'), 4)).toBe(
      'Could not build the preview: the document is not well-formed XML ' +
        '(near line 4) — check for an unclosed or mismatched tag.',
    )
  })

  it('falls back to the transform-failure message with no line', () => {
    expect(describePreviewError(new Error('PreTeXt XSLT transform failed'))).toBe(
      'Could not build the preview. This usually means the PreTeXt is not ' +
        'yet well-formed — check for an unclosed tag.',
    )
  })

  it('falls back to the raw message for anything else with no line', () => {
    expect(describePreviewError(new Error('boom'))).toBe('boom')
  })
})

describe('subtreeSourceMap', () => {
  it('keeps only the previewed division and its descendants', () => {
    expect(subtreeSourceMap(CONTEXT_MAP, 's22').map((e) => e.id)).toEqual([
      's22',
      's22-1',
      'thm-b',
      'thm-b-2',
    ])
  })

  it('leaves the survivors with non-decreasing start lines', () => {
    // The precondition `findSourceMapEntry` relies on, and the whole reason
    // this trimming exists: without it a cursor line resolves against a
    // chapter elsewhere in the book.
    const lines = subtreeSourceMap(CONTEXT_MAP, 's22').map((e) => e.line)
    expect(lines).toEqual([...lines].sort((a, b) => a - b))
  })

  it('drops divisions that follow the previewed one', () => {
    expect(subtreeSourceMap(CONTEXT_MAP, 's22').map((e) => e.id)).not.toContain(
      'ch3',
    )
  })

  it('returns the map untouched when the division is not in it', () => {
    // The renderer fell back to a standalone wrapper — a division whose
    // @xml:id is not yet in the document. An empty map would disable sync
    // outright, which is far worse than an untrimmed one.
    expect(subtreeSourceMap(CONTEXT_MAP, 'not-there')).toBe(CONTEXT_MAP)
  })

  it('returns the map untouched when no division id is given', () => {
    expect(subtreeSourceMap(CONTEXT_MAP, undefined)).toBe(CONTEXT_MAP)
  })

  it('handles an empty map', () => {
    expect(subtreeSourceMap([], 's22')).toEqual([])
  })
})

describe('applyPrintPreview', () => {
  /**
   * A rendered page as the preview stylesheet emits one: the printer icon on
   * each printout is inert, and carries the printout's identity in
   * `data-printout` for a picker to read.
   */
  const PAGE =
    '<!doctype html><html><head><title>T</title></head><body>' +
    '<a class="print-link" data-printout="ws-one" aria-disabled="true"></a>' +
    '</body></html>'

  /**
   * Everything injected ahead of the page's own markup. Isolated because the
   * page body mentions the printout id too, in the `data-printout` the picker
   * reads — so asserting on the whole string would not distinguish "the bridge
   * names this printout" from "the page contains one".
   */
  const bridge = (html: string) => html.slice(0, html.indexOf('<body>'))

  it('makes the page report the printout as a printpreview query parameter', () => {
    const out = bridge(applyPrintPreview(PAGE, 'ws-one'))
    expect(out).toContain('printpreview')
    expect(out).toContain('ws-one')
  })

  it('pins the print layout to light, whatever theme the page was rendered in', () => {
    // Paper is light and print-worksheet.css carries no dark palette, so a
    // dark-mode preview would otherwise put black print text on a dark page.
    expect(applyPrintPreview(PAGE, 'ws-one')).toContain('color-scheme: light')
    expect(applyPrintPreview(PAGE, undefined)).not.toContain(
      'color-scheme: light',
    )
  })

  it('still states the layout when print preview is off', () => {
    // Load-bearing, not defensive: the bridge keeps its answer on a window
    // property, so a page delivered without one inherits whatever the previous
    // delivery said. LivePreview therefore calls this unconditionally.
    const out = applyPrintPreview(PAGE, undefined)
    expect(out).not.toBe(PAGE)
    expect(bridge(out)).toContain('__ptxPrintPreview')
    expect(bridge(out)).not.toContain('ws-one')
  })

  it('treats a printout that is not on the page as off', () => {
    // A stale id — left over from the division the author just left — would
    // otherwise strand them on a print-styled page with nothing on it, since
    // pretext-core.js swaps in the print stylesheet before looking the element
    // up.
    expect(applyPrintPreview(PAGE, 'ws-gone')).toBe(
      applyPrintPreview(PAGE, undefined),
    )
  })

  it('replaces its own bridge rather than stacking a second one', () => {
    // Entering and leaving print preview re-injects into HTML we already hold,
    // so this runs over its own output routinely.
    const once = applyPrintPreview(PAGE, 'ws-one')
    expect(applyPrintPreview(once, 'ws-one')).toBe(once)
    expect(applyPrintPreview(once, undefined)).toBe(
      applyPrintPreview(PAGE, undefined),
    )
  })
})

describe('patchPreviewPage', () => {
  /** A rendered page, reduced to the block structure the patcher recurses. */
  const page = (second: string, head = '<title>T</title>') =>
    `<!doctype html><html><head>${head}</head><body><main>` +
    '<section id="s1"><p id="p1">One</p>' +
    `<p id="p2">${second}</p></section></main></body></html>`

  /**
   * The page as it sits in the iframe. A bare stand-in for the iframe's
   * window: without MathJax on it, typesetting the patch is a no-op.
   */
  const livePage = (html: string) => {
    const document = parsePreviewPage(html)
    return { document, win: { document } as unknown as Window }
  }

  it('replaces only the block that changed', () => {
    const { document, win } = livePage(page('Two'))
    const untouched = document.getElementById('p1')

    const ok = patchPreviewPage(
      win,
      parsePreviewPage(page('Two')),
      parsePreviewPage(page('Two, edited')),
    )

    expect(ok).toBe(true)
    expect(document.getElementById('p2')?.textContent).toBe('Two, edited')
    // The same node, not a copy: its typeset math and state survive.
    expect(document.getElementById('p1')).toBe(untouched)
  })

  it('declines, leaving the page alone, when the head changed', () => {
    // Nothing in <head> can be applied to a running page; LivePreview then
    // delivers the new page from scratch.
    const { document, win } = livePage(page('Two'))
    const before = document.documentElement.outerHTML

    const ok = patchPreviewPage(
      win,
      parsePreviewPage(page('Two')),
      parsePreviewPage(page('Two, edited', '<title>Renamed</title><style></style>')),
    )

    expect(ok).toBe(false)
    expect(document.documentElement.outerHTML).toBe(before)
  })
})

describe('subtreeExtent', () => {
  it('reads the rendered division and its listed children off the map', () => {
    const extent = subtreeExtent(CONTEXT_MAP, {
      id: 'bk',
      level: 0,
      collapsed: true,
      children: ['ch1', 'ch2', 'ch3'],
    })
    expect(extent).toEqual({
      id: 'bk',
      line: 2,
      endLine: 15,
      children: [
        { id: 'ch1', line: 3, endLine: 7 },
        { id: 'ch2', line: 8, endLine: 14 },
        { id: 'ch3', line: 16, endLine: 40 },
      ],
    })
  })

  it('has no children for a division shown whole', () => {
    const extent = subtreeExtent(CONTEXT_MAP, {
      id: 's22',
      level: 2,
      collapsed: false,
      children: [],
    })
    expect(extent).toEqual({ id: 's22', line: 1, endLine: 10, children: [] })
  })

  it('drops a listed child the map does not know', () => {
    const extent = subtreeExtent(CONTEXT_MAP, {
      id: 'bk',
      level: 0,
      collapsed: true,
      children: ['ch1', 'not-here'],
    })
    expect(extent?.children.map((child) => child.id)).toEqual(['ch1'])
  })

  it('is undefined when everything was rendered', () => {
    expect(subtreeExtent(CONTEXT_MAP, undefined)).toBeUndefined()
  })

  it('is undefined when the map does not know the division', () => {
    expect(
      subtreeExtent(CONTEXT_MAP, { id: 'ghost', level: 1, collapsed: false, children: [] }),
    ).toBeUndefined()
  })
})

describe('cursorOutsideSubtree', () => {
  const summary = subtreeExtent(CONTEXT_MAP, {
    id: 'ch2',
    level: 1,
    collapsed: true,
    children: ['s22'],
  })
  const whole = subtreeExtent(CONTEXT_MAP, {
    id: 'thm-b',
    level: 3,
    collapsed: false,
    children: [],
  })

  it('is false inside a division shown whole', () => {
    expect(cursorOutsideSubtree(whole, 6)).toBe(false)
    expect(cursorOutsideSubtree(whole, 9)).toBe(false)
  })

  it('is true before and after it', () => {
    expect(cursorOutsideSubtree(whole, 5)).toBe(true)
    expect(cursorOutsideSubtree(whole, 10)).toBe(true)
  })

  it("is true inside a division a summary page lists but does not show", () => {
    // s22 spans 1-10 in the buffer's coordinates, ch2 8-14 in the context's;
    // the overlap is the fixture's, not a real page's, and does not matter
    // here: a cursor in a listed child is outside whatever the parent spans.
    expect(cursorOutsideSubtree(summary, 9)).toBe(true)
  })

  it("is false in the summary page's own content", () => {
    expect(cursorOutsideSubtree(summary, 12)).toBe(false)
  })

  it('is never outside when nothing was narrowed', () => {
    expect(cursorOutsideSubtree(undefined, 999)).toBe(false)
  })
})

describe('findEntryForLine', () => {
  const entries = subtreeSourceMap(CONTEXT_MAP, 's22')

  it('picks the deepest element starting at or before the line', () => {
    expect(findEntryForLine(entries, 8)?.id).toBe('thm-b-2')
    expect(findEntryForLine(entries, 7)?.id).toBe('thm-b')
    expect(findEntryForLine(entries, 3)?.id).toBe('s22-1')
  })

  it('falls back to the first entry for a line above them all', () => {
    expect(findEntryForLine(entries, 0)?.id).toBe('s22')
  })

  it('is undefined for an empty map', () => {
    expect(findEntryForLine([], 5)).toBeUndefined()
  })
})
