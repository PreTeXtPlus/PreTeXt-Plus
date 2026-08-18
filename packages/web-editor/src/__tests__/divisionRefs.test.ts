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
  divisionRefTag,
  insertDivisionRef,
  removeDivisionRef,
  renameDivisionRef,
  findDivisionParent,
} from '../sectionUtils'
import type { Division } from '../types/sections'

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
      { type: 'chapter', xmlId: 'c1', generic: false },
    ])
  })

  it('maps the generic division alias to a section, flagged generic', () => {
    expect(parseDivisionRefsWithTypes('<plus:division ref="d1"/>', 'pretext')).toEqual([
      { type: 'section', xmlId: 'd1', generic: true },
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


// ---------------------------------------------------------------------------
// Ref manipulation: the placeholder in a parent's source is a *mirror* of the
// child's own type, so every helper that rewrites one has to agree with
// `parseDivisionRefs` about which occurrences are real includes. Scanning any
// wider — other formats' syntax, verbatim spans, the division's own body — let
// a type change land on the wrong line entirely.
// ---------------------------------------------------------------------------

/** A minimal `Division`; only the fields the ref helpers read are meaningful. */
const div = (
  xmlId: string,
  source: string,
  type: Division['type'] = 'section',
  sourceFormat: Division['sourceFormat'] = 'latex',
): Division => ({ id: xmlId, xmlId, title: xmlId, type, source, sourceFormat })

describe('divisionRefTag', () => {
  it('emits the syntax matching the holding division format', () => {
    expect(divisionRefTag('worksheet', 'x', 'pretext')).toBe('<plus:worksheet ref="x"/>')
    expect(divisionRefTag('worksheet', 'x', 'markdown')).toBe('::worksheet{ref="x"}')
    expect(divisionRefTag('worksheet', 'x', 'latex')).toBe('\\plus{worksheet}{x}')
  })

  it('produces output its own parser reads back', () => {
    for (const format of ['pretext', 'markdown', 'latex'] as const) {
      expect(parseDivisionRefs(divisionRefTag('handout', 'x', format), format)).toEqual(['x'])
    }
  })
})

describe('findDivisionParent', () => {
  const root = div('root', '\\article{Main}\\label{root}\n\n\\plus{handout}{h1}\n', 'article')

  it('finds the division whose source includes the ref', () => {
    expect(findDivisionParent([root, div('h1', 'body', 'handout')], 'h1')?.xmlId).toBe('root')
  })

  it('never treats a division as its own parent', () => {
    // A `\plus{handout}{h1}` pasted into h1's own body is malformed markup, not
    // a placement — the assembler renders it as a circular reference. Returning
    // h1 here made a TOC type change rewrite that stray line instead of the
    // root's, and clobber h1's own rewritten header on the way.
    const selfRef = div('h1', '\\handout{Day 1}\\label{h1}\n\n\\plus{handout}{h1}\n', 'handout')
    expect(findDivisionParent([selfRef, root], 'h1')?.xmlId).toBe('root')
  })

  it('ignores a placeholder shown as an example inside a verbatim span', () => {
    const docs = div(
      'docs',
      '\\section{How to}\\label{docs}\n\\begin{verbatim}\n\\plus{handout}{h1}\n\\end{verbatim}\n',
    )
    // The TOC does not show h1 under `docs`, so nothing else may either.
    expect(parseDivisionRefs(docs.source, 'latex')).toEqual([])
    expect(findDivisionParent([docs, root], 'h1')?.xmlId).toBe('root')
  })

  it("ignores a placeholder written in another format's syntax", () => {
    const prose = div(
      'prose',
      '<section xml:id="prose"><p>write \\plus{handout}{h1} to include it</p></section>',
      'section',
      'pretext',
    )
    expect(findDivisionParent([prose, root], 'h1')?.xmlId).toBe('root')
  })

  it('returns null for an unplaced division', () => {
    expect(findDivisionParent([root], 'nobody')).toBeNull()
  })
})

describe('renameDivisionRef', () => {
  it('rewrites the ref and tag in the holder own syntax', () => {
    expect(renameDivisionRef('\\plus{handout}{h1}', 'h1', 'h1', 'worksheet', 'latex')).toBe(
      '\\plus{worksheet}{h1}',
    )
    expect(renameDivisionRef('::handout{ref="h1"}', 'h1', 'h2', 'worksheet', 'markdown')).toBe(
      '::worksheet{ref="h2"}',
    )
    expect(
      renameDivisionRef('<plus:handout ref="h1"/>', 'h1', 'h2', 'worksheet', 'pretext'),
    ).toBe('<plus:worksheet ref="h2"/>')
  })

  it('leaves surrounding content untouched', () => {
    expect(
      renameDivisionRef('before\n\\plus{handout}{h1}\nafter', 'h1', 'h1', 'worksheet', 'latex'),
    ).toBe('before\n\\plus{worksheet}{h1}\nafter')
  })

  it('leaves an example inside a verbatim span alone', () => {
    const source = '\\begin{verbatim}\n\\plus{handout}{h1}\n\\end{verbatim}\n\\plus{handout}{h1}\n'
    expect(renameDivisionRef(source, 'h1', 'h1', 'worksheet', 'latex')).toBe(
      '\\begin{verbatim}\n\\plus{handout}{h1}\n\\end{verbatim}\n\\plus{worksheet}{h1}\n',
    )
  })

  it("ignores a ref written in another format's syntax", () => {
    const source = '<section xml:id="s"><p>\\plus{handout}{h1}</p></section>'
    expect(renameDivisionRef(source, 'h1', 'h1', 'worksheet', 'pretext')).toBe(source)
  })

  it('returns the content unchanged when the ref is absent', () => {
    expect(renameDivisionRef('nothing here', 'h1', 'h2', 'worksheet', 'latex')).toBe(
      'nothing here',
    )
  })
})

describe('removeDivisionRef', () => {
  it('takes the placeholder and its trailing newline', () => {
    expect(removeDivisionRef('a\n\\plus{section}{x}\nb', 'x', 'latex')).toBe('a\nb')
    expect(removeDivisionRef('a\n::section{ref="x"}\nb', 'x', 'markdown')).toBe('a\nb')
    expect(removeDivisionRef('a\n<plus:section ref="x"/>\nb', 'x', 'pretext')).toBe('a\nb')
  })

  it('leaves an example inside a verbatim span alone', () => {
    const source = '\\begin{verbatim}\n\\plus{section}{x}\n\\end{verbatim}\n\\plus{section}{x}\n'
    expect(removeDivisionRef(source, 'x', 'latex')).toBe(
      '\\begin{verbatim}\n\\plus{section}{x}\n\\end{verbatim}\n',
    )
  })

  it('trims only its own whitespace, not a preceding verbatim span', () => {
    // The scan runs on a blanked copy where `\verb|q|` is spaces; trimming the
    // run of blanks to the left has to happen against the *original* text or
    // the `\verb` goes with it.
    expect(removeDivisionRef('\\verb|q|\\plus{section}{x}\n', 'x', 'latex')).toBe('\\verb|q|')
  })

  it("ignores a ref written in another format's syntax", () => {
    const source = '<section xml:id="s"><p>\\plus{section}{x}</p></section>'
    expect(removeDivisionRef(source, 'x', 'pretext')).toBe(source)
  })
})

describe('insertDivisionRef', () => {
  it('places a new ref after the named anchor', () => {
    expect(
      insertDivisionRef('\\plus{section}{a}\n', 'b', 'worksheet', 'a', 'latex'),
    ).toBe('\\plus{section}{a}\n\\plus{worksheet}{b}\n')
  })

  it('does not anchor on a ref inside a verbatim span', () => {
    const source = '\\begin{verbatim}\n\\plus{section}{a}\n\\end{verbatim}\n'
    // No real anchor, so it appends rather than splicing into the example.
    expect(insertDivisionRef(source, 'b', 'worksheet', 'a', 'latex')).toBe(
      source + '\n\\plus{worksheet}{b}',
    )
  })
})
