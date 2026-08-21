import { describe, it, expect } from 'vitest'
import { fromXml } from 'xast-util-from-xml'
import {
  splitDocument,
  mergeDocument,
  stripSectionWrapper,
  rewrapSection,
  ensureSectionWrapper,
  createNewSection,
  createIntroduction,
  createConclusion,
  updateSectionMetadata,
  updateDivisionTitle,
  extractDivisionMetadata,
  getSectionAttributes,
  sanitizeXmlId,
  slugifyTitle,
  parseMarkdownFrontmatter,
  buildMarkdownFrontmatter,
  extractMarkdownDivisionMetadata,
  updateMarkdownDivisionMetadata,
  extractLatexDivisionTitle,
  extractLatexSectionLabel,
  updateLatexDivisionMetadata,
  splitLatexDocument,
  mergeLatexDocument,
  normalizeDivisionsOnLoad,
  assembleProjectSource,
  assembleFullProjectSource,
  wrapDivisionForPreview,
} from '../sectionUtils'
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

describe('stripSectionWrapper / rewrapSection / ensureSectionWrapper', () => {
  it('strips the outer element but keeps every child', () => {
    const inner = stripSectionWrapper(
      '<section xml:id="s1">\n\t<title>T</title>\n\t<p>hi</p>\n</section>',
    )
    expect(inner).not.toContain('<section')
    expect(inner).toContain('<title>T</title>')
    expect(inner).toContain('<p>hi</p>')
  })

  it('round-trips content through strip and rewrap', () => {
    const original = '<section>\n<title>T</title>\n<p>hi</p>\n</section>'
    expect(rewrapSection(stripSectionWrapper(original), 'section')).toBe(original)
  })

  // Malformed XML is routine while the user is mid-keystroke; a throw here
  // takes down the whole editor, so the regex fallback must hold.
  it('falls back to a string strip on malformed XML instead of throwing', () => {
    const malformed = '<section xml:id="s1">\n\t<title>T</title>\n\t<p>hi'
    expect(() => stripSectionWrapper(malformed)).not.toThrow()
    const inner = stripSectionWrapper(malformed)
    expect(inner).not.toContain('<section')
    expect(inner).toContain('<title>T</title>')
  })

  it('wraps with the requested division type', () => {
    expect(rewrapSection('<p>x</p>', 'introduction')).toBe(
      '<introduction>\n<p>x</p>\n</introduction>',
    )
  })

  it('only adds a wrapper when one is missing', () => {
    const wrapped = '<section><p>x</p></section>'
    expect(ensureSectionWrapper(wrapped, 'section')).toBe(wrapped)
    expect(ensureSectionWrapper('  <section><p>x</p></section>', 'section')).toBe(
      '  <section><p>x</p></section>',
    )
    expect(ensureSectionWrapper('<p>x</p>', 'section')).toBe('<section>\n<p>x</p>\n</section>')
  })
})

describe('division factories', () => {
  it('creates a section carrying its own xml:id and title', () => {
    const section = createNewSection('My Title')
    expect(section.type).toBe('section')
    expect(section.sourceFormat).toBe('pretext')
    expect(section.title).toBe('My Title')
    expect(section.source).toContain(`xml:id="${section.xmlId}"`)
    expect(section.source).toContain('<title>My Title</title>')
    expectWellFormed(section.source)
  })

  it('creates introductions and conclusions of the right type', () => {
    expect(createIntroduction().type).toBe('introduction')
    expect(createConclusion().type).toBe('conclusion')
    expectWellFormed(createIntroduction().source)
    expectWellFormed(createConclusion().source)
  })

  it('gives each new division a distinct id', () => {
    expect(createNewSection().id).not.toBe(createNewSection().id)
  })
})

describe('updateSectionMetadata', () => {
  const section: Division = {
    id: '1',
    xmlId: 's1',
    title: 'Old',
    type: 'section',
    sourceFormat: 'pretext',
    source: '<section xml:id="s1" label="old-label"><title>Old</title><p>body</p></section>',
  }

  it('rewrites the tag name, attributes and title together', () => {
    const updated = updateSectionMetadata(section, {
      title: 'New',
      type: 'exercises',
      xmlId: 'e1',
      label: 'new-label',
    })

    expect(updated.type).toBe('exercises')
    expect(updated.title).toBe('New')
    expect(updated.xmlId).toBe('e1')
    expect(updated.source).toBe(
      '<exercises xml:id="e1" label="new-label"><title>New</title><p>body</p></exercises>',
    )
  })

  it('leaves omitted fields alone', () => {
    const updated = updateSectionMetadata(section, { title: 'Renamed' })
    expect(updated.source).toContain('xml:id="s1"')
    expect(updated.source).toContain('label="old-label"')
    expect(updated.source).toContain('<section')
  })

  it('removes an attribute when passed null', () => {
    const updated = updateSectionMetadata(section, { label: null })
    expect(updated.source).not.toContain('label=')
    expect(updated.source).toContain('xml:id="s1"')
  })

  it('preserves the body when the title is changed', () => {
    expect(updateSectionMetadata(section, { title: 'New' }).source).toContain('<p>body</p>')
  })

  it('parses inline markup typed into a title rather than escaping it', () => {
    const updated = updateSectionMetadata(section, { title: 'A <term>term</term>' })
    expect(updated.source).toContain('<title>A <term>term</term></title>')
  })

  it('does not throw on malformed source', () => {
    const broken = { ...section, source: '<section><title>Old</title><p>body' }
    expect(() => updateSectionMetadata(broken, { title: 'New' })).not.toThrow()
    expect(updateSectionMetadata(broken, { title: 'New' }).title).toBe('New')
  })
})

describe('updateDivisionTitle', () => {
  it('replaces an existing title', () => {
    expect(
      updateDivisionTitle('<section><title>Old</title><p>b</p></section>', 'New'),
    ).toBe('<section><title>New</title><p>b</p></section>')
  })

  it('inserts a title when the division has none', () => {
    expect(updateDivisionTitle('<section><p>b</p></section>', 'New')).toBe(
      '<section><title>New</title><p>b</p></section>',
    )
  })

  it('returns the input unchanged on malformed XML', () => {
    const malformed = '<section><title>Old</title><p>b'
    expect(updateDivisionTitle(malformed, 'New')).toBe(malformed)
  })
})

describe('extractDivisionMetadata / getSectionAttributes', () => {
  it('reads title, type and attributes off a division', () => {
    expect(
      extractDivisionMetadata('<section xml:id="s1" label="L"><title>T</title></section>'),
    ).toEqual({ title: 'T', type: 'section', xmlId: 's1', label: 'L' })
  })

  it('returns null for malformed XML or a non-division root', () => {
    expect(extractDivisionMetadata('<section><title>broken')).toBeNull()
    expect(extractDivisionMetadata('<paragraph>not a division</paragraph>')).toBeNull()
  })

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

  it('falls back to a leading heading when frontmatter carries no title', () => {
    expect(
      extractMarkdownDivisionMetadata('---\ndivision: section\nid: s1\n---\n# From Heading\n'),
    ).toEqual({ title: 'From Heading', type: 'section', xmlId: 's1', label: '' })
  })

  it('rewrites frontmatter without touching the body', () => {
    const division = {
      id: '1',
      xmlId: 's1',
      title: 'Old',
      type: 'section' as const,
      sourceFormat: 'markdown' as const,
      source: '---\ndivision: section\nid: s1\ntitle: "Old"\n---\nbody text\n',
    }
    const updated = updateMarkdownDivisionMetadata(division, {
      title: 'New',
      type: 'worksheet',
    })

    expect(updated.title).toBe('New')
    expect(updated.type).toBe('worksheet')
    expect(updated.source).toContain('division: worksheet')
    expect(updated.source).toContain('body text')
    expect(updated.source).not.toContain('<title>')
  })

  it('keeps the existing xml:id rather than clearing it', () => {
    const division = {
      id: '1',
      xmlId: 's1',
      title: 'T',
      type: 'section' as const,
      sourceFormat: 'markdown' as const,
      source: '---\ndivision: section\nid: s1\n---\nbody\n',
    }
    expect(updateMarkdownDivisionMetadata(division, { xmlId: '' }).xmlId).toBe('s1')
  })
})

describe('latex divisions', () => {
  const division = {
    id: '1',
    xmlId: 's1',
    title: 'Hello',
    type: 'section' as const,
    sourceFormat: 'latex' as const,
    source: '\\section{Hello}\\label{s1}\n\nbody',
  }

  it('reads the title and label off the header', () => {
    expect(extractLatexDivisionTitle(division.source)).toBe('Hello')
    expect(extractLatexSectionLabel(division.source)).toBe('s1')
  })

  it('reads a title out of the environment style', () => {
    expect(extractLatexDivisionTitle('\\begin{section}\n\\title{Env}\n\\end{section}')).toBe('Env')
  })

  it('returns null when there is no header to read', () => {
    expect(extractLatexDivisionTitle('% Introduction\n\nbody')).toBeNull()
  })

  it('rewrites the macro name, title and label together', () => {
    const updated = updateLatexDivisionMetadata(division, {
      title: 'Bye',
      type: 'worksheet',
      xmlId: 'w1',
    })
    expect(updated.source).toBe('\\worksheet{Bye}\\label{w1}\n\nbody')
    expect(updated.title).toBe('Bye')
    expect(updated.type).toBe('worksheet')
    expect(updated.xmlId).toBe('w1')
  })

  it('drops the label when the xml:id is cleared', () => {
    expect(updateLatexDivisionMetadata(division, { xmlId: null }).source).toBe(
      '\\section{Hello}\n\nbody',
    )
  })

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

// A division's type isn't a stored field — it's the wrapper element's tag
// name — so hosts hand the editor records without one. Recovering it on load
// is what lets the TOC label a row and restrict what its children may be.
describe('normalizeDivisionsOnLoad type backfill', () => {
  const root: Division = {
    id: '1',
    xmlId: 'bk',
    title: 'Book',
    type: 'book',
    sourceFormat: 'pretext',
    source: '<book xml:id="bk"><title>Book</title></book>',
  }

  /** A division as a host sends it: source and ids, no type. */
  const untyped = (
    xmlId: string,
    source: string,
    sourceFormat: Division['sourceFormat'] = 'pretext',
  ) =>
    ({ id: xmlId, xmlId, title: '', source, sourceFormat }) as Division

  it('reads a pretext division type from its wrapper element', () => {
    const [, chapter, sub] = normalizeDivisionsOnLoad(
      [
        root,
        untyped('ch', '<chapter xml:id="ch"><title>One</title></chapter>'),
        untyped(
          'sub',
          '<subsection xml:id="sub"><title>Deep</title></subsection>',
        ),
      ],
      'bk',
      'book',
    )

    expect(chapter.type).toBe('chapter')
    expect(chapter.title).toBe('One')
    expect(sub.type).toBe('subsection')
  })

  it('reads a markdown division type from its frontmatter', () => {
    const [, md] = normalizeDivisionsOnLoad(
      [
        root,
        untyped(
          'ws',
          '---\ndivision: worksheet\nxml:id: ws\n---\n\n# Practice\n',
          'markdown',
        ),
      ],
      'bk',
      'book',
    )

    expect(md.type).toBe('worksheet')
  })

  it('never overrides a type the host did supply', () => {
    const [, chapter] = normalizeDivisionsOnLoad(
      [
        root,
        {
          ...untyped('ch', '<section xml:id="ch"><title>One</title></section>'),
          type: 'chapter',
        },
      ],
      'bk',
      'book',
    )

    expect(chapter.type).toBe('chapter')
  })

  it('leaves a latex division typeless — its source carries no type', () => {
    const [, tex] = normalizeDivisionsOnLoad(
      [root, untyped('tex', '\\section{Hello}\n\nbody', 'latex')],
      'bk',
      'book',
    )

    expect(tex.type).toBeUndefined()
    expect(tex.title).toBe('Hello')
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

  /** The wrapper element's tag name — it also carries a root `@label`. */
  const wrapperTag = (xml: string) =>
    xml.match(/^<pretext[^>]*>\s*<([a-z-]+)/)?.[1]

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
  const div = (source: string, type: Division['type'] = 'article'): Division => ({
    id: '1',
    xmlId: 'a1',
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
    const xml = assembleFullProjectSource([div(ARTICLE)], 'a1', '')
    // Everything after the root's own `>` is byte-for-byte what went in, which
    // is what keeps preview line numbers aligned with the editor buffer.
    expect(xml).toContain(ARTICLE.slice(ARTICLE.indexOf('>') + 1))
    expectWellFormed(xml)
  })

  it('falls back to "main" when the root has no @xml:id, avoiding collisions', () => {
    const noId = ARTICLE.replace('<article xml:id="a1">', '<article>')
    expect(rootTagOf(assembleFullProjectSource([div(noId)], 'a1', ''))).toContain(
      'label="main"',
    )

    const taken = noId.replace('<section xml:id="s1">', '<section label="main">')
    expect(rootTagOf(assembleFullProjectSource([div(taken)], 'a1', ''))).toContain(
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

  it('leaves a bare division fragment untouched', () => {
    const section = '<section xml:id="s1"><title>First</title><p>Body</p></section>'
    expect(assembleProjectSource([div(section, 'section')], 'a1')).toBe(section)
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
      [latexDivision('\\section{A Section}\\label{sec-1}\n\nBefore the edit.')],
      'sec-1',
    )
    expect(first).toContain('Before the edit.')

    const second = assembleProjectSource(
      [latexDivision('\\section{A Section}\\label{sec-1}\n\nAfter the edit.')],
      'sec-1',
    )
    expect(second).toContain('After the edit.')
    expect(second).not.toContain('Before the edit.')
  })

  it('returns the same conversion for unchanged source', () => {
    const division = latexDivision('\\section{A Section}\\label{sec-1}\n\nStable.')
    expect(assembleProjectSource([division], 'sec-1')).toBe(
      assembleProjectSource([division], 'sec-1'),
    )
  })

  it('does not confuse two divisions that share an xml:id across projects', () => {
    const projectA = assembleProjectSource(
      [latexDivision('\\section{A Section}\\label{sec-1}\n\nProject A.')],
      'sec-1',
    )
    const projectB = assembleProjectSource(
      [latexDivision('\\section{A Section}\\label{sec-1}\n\nProject B.')],
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
