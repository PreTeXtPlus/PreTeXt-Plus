import { describe, it, expect } from 'vitest'
import { assembleSnippetPreviewSource } from '../sectionUtils'
import type { Asset, Snippet } from '../types/editor'

const docinfo = '<docinfo>\n<macros>\\newcommand{\\R}{\\mathbb R}</macros>\n</docinfo>'

describe('assembleSnippetPreviewSource', () => {
  it('injects the snippet into a plain article titled "snippet preview"', () => {
    const snippets: Snippet[] = [
      { ref: 'greeting', source: '<p>Hello</p>', sourceFormat: 'pretext' },
    ]
    const doc = assembleSnippetPreviewSource('greeting', [], snippets, [], docinfo)
    expect(doc).toMatch(/^<pretext[^>]*>/)
    expect(doc).toContain('\\newcommand{\\R}{\\mathbb R}')
    expect(doc).toContain('<article')
    expect(doc).toContain('<title>snippet preview</title>\n<p>Hello</p>\n</article>')
    expect(doc.trimEnd()).toMatch(/<\/pretext>$/)
  })

  it('writes the language onto the root element', () => {
    const snippets: Snippet[] = [
      { ref: 'greeting', source: '<p>Hola</p>', sourceFormat: 'pretext' },
    ]
    expect(
      assembleSnippetPreviewSource('greeting', [], snippets, [], '', 'es-ES'),
    ).toMatch(/^<pretext xml:lang="es-ES">/)
  })

  it('converts a Markdown snippet to PreTeXt', () => {
    const snippets: Snippet[] = [
      { ref: 'md', source: 'Some *emphasis* here.', sourceFormat: 'markdown' },
    ]
    const doc = assembleSnippetPreviewSource('md', [], snippets, [], '')
    expect(doc).toContain('<em>emphasis</em>')
    expect(doc).not.toContain('*emphasis*')
  })

  it('expands nested snippet and image placeholders', () => {
    const snippets: Snippet[] = [
      {
        ref: 'outer',
        source: '<p>Before</p>\n<plus:snippet ref="inner"/>\n<plus:image ref="fig"/>',
        sourceFormat: 'pretext',
      },
      { ref: 'inner', source: '<p>Inner</p>', sourceFormat: 'pretext' },
    ]
    const assets: Asset[] = [{ ref: 'fig', title: 'Fig', source: '<latex-image>x</latex-image>' }]
    const doc = assembleSnippetPreviewSource('outer', [], snippets, assets, '')
    expect(doc).toContain('<p>Inner</p>')
    expect(doc).toContain('<image>\n<latex-image>x</latex-image>\n</image>')
    expect(doc).not.toContain('<plus:')
  })

  it('stops a snippet that embeds itself', () => {
    const snippets: Snippet[] = [
      { ref: 'loop', source: '<p>x</p><plus:snippet ref="loop"/>', sourceFormat: 'pretext' },
    ]
    expect(assembleSnippetPreviewSource('loop', [], snippets, [], '')).toContain(
      '<!-- circular reference: loop -->',
    )
  })
})
