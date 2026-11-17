/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import { assembleFullProjectSource, assembleSnippetPreviewSource, toCdata } from '../sectionUtils'
import type { Asset, Snippet } from '../types/editor'
import type { Division } from '../types/sections'

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

describe('raw snippets', () => {
  const raw = (source: string): Snippet => ({ ref: 'code', source, sourceFormat: 'raw' })
  const article = (source: string): Division => ({
    xmlId: 'a1', title: 'T', type: 'article', sourceFormat: 'pretext', source,
  })

  it('wraps text in one CDATA section, splitting any ]]> in it', () => {
    expect(toCdata('a < b && c')).toBe('<![CDATA[a < b && c]]>')
    expect(toCdata('x]]>y')).toBe('<![CDATA[x]]]]><![CDATA[>y]]>')
  })

  it('goes into the document verbatim, as CDATA', () => {
    const source = 'if (a < b && c > d) {\n  <p>not markup</p>\n}'
    const doc = assembleFullProjectSource(
      [article('<program><code><plus:snippet ref="code"/></code></program>')],
      'a1', '', [], undefined, [raw(source)],
    )
    expect(doc).toContain(`<program><code><![CDATA[${source}]]></code></program>`)
  })

  it('leaves placeholders in its text unexpanded', () => {
    const snippets: Snippet[] = [
      raw('<plus:snippet ref="inner"/>'),
      { ref: 'inner', source: '<p>Inner</p>', sourceFormat: 'pretext' },
    ]
    const doc = assembleSnippetPreviewSource('code', [], snippets, [], '')
    expect(doc).toContain('<![CDATA[<plus:snippet ref="inner"/>]]>')
    expect(doc).not.toContain('<p>Inner</p>')
  })

  it('takes no placeholder attributes or instance name into its text', () => {
    const doc = assembleFullProjectSource(
      [article('<pre><plus:snippet ref="code" instance="two" component="x"/></pre>')],
      'a1', '', [], undefined, [raw('<b xml:id="k">t</b>')],
    )
    expect(doc).toContain('<pre><![CDATA[<b xml:id="k">t</b>]]></pre>')
  })

  it('is valid XML however many special characters it holds', () => {
    const source = 'a]]>b & <c> "d" \'e\''
    const doc = assembleSnippetPreviewSource('code', [], [raw(source)], [], '')
    const parsed = new DOMParser().parseFromString(doc, 'application/xml')
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(parsed.documentElement.textContent).toContain(source)
  })
})
