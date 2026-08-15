/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import {
  applyPrintPreview,
  describePreviewError,
  findWellformednessErrorLine,
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
