import { describe, it, expect } from 'vitest'
import {
  parseDivisionRefs,
  parseDivisionRefsWithTypes,
  parseAssetRefs,
  assetEmbedCode,
  renameAssetRef,
  removeAssetRef,
  canEmbedDivisionRefs,
  createDivisionContent,
  createDivisionWithId,
} from '../sectionUtils'

describe('parseDivisionRefs', () => {
  it('reads refs in document order', () => {
    expect(
      parseDivisionRefs('<p>x</p><plus:section ref="a"/><plus:chapter ref="b"/>', 'pretext'),
    ).toEqual(['a', 'b'])
  })

  it('accepts the expanded-empty form an XML round trip produces', () => {
    expect(parseDivisionRefs('<plus:section ref="a"></plus:section>', 'pretext')).toEqual(['a'])
  })

  it('reads the markdown and latex include syntaxes', () => {
    expect(parseDivisionRefs('text\n::section{ref="a"}\n', 'markdown')).toEqual(['a'])
    expect(parseDivisionRefs('::section[Intro]{ref="a"}', 'markdown')).toEqual(['a'])
    expect(parseDivisionRefs('\\plus{section}{a}', 'latex')).toEqual(['a'])
  })

  // Only the parent division's own syntax counts. A `::section{...}` sitting in
  // a PreTeXt division is literal text, and treating it as an include is what
  // produced phantom blank sections in the TOC.
  it('ignores include syntax belonging to a different source format', () => {
    expect(parseDivisionRefs('<p>::section{ref="a"}</p>', 'pretext')).toEqual([])
    expect(parseDivisionRefs('<p>\\plus{section}{a}</p>', 'pretext')).toEqual([])
    expect(parseDivisionRefs('<plus:section ref="a"/>', 'markdown')).toEqual([])
    expect(parseDivisionRefs('<plus:section ref="a"/>', 'latex')).toEqual([])
  })

  // An include shown inside a code sample is documentation, not a child.
  it('ignores refs inside verbatim spans', () => {
    expect(parseDivisionRefs('<pre><plus:section ref="a"/></pre>', 'pretext')).toEqual([])
    expect(parseDivisionRefs('<c><plus:section ref="a"/></c>', 'pretext')).toEqual([])
    expect(
      parseDivisionRefs('<program language="python"><plus:section ref="a"/></program>', 'pretext'),
    ).toEqual([])
    expect(parseDivisionRefs('```\n::section{ref="a"}\n```', 'markdown')).toEqual([])
    expect(parseDivisionRefs('~~~\n::section{ref="a"}\n~~~', 'markdown')).toEqual([])
    expect(parseDivisionRefs('an inline `::section{ref="a"}` span', 'markdown')).toEqual([])
    expect(
      parseDivisionRefs('\\begin{verbatim}\\plus{section}{a}\\end{verbatim}', 'latex'),
    ).toEqual([])
  })

  it('still sees a real ref alongside a verbatim example', () => {
    expect(
      parseDivisionRefs('<pre><plus:section ref="example"/></pre><plus:section ref="real"/>', 'pretext'),
    ).toEqual(['real'])
  })

  it('does not treat asset placeholders as divisions', () => {
    expect(parseDivisionRefs('<plus:image ref="img1"/>', 'pretext')).toEqual([])
  })

  it('recognises nested division levels', () => {
    expect(
      parseDivisionRefs('<plus:subsection ref="a"/><plus:paragraphs ref="b"/>', 'pretext'),
    ).toEqual(['a', 'b'])
  })
})

describe('parseDivisionRefsWithTypes', () => {
  it('infers the division type from the tag name', () => {
    expect(parseDivisionRefsWithTypes('<plus:chapter ref="c1"/>', 'pretext')).toEqual([
      { type: 'chapter', xmlId: 'c1' },
    ])
  })

  it('maps the generic division alias to a section', () => {
    expect(parseDivisionRefsWithTypes('<plus:division ref="d1"/>', 'pretext')).toEqual([
      { type: 'section', xmlId: 'd1' },
    ])
  })

  it('skips asset placeholders', () => {
    expect(parseDivisionRefsWithTypes('<plus:image ref="img1"/>', 'pretext')).toEqual([])
  })
})

describe('parseAssetRefs', () => {
  it('reads image placeholders in each syntax', () => {
    expect(parseAssetRefs('<plus:image ref="i1"/>', 'pretext')).toEqual([{ ref: 'i1' }])
    expect(parseAssetRefs('::image{ref="i1"}', 'markdown')).toEqual([{ ref: 'i1' }])
    expect(parseAssetRefs('\\plus{image}{i1}', 'latex')).toEqual([{ ref: 'i1' }])
  })

  it('does not treat division placeholders as assets', () => {
    expect(parseAssetRefs('<plus:section ref="s1"/>', 'pretext')).toEqual([])
  })

  it('ignores placeholders in verbatim spans', () => {
    expect(parseAssetRefs('<pre><plus:image ref="i1"/></pre>', 'pretext')).toEqual([])
  })

  it('keeps duplicates, in document order', () => {
    expect(parseAssetRefs('<plus:image ref="a"/><plus:image ref="a"/>', 'pretext')).toHaveLength(2)
  })
})

describe('assetEmbedCode', () => {
  it('emits the syntax matching the target division format', () => {
    expect(assetEmbedCode('x', 'pretext')).toBe('<plus:image ref="x"/>')
    expect(assetEmbedCode('x', 'markdown')).toBe('::image{ref="x"}')
    expect(assetEmbedCode('x', 'latex')).toBe('\\plus{image}{x}')
  })

  it('defaults to pretext', () => {
    expect(assetEmbedCode('x')).toBe('<plus:image ref="x"/>')
  })

  it('produces output its own parser reads back', () => {
    for (const format of ['pretext', 'markdown', 'latex'] as const) {
      expect(parseAssetRefs(assetEmbedCode('x', format), format)).toEqual([{ ref: 'x' }])
    }
  })
})

describe('renameAssetRef', () => {
  it('rewrites the ref and preserves other attributes', () => {
    expect(renameAssetRef('<plus:image ref="old" width="50%"/>', 'old', 'new')).toBe(
      '<plus:image ref="new" width="50%"/>',
    )
  })

  it('rewrites every occurrence across syntaxes', () => {
    expect(renameAssetRef('<plus:image ref="old"/>::image{ref="old"}', 'old', 'new')).toBe(
      '<plus:image ref="new"/>::image{ref="new"}',
    )
    expect(renameAssetRef('\\plus{image}{old}', 'old', 'new')).toBe('\\plus{image}{new}')
  })

  it('leaves other refs alone', () => {
    expect(renameAssetRef('<plus:image ref="other"/>', 'old', 'new')).toBe(
      '<plus:image ref="other"/>',
    )
  })
})

describe('removeAssetRef', () => {
  it('removes the placeholder and nothing else', () => {
    expect(removeAssetRef('a<plus:image ref="x"/>b', 'x')).toBe('ab')
    expect(removeAssetRef('a::image{ref="x"}b', 'x')).toBe('ab')
    expect(removeAssetRef('a\\plus{image}{x}b', 'x')).toBe('ab')
  })

  it('leaves non-matching placeholders in place', () => {
    expect(removeAssetRef('<plus:image ref="keep"/>', 'x')).toBe('<plus:image ref="keep"/>')
  })
})

describe('canEmbedDivisionRefs', () => {
  it('is true for every currently supported format', () => {
    expect(canEmbedDivisionRefs('pretext')).toBe(true)
    expect(canEmbedDivisionRefs('markdown')).toBe(true)
    expect(canEmbedDivisionRefs('latex')).toBe(true)
  })
})

describe('createDivisionContent / createDivisionWithId', () => {
  it('emits a titled element carrying the xml:id for pretext', () => {
    const content = createDivisionContent('section', 'pretext', 'My Title', 's1')
    expect(content).toContain('<section xml:id="s1">')
    expect(content).toContain('<title>My Title</title>')
  })

  it('omits the title for divisions that do not take one', () => {
    expect(createDivisionContent('introduction', 'pretext', 'Ignored', 'i1')).not.toContain(
      '<title>',
    )
  })

  it('emits a labelled macro for latex and frontmatter for markdown', () => {
    expect(createDivisionContent('section', 'latex', 'My Title', 's1')).toContain(
      '\\section{My Title}\\label{s1}',
    )
    const markdown = createDivisionContent('section', 'markdown', 'My Title', 's1')
    expect(markdown).toContain('division: section')
    expect(markdown).toContain('id: s1')
  })

  it('builds a division whose id matches the ref it was created for', () => {
    const division = createDivisionWithId('s1', 'section')
    expect(division.xmlId).toBe('s1')
    expect(division.id).toBe('s1')
    expect(division.type).toBe('section')
    expect(division.source).toContain('xml:id="s1"')
  })
})
