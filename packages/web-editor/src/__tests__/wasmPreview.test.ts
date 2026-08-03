/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { describePreviewError, findWellformednessErrorLine } from '../components/wasmPreview'

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
