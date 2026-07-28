import { describe, it, expect } from 'vitest'
import {
  detectSourceFormat,
  derivePretextContent,
  convertLatexToPretext,
  convertMarkdownToPretext,
  getConversionErrorMessage,
} from '../contentConversion'

describe('detectSourceFormat', () => {
  it('defaults to pretext for blank input', () => {
    expect(detectSourceFormat('')).toBe('pretext')
    expect(detectSourceFormat('   \n\t  ')).toBe('pretext')
  })

  it('treats anything starting with < as pretext', () => {
    expect(detectSourceFormat('<article><title>x</title></article>')).toBe('pretext')
    expect(detectSourceFormat('\n  <section/>')).toBe('pretext')
  })

  it.each([
    ['\\documentclass{article}'],
    ['\\begin{document}hi\\end{document}'],
    ['\\section{Intro}'],
    ['\\chapter{One}'],
    ['\\title{T}'],
    ['\\author{A}'],
  ])('detects latex from %j', (source) => {
    expect(detectSourceFormat(source)).toBe('latex')
  })

  it('detects markdown from an ATX heading', () => {
    expect(detectSourceFormat('# Title\n\ntext')).toBe('markdown')
    expect(detectSourceFormat('## Sub\n')).toBe('markdown')
  })

  it('detects markdown from YAML frontmatter without a heading', () => {
    expect(detectSourceFormat('---\ntitle: My Title\n---\n\nprose')).toBe('markdown')
  })

  it('falls back to pretext for unrecognised prose', () => {
    expect(detectSourceFormat('just some prose with no markers')).toBe('pretext')
  })

  // The rules are ordered, so these two cases pin down the precedence.
  it('prefers pretext over latex when the document opens with a tag', () => {
    expect(detectSourceFormat('<article>\\section{x}</article>')).toBe('pretext')
  })

  it('prefers latex over markdown when both markers are present', () => {
    expect(detectSourceFormat('# Head\n\\section{x}')).toBe('latex')
  })
})

describe('convertLatexToPretext', () => {
  it('converts a section into PreTeXt markup', () => {
    const result = convertLatexToPretext('\\section{Hello}\n\nSome text.')
    expect(result).toContain('<section>')
    expect(result).toContain('<title>Hello</title>')
    expect(result).toContain('Some text.')
  })

  it('returns an empty string for blank input', () => {
    expect(convertLatexToPretext('')).toBe('')
    expect(convertLatexToPretext('   \n  ')).toBe('')
  })
})

describe('convertMarkdownToPretext', () => {
  it('converts a heading into a titled division', () => {
    const result = convertMarkdownToPretext('# Hello\n\nSome text.')
    expect(result).toContain('<title>Hello</title>')
    expect(result).toContain('Some text.')
  })

  it('returns an empty string for blank input', () => {
    expect(convertMarkdownToPretext('')).toBe('')
  })
})

describe('derivePretextContent', () => {
  it('passes pretext through untouched', () => {
    const source = '<article><title>Test</title></article>'
    expect(derivePretextContent(source, 'pretext')).toEqual({ pretextSource: source })
  })

  it('converts latex', () => {
    const { pretextSource, pretextError } = derivePretextContent('\\section{Hi}', 'latex')
    expect(pretextError).toBeUndefined()
    expect(pretextSource).toContain('<title>Hi</title>')
  })

  it('converts markdown', () => {
    const { pretextSource, pretextError } = derivePretextContent('# Hi\n\ntext', 'markdown')
    expect(pretextError).toBeUndefined()
    expect(pretextSource).toContain('<title>Hi</title>')
  })

  it('sets exactly one of pretextSource / pretextError', () => {
    for (const [source, format] of [
      ['<article/>', 'pretext'],
      ['\\section{Hi}', 'latex'],
      ['# Hi', 'markdown'],
    ] as const) {
      const result = derivePretextContent(source, format)
      expect(
        (result.pretextSource !== undefined) !== (result.pretextError !== undefined),
      ).toBe(true)
    }
  })
})

describe('getConversionErrorMessage', () => {
  it('uses the message of a real Error', () => {
    expect(getConversionErrorMessage(new Error('  Boom  '))).toBe('Boom')
  })

  it('falls back to a generic message for non-Errors and blank messages', () => {
    const fallback = 'Could not convert LaTeX to PreTeXt.'
    expect(getConversionErrorMessage(new Error('   '))).toBe(fallback)
    expect(getConversionErrorMessage('a string')).toBe(fallback)
    expect(getConversionErrorMessage(null)).toBe(fallback)
    expect(getConversionErrorMessage(undefined)).toBe(fallback)
  })
})
