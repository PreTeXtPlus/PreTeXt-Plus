import { describe, it, expect } from 'vitest'
import { fromXml } from 'xast-util-from-xml'
import type { Element } from 'xast'
import {
  splitDocument,
  mergeDocument,
  createNewSection,
  createIntroduction,
  createConclusion,
  getSectionAttributes,
  sanitizeXmlId,
  slugifyTitle,
  parseMarkdownFrontmatter,
  buildMarkdownFrontmatter,
  parseLatexDivisionHeader,
  splitLatexDocument,
  mergeLatexDocument,
  normalizeDivisionsOnLoad,
  assembleProjectSource,
  assembleFullProjectSource,
  wrapDivisionForPreview,
  DEFAULT_LATEX_IMAGE_PREAMBLE,
  wrapDivisionSource,
  splitDivisionSource,
  divisionToPretext,
} from '../sectionUtils'
import { legacyDivision } from './legacyDivision'
import type { Division } from '../types/sections'
import type { Asset, Snippet } from '../types/editor'

const ARTICLE = `<article xml:id="a1">
\t<title>My Article</title>
\t<introduction>
\t\t<p>Intro text</p>
\t</introduction>
\t<section xml:id="s1">
\t\t<title>First</title>
\t\t<p>Body one</p>
\t</section>
\t<section xml:id="s2">
\t\t<title>Second</title>
\t\t<p>Body two</p>
\t</section>
</article>`

/** Parses `xml`, throwing if it is not well-formed. */
const expectWellFormed = (xml: string) => expect(() => fromXml(xml)).not.toThrow()

describe('splitDocument', () => {
  it('splits an article into its section-level divisions', () => {
    const { sections } = splitDocument(ARTICLE)
    expect(sections.map((s) => [s.type, s.title, s.xmlId])).toEqual([
      ['introduction', 'Introduction', expect.any(String)],
      ['section', 'First', 's1'],
      ['section', 'Second', 's2'],
    ])
  })

  it('keeps the root element and its non-section children in the wrapper', () => {
    const { wrapper } = splitDocument(ARTICLE)
    expect(wrapper).toContain('<article xml:id="a1">')
    expect(wrapper).toContain('<title>My Article</title>')
    expect(wrapper).not.toContain('<section')
    expect(wrapper).not.toContain('Intro text')
  })

  it('falls back to an unsplit document rather than throwing on malformed XML', () => {
    const malformed = '<article><title>Broken</title><section><p>oops'
    expect(() => splitDocument(malformed)).not.toThrow()
    expect(splitDocument(malformed)).toEqual({ wrapper: malformed, sections: [] })
  })

  it('strips an XML declaration before parsing', () => {
    const { sections } = splitDocument(`<?xml version="1.0"?>\n${ARTICLE}`)
    expect(sections).toHaveLength(3)
  })
})

describe('mergeDocument', () => {
  it('round-trips a split document back into well-formed XML', () => {
    const { wrapper, sections } = splitDocument(ARTICLE)
    const merged = mergeDocument(wrapper, sections)

    expectWellFormed(merged)
    expect(merged).toContain('<title>My Article</title>')
    for (const section of sections) {
      expect(merged).toContain(section.source)
    }
  })

  it('re-splits to the same divisions it was merged from', () => {
    const first = splitDocument(ARTICLE)
    const second = splitDocument(mergeDocument(first.wrapper, first.sections))

    // Not xmlId: a division without an `xml:id` of its own (the introduction
    // here) is assigned a freshly generated one on every split.
    expect(second.sections.map((s) => [s.type, s.title, s.source])).toEqual(
      first.sections.map((s) => [s.type, s.title, s.source]),
    )
    expect(second.wrapper).toBe(first.wrapper)
  })

  it('preserves an authored xml:id across the round trip', () => {
    const first = splitDocument(ARTICLE)
    const second = splitDocument(mergeDocument(first.wrapper, first.sections))

    expect(second.sections.filter((s) => s.type === 'section').map((s) => s.xmlId)).toEqual([
      's1',
      's2',
    ])
  })

  it('concatenates section sources when there is no wrapper', () => {
    const sections = [createNewSection('One'), createNewSection('Two')]
    const merged = mergeDocument('', sections)
    expect(merged).toBe(`${sections[0].source}\n\n${sections[1].source}`)
  })
})

describe('division factories', () => {
  it('creates a section carrying its own xml:id and title', () => {
    const section = createNewSection('My Title')
    expect(section.type).toBe('section')
    expect(section.sourceFormat).toBe('pretext')
    expect(section.title).toBe('My Title')
    // The element is the record's: the body holds none of it.
    expect(section.source).not.toContain('<section')
    const wrapped = wrapDivisionSource(section)
    expect(wrapped).toContain(`<section xml:id="${section.xmlId}">`)
    expect(wrapped).toContain('<title>My Title</title>')
    expectWellFormed(wrapped)
  })

  it('creates introductions and conclusions of the right type', () => {
    expect(createIntroduction().type).toBe('introduction')
    expect(createConclusion().type).toBe('conclusion')
    expectWellFormed(wrapDivisionSource(createIntroduction()))
    expectWellFormed(wrapDivisionSource(createConclusion()))
  })

  it('gives each new division a distinct id', () => {
    expect(createNewSection().id).not.toBe(createNewSection().id)
  })
})

describe('getSectionAttributes', () => {
  it('reports empty strings for absent attributes', () => {
    expect(getSectionAttributes('<section><title>T</title></section>')).toEqual({
      xmlId: '',
      label: '',
    })
  })
})

describe('sanitizeXmlId', () => {
  it('replaces characters that are invalid in an NCName', () => {
    expect(sanitizeXmlId('hello world!')).toBe('hello-world-')
    expect(sanitizeXmlId('my.section')).toBe('my-section')
  })

  it('strips leading characters that cannot start an NCName', () => {
    expect(sanitizeXmlId('123abc')).toBe('abc')
    expect(sanitizeXmlId('-.-section')).toBe('section')
  })

  it('returns an empty string when nothing valid remains', () => {
    expect(sanitizeXmlId('   ')).toBe('')
    expect(sanitizeXmlId('123')).toBe('')
  })

  it('leaves a already-valid id untouched', () => {
    expect(sanitizeXmlId('my_section-1')).toBe('my_section-1')
  })
})

describe('slugifyTitle', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyTitle('My Section Title')).toBe('my-section-title')
    expect(slugifyTitle('Introduction: Part 1!')).toBe('introduction-part-1')
    expect(slugifyTitle('Multiple   Spaces')).toBe('multiple-spaces')
  })

  it('always produces a valid xml:id', () => {
    // Leading digits cannot start an NCName, so they are dropped entirely.
    expect(slugifyTitle('123 Numbers')).toBe('numbers')
    expect(slugifyTitle('   ')).toBe('')
  })
})

describe('markdown frontmatter', () => {
  it('round-trips metadata through build and parse', () => {
    const meta = { type: 'section' as const, xmlId: 's1', label: 'L', title: 'My Title' }
    const parsed = parseMarkdownFrontmatter(`${buildMarkdownFrontmatter(meta)}\n# Body\n`)
    expect(parsed).toMatchObject(meta)
    expect(parsed?.body).toBe('# Body\n')
  })

  it('escapes quotes in a title so it survives the round trip', () => {
    const title = 'A "quoted" title'
    const parsed = parseMarkdownFrontmatter(
      `${buildMarkdownFrontmatter({ type: 'section', xmlId: 's1', label: '', title })}\nbody`,
    )
    expect(parsed?.title).toBe(title)
  })

  it('accepts the legacy xmlid and xml:id key spellings', () => {
    expect(parseMarkdownFrontmatter('---\ndivision: section\nxmlid: s1\n---\n')?.xmlId).toBe('s1')
    expect(parseMarkdownFrontmatter('---\ndivision: section\nxml:id: s1\n---\n')?.xmlId).toBe('s1')
  })

  it('returns null when the frontmatter block is absent or unterminated', () => {
    expect(parseMarkdownFrontmatter('# Just a heading\n')).toBeNull()
    expect(parseMarkdownFrontmatter('---\ndivision: section\n')).toBeNull()
  })

})

describe('splitDivisionSource', () => {
  it('takes a PreTeXt wrapper apart, keeping the body byte for byte', () => {
    const body = '\t<p>\n\t\tOne.\n\t</p>\n\n\t<plus:section ref="child"/>'
    const split = splitDivisionSource(
      `<section xml:id="s1" label="L" component="a&amp;b">\n\t<title>Hi <m>x</m></title>\n\n${body}\n\n</section>`,
      'pretext',
    )
    expect(split).toMatchObject({
      type: 'section',
      xmlId: 's1',
      label: 'L',
      title: 'Hi <m>x</m>',
      attrs: { component: 'a&b' },
      body,
      wrapped: true,
      warnings: [],
    })
  })

  it('leaves a <title> that is not the first element in the body', () => {
    const split = splitDivisionSource('<section xml:id="s"><p>x</p><title>T</title></section>', 'pretext')
    expect(split.title).toBe('')
    expect(split.body).toBe('<p>x</p><title>T</title>')
  })

  it('moves a comment outside the element into the body, with a warning', () => {
    const split = splitDivisionSource('<!-- note -->\n<section xml:id="s"><p>x</p></section>', 'pretext')
    expect(split.body).toContain('<!-- note -->')
    expect(split.warnings).toHaveLength(1)
  })

  it("reads a bare fragment's leading title, with the fallback type", () => {
    const split = splitDivisionSource('<title>Doc</title>\n<p>Body</p>', 'pretext', { type: 'article' })
    expect(split).toMatchObject({ type: 'article', title: 'Doc', body: '<p>Body</p>', wrapped: false })
  })

  it('takes a LaTeX header apart, malformed or not', () => {
    expect(splitDivisionSource('\\section{Hello $x$}\\label{s1}\n\nbody', 'latex')).toMatchObject({
      type: 'section',
      title: 'Hello $x$',
      xmlId: 's1',
      body: 'body',
    })
    expect(
      splitDivisionSource('\\section{Hello\\label{sec:hi}}\\label{s1}\nbody', 'latex'),
    ).toMatchObject({ title: 'Hello', xmlId: 's1', body: 'body' })
  })

  it('takes the LaTeX environment style apart', () => {
    expect(
      splitDivisionSource('\\begin{worksheet}\n\\title{Env}\n\\label{w}\nbody\n\\end{worksheet}', 'latex'),
    ).toMatchObject({ type: 'worksheet', title: 'Env', xmlId: 'w', body: 'body' })
  })

  it('treats a headerless LaTeX source as all body', () => {
    expect(
      splitDivisionSource('\\emph{Once} upon a time.', 'latex', { type: 'introduction' }),
    ).toMatchObject({ type: 'introduction', body: '\\emph{Once} upon a time.', wrapped: false })
  })

  it('takes Markdown frontmatter apart, keeping unknown keys as attributes', () => {
    expect(
      splitDivisionSource(
        '---\ndivision: worksheet\nid: w\ntitle: "Hi"\nlabel: L\ncomponent: teacher\n---\n\n# Sub\n',
        'markdown',
      ),
    ).toMatchObject({
      type: 'worksheet',
      xmlId: 'w',
      title: 'Hi',
      label: 'L',
      attrs: { component: 'teacher' },
      body: '# Sub',
    })
  })
})

describe('wrapDivisionSource / divisionToPretext', () => {
  const record = (
    sourceFormat: Division['sourceFormat'],
    source: string,
    fields: Partial<Division> = {},
  ): Division => ({
    id: 's1',
    xmlId: 's1',
    title: 'Hello',
    type: 'section',
    sourceFormat,
    source,
    ...fields,
  })

  it.each([
    ['pretext', '<section xml:id="s1" label="L">\n<title>Hi <m>x</m></title>\n<p>Body</p>\n</section>'],
    ['latex', '\\section{Hello $x$}\\label{s1}\n\nBody.'],
    ['markdown', '---\ndivision: section\nid: s1\ntitle: "Hi"\nlabel: L\ncomponent: "teacher"\n---\n\nBody.'],
  ] as const)('round-trips %s source through split and wrap', (format, source) => {
    const split = splitDivisionSource(source, format)
    const division = record(format, split.body, {
      type: split.type,
      title: split.title,
      label: split.label,
      attrs: split.attrs,
    })
    expect(wrapDivisionSource(division)).toBe(source)
  })

  it("builds a PreTeXt division's element from its fields", () => {
    expect(
      divisionToPretext(record('pretext', '<p>Body</p>', { label: 'L', attrs: { component: 'x' } })),
    ).toBe('<section xml:id="s1" label="L" component="x">\n<title>Hello</title>\n<p>Body</p>\n</section>')
  })

  it('converts a LaTeX division exactly as its header and body together', () => {
    const xml = divisionToPretext(
      record('latex', 'Some text.\n\n\\subsection{Sub}\n\nMore.', { title: 'Hello $x$' }),
    )
    expect(xml).toMatch(/^<section xml:id="s1">/)
    expect(xml).toContain('<title>Hello <m>x</m></title>')
    expect(xml).toContain('<subsection>')
  })

  it('writes a LaTeX division\'s @label, which LaTeX itself cannot spell', () => {
    expect(divisionToPretext(record('latex', 'Text.', { label: 'L' }))).toMatch(
      /^<section xml:id="s1" label="L">/,
    )
  })

  it('wraps a LaTeX introduction around its converted body', () => {
    const xml = divisionToPretext(
      record('latex', 'Some text.', { xmlId: 'i1', type: 'introduction', title: '' }),
    )
    expect(xml).toMatch(/^<introduction xml:id="i1">/)
    expect(xml).toContain('Some text.')
    expectWellFormed(xml)
  })

  it('converts a Markdown division with its frontmatter, so headings keep their depth', () => {
    const xml = divisionToPretext(
      record('markdown', 'Text\n\n# Sub\n\nMore', { attrs: { component: 'teacher' } }),
    )
    expect(xml).toMatch(/^<section xml:id="s1" component="teacher">/)
    expect(xml).toContain('<subsection>')
  })

  it('reads a Markdown slideshow root\'s ## as slides', () => {
    const xml = divisionToPretext(
      record('markdown', '# Sec\n\n## Slide\n\nhi', { xmlId: 'deck', type: 'slideshow', title: 'Deck' }),
    )
    expect(xml).toMatch(/^<slideshow xml:id="deck">/)
    expect(xml).toContain('<slide>')
  })
})

describe('parseLatexDivisionHeader', () => {
  it('reads a well-formed header', () => {
    expect(parseLatexDivisionHeader('\\section{Hello}\\label{s1}\n\nbody')).toEqual({
      macro: 'section',
      starred: false,
      title: 'Hello',
      label: 's1',
      length: '\\section{Hello}\\label{s1}'.length,
    })
  })

  it('keeps the star of a starred header', () => {
    const header = parseLatexDivisionHeader('\\section*{Hi}\nbody')
    expect(header!.starred).toBe(true)
    expect(header!.macro).toBe('section')
  })

  it('brace-matches the title argument rather than stopping at the first }', () => {
    // The hand-written LaTeX idiom: the label lives inside the section argument.
    const header = parseLatexDivisionHeader('\\section{Hello\\label{sec:hi}}\nbody')
    expect(header!.title).toBe('Hello')
    expect(header!.label).toBe('sec:hi')
    expect(header!.length).toBe('\\section{Hello\\label{sec:hi}}'.length)
  })

  it('swallows the wreckage of a doubly-labelled header', () => {
    // The reported bug: an import left `\label{…}}` inside the argument and the
    // editor then appended the division's own label after it.
    const broken = '\\section{Hello\\label{sec:hi}}\\label{s1}\nbody'
    const header = parseLatexDivisionHeader(broken)
    expect(header!.title).toBe('Hello')
    // The label the TOC form wrote wins over the one buried in the argument.
    expect(header!.label).toBe('s1')
    expect(broken.slice(header!.length)).toBe('\nbody')
  })

  it('does not read past the end of the first line', () => {
    const header = parseLatexDivisionHeader('\\section{Unclosed\nbody')
    expect(header!.title).toBe('Unclosed')
    expect(header!.length).toBe('\\section{Unclosed'.length)
  })

  it('ignores an environment-style division', () => {
    expect(parseLatexDivisionHeader('\\begin{section}\nbody\n\\end{section}')).toBeNull()
    expect(parseLatexDivisionHeader('% Introduction\n\nbody')).toBeNull()
  })
})

describe('latex documents', () => {
  it('splits a document at \\section commands and keeps the preamble', () => {
    const latex =
      '\\documentclass{article}\n\\begin{document}\nintro\n\\section{One}\nbody1\n\\section{Two}\nbody2\n\\end{document}'
    const { wrapper, sections } = splitLatexDocument(latex)

    expect(sections.map((s) => [s.type, s.title])).toEqual([
      ['introduction', 'Introduction'],
      ['section', 'One'],
      ['section', 'Two'],
    ])

    const merged = mergeLatexDocument(wrapper, sections)
    expect(merged).toContain('\\documentclass{article}')
    expect(merged).toContain('\\section{One}')
    expect(merged).toContain('\\section{Two}')
    expect(merged).toContain('\\end{document}')
  })
})

// A division's type is a field of its record, but a host need not have stored
// one for every division; the editor fills in a default rather than leaving
// the TOC unable to label a row or restrict what its children may be.
describe('normalizeDivisionsOnLoad type backfill', () => {
  /** A division as a host may send it: source and ids, no type. */
  const untyped = (xmlId: string) =>
    ({ id: xmlId, xmlId, title: '', source: '<p>x</p>', sourceFormat: 'pretext' }) as Division

  it('gives an untyped root the project type, and anything else a section', () => {
    const [root, child] = normalizeDivisionsOnLoad([untyped('bk'), untyped('ch')], 'bk', 'book')
    expect(root.type).toBe('book')
    expect(child.type).toBe('section')
  })

  it('falls back to an article for an unknown project type', () => {
    const [root] = normalizeDivisionsOnLoad([untyped('r')], 'r', undefined)
    expect(root.type).toBe('article')
  })

  it('never overrides a type the host did supply, nor touches the source', () => {
    const typed = { ...untyped('ch'), type: 'chapter' } as Division
    const [chapter] = normalizeDivisionsOnLoad([typed], 'bk', 'book')
    expect(chapter).toBe(typed)
  })
})

describe('assembleFullProjectSource / wrapDivisionForPreview — xml:lang', () => {
  const root: Division = {
    id: '1',
    xmlId: 'a1',
    title: 'My Article',
    type: 'article',
    sourceFormat: 'pretext',
    source: ARTICLE,
  }

  it('writes @xml:lang on the root <pretext> element when a lang is given', () => {
    const xml = assembleFullProjectSource([root], 'a1', '', [], 'af-ZA')
    expect(xml).toMatch(/^<pretext xml:lang="af-ZA">/)
    expectWellFormed(xml)
  })

  it('omits @xml:lang entirely when no lang is given', () => {
    const xml = assembleFullProjectSource([root], 'a1', '', [])
    expect(xml).toMatch(/^<pretext>/)
    expect(xml).not.toContain('xml:lang')
  })

  it('writes @xml:lang for a division-scoped preview too', () => {
    const xml = wrapDivisionForPreview('article', ARTICLE, '', 'My Article', 'fr-CA')
    expect(xml).toMatch(/^<pretext xml:lang="fr-CA">/)
    expectWellFormed(xml)
  })
})

// Unit-tested rather than checked by eye because the failure mode is an *empty*
// preview, not an error: the renderer sees the <slide> elements, selects the
// reveal.js conversion, and hands it a root element it has no template for. A
// visual check on a deck that legitimately has no content yet looks identical.
describe('wrapDivisionForPreview — the project root type', () => {
  const SLIDES =
    '<section xml:id="sec"><title>Sec</title><slide><title>One</title><p>Hi</p></slide></section>'

  /**
   * The wrapper element's tag name — it also carries a root `@label`. Past the
   * `<docinfo>`, which every document has, if only for its image preamble.
   */
  const wrapperTag = (xml: string) =>
    xml.match(/^<pretext[^>]*>\s*(?:<docinfo>[\s\S]*?<\/docinfo>\s*)?<([a-z-]+)/)?.[1]

  it('wraps a non-root division of a slideshow in <slideshow>', () => {
    const xml = wrapDivisionForPreview('section', SLIDES, '', 'My Deck', undefined, 'slideshow')
    expect(wrapperTag(xml)).toBe('slideshow')
    expect(xml).toContain('<title>My Deck</title>')
    expectWellFormed(xml)
  })

  it('still wraps a non-root division of an article in <article>', () => {
    const xml = wrapDivisionForPreview('section', SLIDES, '', 'My Article', undefined, 'article')
    expect(wrapperTag(xml)).toBe('article')
    expectWellFormed(xml)
  })

  it('defaults to <article> when the root type is not given', () => {
    const xml = wrapDivisionForPreview('section', SLIDES, '', 'My Article')
    expect(wrapperTag(xml)).toBe('article')
    expectWellFormed(xml)
  })

  // part/chapter can only occur in a book, so a slideshow root never reaches
  // this branch in practice — but the book rule must not be lost either.
  it('keeps the <book> wrapper for a chapter', () => {
    const chapter = '<chapter xml:id="ch"><title>Ch</title><p>Hi</p></chapter>'
    const xml = wrapDivisionForPreview('chapter', chapter, '', 'My Book', undefined, 'book')
    expect(wrapperTag(xml)).toBe('book')
    expectWellFormed(xml)
  })

  // A <slideshow> root division is already a complete top-level element, so it
  // must be passed through rather than nested inside a second one.
  it('adds no wrapper to a slideshow root division', () => {
    const deck = '<slideshow xml:id="d"><title>D</title><slide><p>Hi</p></slide></slideshow>'
    const xml = wrapDivisionForPreview('slideshow', deck, '', 'D', undefined, 'slideshow')
    expect(xml.match(/<slideshow\b/g)).toHaveLength(1)
    expect(xml).not.toContain('<title>D</title>\n<slideshow')
    expectWellFormed(xml)
  })
})

// The root `@label` is what the previewer matches the root division on, and it
// is added by scanning for the root element's start tag rather than parsing the
// document — assembling a book means assembling the whole project, and parsing
// all of it to reach one attribute dominated every preview rebuild. These pin
// down the constructs that scan has to survive.
describe('root @label on an assembled document', () => {
  const div = (source: string, type: Division['type'] = 'article'): Division =>
    legacyDivision({
      id: '1',
      xmlId: '',
      title: 'My Article',
      type,
      sourceFormat: 'pretext',
      source,
    })

  const rootTagOf = (xml: string) =>
    /<(?:book|article|slideshow)\b[^>]*>/.exec(xml)?.[0] ?? ''

  it('copies the root @xml:id into a @label', () => {
    const xml = assembleFullProjectSource([div(ARTICLE)], 'a1', '')
    expect(rootTagOf(xml)).toContain('label="a1"')
  })

  it('leaves an existing @label alone', () => {
    const source = ARTICLE.replace(
      '<article xml:id="a1">',
      '<article xml:id="a1" label="chosen">',
    )
    const xml = assembleFullProjectSource([div(source)], 'a1', '')
    expect(rootTagOf(xml)).toContain('label="chosen"')
    expect(rootTagOf(xml)).not.toContain('label="a1"')
  })

  it('changes nothing but the root start tag', () => {
    const root = div(ARTICLE)
    const xml = assembleFullProjectSource([root], 'a1', '')
    // The body is byte-for-byte what went in, which is what keeps preview
    // line numbers aligned with the editor buffer.
    expect(xml).toContain(root.source)
    expectWellFormed(xml)
  })

  it('falls back to "main" when the root has no @xml:id, avoiding collisions', () => {
    const noId = ARTICLE.replace('<article xml:id="a1">', '<article>')
    expect(rootTagOf(assembleFullProjectSource([div(noId)], '', ''))).toContain(
      'label="main"',
    )

    const taken = noId.replace('<section xml:id="s1">', '<section label="main">')
    expect(rootTagOf(assembleFullProjectSource([div(taken)], '', ''))).toContain(
      'label="main-1"',
    )
  })

  it('finds the root division past <docinfo> and its subtree', () => {
    const docinfo = `<docinfo>
  <macros>\\newcommand{\\R}{\\mathbb{R}}</macros>
  <cross-references text="type-global"/>
</docinfo>`
    const xml = assembleFullProjectSource([div(ARTICLE)], 'a1', docinfo)
    expect(rootTagOf(xml)).toContain('label="a1"')
    expect(xml).toContain('<macros>')
    expectWellFormed(xml)
  })

  // Asserted on the whole document rather than via `rootTagOf`: a naive tag
  // regex is fooled by exactly these two constructs, which is the point.
  it('is not fooled by a comment that mentions a root element', () => {
    const source = `<!-- an <article> in a comment, and a <book> too -->\n${ARTICLE}`
    const xml = assembleFullProjectSource([div(source)], 'a1', '')
    expect(xml).toContain('<article xml:id="a1" label="a1">')
    expect(xml).toContain('<!-- an <article> in a comment, and a <book> too -->')
  })

  it('is not fooled by a > inside an attribute value', () => {
    const source = ARTICLE.replace(
      '<article xml:id="a1">',
      '<article xml:id="a1" data-note="a > b">',
    )
    const xml = assembleFullProjectSource([div(source)], 'a1', '')
    expect(xml).toContain('<article xml:id="a1" data-note="a > b" label="a1">')
    expectWellFormed(xml)
  })

  it('leaves a non-root division untouched', () => {
    const section = div('<section xml:id="s1"><title>First</title><p>Body</p></section>', 'section')
    expect(assembleProjectSource([section], 's1')).toBe(wrapDivisionSource(section))
  })
})

// A TikZ <latex-image> needs TikZ loaded in the image preamble, which authors
// kept having to discover for themselves. Every assembled document now loads it.
describe('default latex-image preamble', () => {
  const div: Division = {
    id: '1',
    xmlId: 'a1',
    title: 'My Article',
    type: 'article',
    sourceFormat: 'pretext',
    source: ARTICLE,
  }
  const build = (docinfo: string) => assembleFullProjectSource([div], 'a1', docinfo)

  const childElements = (node: { children: unknown[] }, name: string) =>
    (node.children as Element[]).filter((n) => n.type === 'element' && n.name === name)

  /** Every `<latex-image-preamble>` directly inside the document's `<docinfo>`. */
  const preamblesOf = (xml: string) => {
    const [pretext] = childElements(fromXml(xml), 'pretext')
    const [docinfo] = childElements(pretext, 'docinfo')
    return childElements(docinfo, 'latex-image-preamble')
  }

  /** The preamble PreTeXt reads: the first one without `@syntax`. */
  const preambleOf = (xml: string) => {
    const preamble = preamblesOf(xml).find((el) => !('syntax' in el.attributes))
    return preamble?.children.map((c) => ('value' in c ? c.value : '')).join('').trim()
  }

  it('adds a docinfo when the project has none', () => {
    expect(preambleOf(build(''))).toBe(DEFAULT_LATEX_IMAGE_PREAMBLE)
    expect(preambleOf(build('<docinfo/>'))).toBe(DEFAULT_LATEX_IMAGE_PREAMBLE)
  })

  it('adds a preamble alongside the rest of the docinfo', () => {
    const docinfo = `<docinfo>
  <macros>\\newcommand{\\R}{\\mathbb{R}}</macros>
  <cross-references text="type-global"/>
</docinfo>`
    const xml = build(docinfo)
    expect(xml).toContain(`<docinfo>
  <macros>\\newcommand{\\R}{\\mathbb{R}}</macros>
  <cross-references text="type-global"/>
  <latex-image-preamble>
${DEFAULT_LATEX_IMAGE_PREAMBLE}
</latex-image-preamble>
</docinfo>`)
    expect(preambleOf(xml)).toBe(DEFAULT_LATEX_IMAGE_PREAMBLE)
  })

  it("puts TikZ ahead of the author's own preamble, which may build on it", () => {
    const docinfo =
      '<docinfo><latex-image-preamble>\\usetikzlibrary{arrows}\n</latex-image-preamble></docinfo>'
    const xml = build(docinfo)
    expect(preamblesOf(xml)).toHaveLength(1)
    expect(preambleOf(xml)).toBe(`${DEFAULT_LATEX_IMAGE_PREAMBLE}\n\\usetikzlibrary{arrows}`)
  })

  it('fills in an empty preamble element', () => {
    expect(preambleOf(build('<docinfo><latex-image-preamble/></docinfo>'))).toBe(
      DEFAULT_LATEX_IMAGE_PREAMBLE,
    )
  })

  it('leaves a preamble for another @syntax alone', () => {
    const pgf = '<latex-image-preamble syntax="PGF">\\pgfkeys{}</latex-image-preamble>'
    const alone = build(`<docinfo>${pgf}</docinfo>`)
    expect(alone).toContain(pgf)
    expect(preambleOf(alone)).toBe(DEFAULT_LATEX_IMAGE_PREAMBLE)

    const beside = build(
      `<docinfo>${pgf}<latex-image-preamble>\\usepackage{x}</latex-image-preamble></docinfo>`,
    )
    expect(beside).toContain(pgf)
    expect(preamblesOf(beside)).toHaveLength(2)
    expect(preambleOf(beside)).toBe(`${DEFAULT_LATEX_IMAGE_PREAMBLE}\n\\usepackage{x}`)
  })

  it('is not fooled by a preamble in a comment or nested deeper', () => {
    const docinfo =
      '<docinfo><!-- <latex-image-preamble> --><rename><latex-image-preamble/></rename></docinfo>'
    const xml = build(docinfo)
    expect(xml).toContain('<!-- <latex-image-preamble> --><rename><latex-image-preamble/></rename>')
    expect(preambleOf(xml)).toBe(DEFAULT_LATEX_IMAGE_PREAMBLE)
    expectWellFormed(xml)
  })

  it('passes a docinfo it cannot read through unchanged', () => {
    expect(build('<macros>x</macros>')).toContain('<pretext>\n<macros>x</macros>\n<article')
  })

  it('is in a division preview too', () => {
    const xml = wrapDivisionForPreview('section', '<section xml:id="s1"/>', '', 'Title')
    expect(preambleOf(xml)).toBe(DEFAULT_LATEX_IMAGE_PREAMBLE)
  })
})

// Assembly walks the whole project on every keystroke while only the division
// being typed in has changed, so conversions are cached per division. The cache
// is keyed on xml:id and validated against the source, so the risk it carries
// is serving a stale conversion — which is what these cover.
describe('per-division conversion caching', () => {
  const latexDivision = (source: string): Division => ({
    id: '1',
    xmlId: 'sec-1',
    title: 'A Section',
    type: 'section',
    sourceFormat: 'latex',
    source,
  })

  it('reflects an edit to a division it has already converted', () => {
    const first = assembleProjectSource(
      [latexDivision('Before the edit.')],
      'sec-1',
    )
    expect(first).toContain('Before the edit.')

    const second = assembleProjectSource(
      [latexDivision('After the edit.')],
      'sec-1',
    )
    expect(second).toContain('After the edit.')
    expect(second).not.toContain('Before the edit.')
  })

  it('returns the same conversion for unchanged source', () => {
    const division = latexDivision('Stable.')
    expect(assembleProjectSource([division], 'sec-1')).toBe(
      assembleProjectSource([division], 'sec-1'),
    )
  })

  it('reflects a title edit, though the body is unchanged', () => {
    const before = assembleProjectSource([latexDivision('Body.')], 'sec-1')
    const after = assembleProjectSource([{ ...latexDivision('Body.'), title: 'Renamed' }], 'sec-1')
    expect(before).toContain('<title>A Section</title>')
    expect(after).toContain('<title>Renamed</title>')
  })

  it('does not confuse two divisions that share an xml:id across projects', () => {
    const projectA = assembleProjectSource(
      [latexDivision('Project A.')],
      'sec-1',
    )
    const projectB = assembleProjectSource(
      [latexDivision('Project B.')],
      'sec-1',
    )
    expect(projectA).toContain('Project A.')
    expect(projectB).toContain('Project B.')
  })
})

// A `<plus:snippet ref="..."/>` placeholder splices in the named Snippet's own
// resolved content, recursively -- unlike an asset (a leaf), a snippet can
// itself embed further snippet/image refs.
describe('snippet resolution in assembleFullProjectSource', () => {
  const div = (source: string): Division => ({
    id: '1',
    xmlId: 'a1',
    title: 'My Article',
    type: 'article',
    sourceFormat: 'pretext',
    source,
  })

  const snippet = (ref: string, source: string, sourceFormat: Snippet['sourceFormat'] = 'pretext'): Snippet => ({
    id: ref,
    ref,
    source,
    sourceFormat,
  })

  it('splices the snippet source in place of the placeholder', () => {
    const source = ARTICLE.replace('<p>Body one</p>', '<p>Body one</p><plus:snippet ref="note"/>')
    const xml = assembleFullProjectSource([div(source)], 'a1', '', [], undefined, [
      snippet('note', '<p>A shared note.</p>'),
    ])
    expect(xml).toContain('<p>A shared note.</p>')
    expect(xml).not.toContain('<plus:snippet')
  })

  it('renders a comment for a ref with no matching snippet', () => {
    const source = ARTICLE.replace('<p>Body one</p>', '<p>Body one</p><plus:snippet ref="missing"/>')
    const xml = assembleFullProjectSource([div(source)], 'a1', '', [], undefined, [])
    expect(xml).toContain('<!-- missing snippet: missing -->')
  })

  it('renders a comment rather than recursing forever on a snippet that includes itself', () => {
    const source = ARTICLE.replace('<p>Body one</p>', '<p>Body one</p><plus:snippet ref="loop"/>')
    const xml = assembleFullProjectSource([div(source)], 'a1', '', [], undefined, [
      snippet('loop', '<p>before</p><plus:snippet ref="loop"/><p>after</p>'),
    ])
    expect(xml).toContain('<!-- circular reference: loop -->')
  })

  it('recursively resolves a further snippet ref inside a snippet', () => {
    const source = ARTICLE.replace('<p>Body one</p>', '<p>Body one</p><plus:snippet ref="outer"/>')
    const xml = assembleFullProjectSource([div(source)], 'a1', '', [], undefined, [
      snippet('outer', '<p>outer</p><plus:snippet ref="inner"/>'),
      snippet('inner', '<p>inner</p>'),
    ])
    expect(xml).toContain('<p>outer</p>')
    expect(xml).toContain('<p>inner</p>')
    expect(xml).not.toContain('<plus:snippet')
  })

  it('resolves an image ref embedded inside a snippet', () => {
    const asset: Asset = { id: 'img-1', ref: 'photo', title: 'Photo', isFile: true, fileRef: 'photo.png' }
    const source = ARTICLE.replace('<p>Body one</p>', '<p>Body one</p><plus:snippet ref="figure"/>')
    const xml = assembleFullProjectSource([div(source)], 'a1', '', [asset], undefined, [
      snippet('figure', '<plus:image ref="photo"/>'),
    ])
    expect(xml).toContain('source="photo.png"')
  })

  it('converts a latex/markdown snippet to PreTeXt before splicing it in', () => {
    const source = ARTICLE.replace('<p>Body one</p>', '<p>Body one</p><plus:snippet ref="tex-note"/>')
    const xml = assembleFullProjectSource([div(source)], 'a1', '', [], undefined, [
      snippet('tex-note', '\\section{Hi}', 'latex'),
    ])
    expect(xml).toContain('<title>Hi</title>')
  })

  it('a placeholder may repeat, resolving the same snippet each time', () => {
    const source = ARTICLE.replace(
      '<p>Body one</p>',
      '<p>Body one</p><plus:snippet ref="note"/><plus:snippet ref="note"/>',
    )
    const xml = assembleFullProjectSource([div(source)], 'a1', '', [], undefined, [
      snippet('note', '<p>shared</p>'),
    ])
    expect(xml.match(/<p>shared<\/p>/g)).toHaveLength(2)
  })
})

// Every attribute on a `<plus:* ref/>` placeholder except `ref` belongs to the
// element that replaces it, not to the placeholder. This is how `@component`
// reaches a division that is included by reference rather than written inline
// -- there is no other place to put it, since the division's own source is
// shared by every include of it.
describe('placeholder attribute pass-through', () => {
  const article = (body: string): Division => ({
    id: '1',
    xmlId: 'a1',
    title: 'My Article',
    type: 'article',
    sourceFormat: 'pretext',
    source: body,
  })

  const section = (xmlId: string, body = '<p>Body</p>'): Division => ({
    id: xmlId,
    xmlId,
    title: 'A Section',
    type: 'section',
    sourceFormat: 'pretext',
    source: body,
  })

  const photo: Asset = { id: 'i', ref: 'photo', title: 'Photo', isFile: true, fileRef: 'photo.png' }

  it('copies @component from the placeholder onto the included division', () => {
    const xml = assembleProjectSource(
      [article('<plus:section ref="s1" component="teacher"/>'), section('s1')],
      'a1',
    )
    expect(xml).toContain('<section xml:id="s1" component="teacher">')
    expectWellFormed(xml)
  })

  // The point of putting it on the include rather than on the record: one
  // division embedded twice can carry a different component each time.
  it('gives each include of the same division its own attributes', () => {
    const xml = assembleProjectSource(
      [
        article(
          '<plus:section ref="s1" component="teacher"/><plus:section ref="s1" component="student"/>',
        ),
        section('s1'),
      ],
      'a1',
    )
    expect(xml).toContain('component="teacher"')
    expect(xml).toContain('component="student"')
  })

  // The conversion cache is keyed on xml:id, so an attribute applied before
  // the cache would be shared by every reference to the division.
  it('does not leak attributes through the conversion cache', () => {
    const latexSection: Division = {
      id: 's1',
      xmlId: 's1',
      title: 'A Section',
      type: 'section',
      sourceFormat: 'latex',
      source: '\\section{A Section}\\label{s1}\n\nBody.\n',
    }
    const tagged = assembleProjectSource(
      [article('<plus:section ref="s1" component="teacher"/>'), latexSection],
      'a1',
    )
    expect(tagged).toContain('component="teacher"')

    const plain = assembleProjectSource(
      [article('<plus:section ref="s1"/>'), latexSection],
      'a1',
    )
    expect(plain).not.toContain('component=')
  })

  // Only the outermost element: a @component on an include means "leave this
  // division out", not "tag every paragraph inside it".
  it('applies to the division element alone, not its descendants', () => {
    const xml = assembleProjectSource(
      [
        article('<plus:section ref="s1" component="teacher"/>'),
        section('s1', '<p>One</p><p>Two</p>'),
      ],
      'a1',
    )
    expect(xml).toContain('<section xml:id="s1" component="teacher">')
    expect(xml).not.toContain('<p component=')
  })

  it('passes attributes down to a nested include independently', () => {
    const xml = assembleProjectSource(
      [
        article('<plus:section ref="s1" component="teacher"/>'),
        {
          ...section('s1', '<plus:subsection ref="s2" component="student"/>'),
        },
        { ...section('s2'), type: 'subsection' as Division['type'] },
      ],
      'a1',
    )
    expect(xml).toContain('<section xml:id="s1" component="teacher">')
    expect(xml).toContain('<subsection xml:id="s2" component="student">')
  })

  // The placeholder is the more local statement, and a duplicate attribute is
  // not well-formed XML -- so it replaces rather than appends.
  it('overrides an attribute the division already carries', () => {
    const xml = assembleProjectSource(
      [
        article('<plus:section ref="s1" component="teacher"/>'),
        { ...section('s1'), attrs: { component: 'student' } },
      ],
      'a1',
    )
    expect(xml).toContain('component="teacher"')
    expect(xml).not.toContain('component="student"')
    expectWellFormed(xml)
  })

  // `width` used to be plucked off the placeholder by name; it now rides the
  // same general path, and must still land on the generated <image>.
  it('carries @width onto a resolved image asset', () => {
    const xml = assembleProjectSource(
      [article('<p><plus:image ref="photo" width="50%"/></p>')],
      'a1',
      [photo],
    )
    expect(xml).toContain('source="photo.png"')
    expect(xml).toContain('width="50%"')
    expectWellFormed(xml)
  })

  it('carries @component onto a resolved image asset', () => {
    const xml = assembleProjectSource(
      [article('<p><plus:image ref="photo" component="teacher"/></p>')],
      'a1',
      [photo],
    )
    expect(xml).toContain('component="teacher"')
  })

  // A snippet is the one kind whose replacement can be several elements, with
  // no single tag to hang the attribute on. Each top-level element gets it,
  // which is what @component means.
  it('applies to every top-level element of a multi-element snippet', () => {
    const xml = assembleProjectSource(
      [article('<plus:snippet ref="note" component="teacher"/>')],
      'a1',
      [],
      [{ id: 'note', ref: 'note', source: '<p>One</p><p>Two</p>', sourceFormat: 'pretext' }],
    )
    expect(xml).toContain('<p component="teacher">One</p>')
    expect(xml).toContain('<p component="teacher">Two</p>')
    expectWellFormed(xml)
  })

  // A ref that resolves to nothing comes back as an XML comment, which has no
  // element to write onto -- it must pass through untouched rather than being
  // mangled into invalid markup.
  it('leaves an unresolved ref comment alone', () => {
    const xml = assembleProjectSource(
      [article('<plus:section ref="missing" component="teacher"/>')],
      'a1',
    )
    expect(xml).toContain('<!-- missing division: missing -->')
    expect(xml).not.toContain('component=')
    expectWellFormed(xml)
  })

  it('never copies the ref attribute itself', () => {
    const xml = assembleProjectSource(
      [article('<plus:section ref="s1"/>'), section('s1')],
      'a1',
    )
    expect(xml).not.toContain('ref="s1"')
  })

  it('preserves escaping in a passed-through value', () => {
    const xml = assembleProjectSource(
      [article('<plus:section ref="s1" component="a &amp; b"/>'), section('s1')],
      'a1',
    )
    expect(xml).toContain('component="a &amp; b"')
    expectWellFormed(xml)
  })

  // Markdown and LaTeX holders write the same fact in their own syntax; both
  // converters already emit it as an attribute on the placeholder.
  it('reaches assembly from a markdown or latex holder', () => {
    const markdownHolder: Division = {
      id: '1',
      xmlId: 'a1',
      title: 'My Article',
      type: 'article',
      sourceFormat: 'markdown',
      source: '---\ntype: article\nxml_id: a1\ntitle: My Article\n---\n\n::section{ref="s1" component="teacher"}\n',
    }
    expect(assembleProjectSource([markdownHolder, section('s1')], 'a1')).toContain(
      'component="teacher"',
    )

    const latexHolder: Division = {
      id: '1',
      xmlId: 'a1',
      title: 'My Article',
      type: 'article',
      sourceFormat: 'latex',
      source: '\\article{My Article}\\label{a1}\n\n\\plus[component=teacher]{section}{s1}\n',
    }
    expect(assembleProjectSource([latexHolder, section('s1')], 'a1')).toContain(
      'component="teacher"',
    )
  })
})
