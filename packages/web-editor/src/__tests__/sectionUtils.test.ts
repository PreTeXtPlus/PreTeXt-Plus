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
} from '../sectionUtils'
import type { DocumentSection } from '../types/sections'

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
  const section: DocumentSection = {
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
  const root: DocumentSection = {
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
    sourceFormat: DocumentSection['sourceFormat'] = 'pretext',
  ) =>
    ({ id: xmlId, xmlId, title: '', source, sourceFormat }) as DocumentSection

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
