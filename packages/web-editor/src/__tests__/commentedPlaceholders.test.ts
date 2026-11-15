// A placeholder an author has commented out is not placed: assembly leaves it
// as written, and every ref scan agrees, so the Contents tree shows what the
// build will contain. The one exception is a division rename, which still
// rewrites it so that uncommenting it later resolves.
import { describe, it, expect } from 'vitest'
import {
  assembleFullProjectSource,
  buildDivisionTree,
  getOrphanRoots,
  parseDivisionRefEntries,
  findDivisionParent,
  insertDivisionRef,
  moveDivisionRef,
  parseAssetRefs,
  parseDivisionRefs,
  parseDivisionRefsWithTypes,
  parsePlacements,
  parseSnippetRefs,
  removeDivisionRef,
  renameDivisionRef,
} from '../sectionUtils'
import type { Division } from '../types/sections'
import type { SourceFormat } from '../types/editor'

const division = (
  xmlId: string,
  source: string,
  sourceFormat: SourceFormat = 'pretext',
  type: Division['type'] = 'section',
): Division => ({ xmlId, type, title: xmlId, source, sourceFormat })

describe('ref scans skip commented-out placeholders', () => {
  it('in each format', () => {
    expect(parseDivisionRefs('<!-- <plus:section ref="a"/> -->\n<plus:section ref="b"/>', 'pretext')).toEqual(['b'])
    expect(parseDivisionRefs('<!-- ::section{ref="a"} -->\n::section{ref="b"}', 'markdown')).toEqual(['b'])
    expect(parseDivisionRefs('% \\plus{section}{a}\n\\plus{section}{b}', 'latex')).toEqual(['b'])
  })

  it('across a multi-line comment', () => {
    expect(
      parseDivisionRefs('<!--\n<plus:section ref="a"/>\n<plus:section ref="b"/>\n-->\n<plus:section ref="c"/>', 'pretext'),
    ).toEqual(['c'])
  })

  it('but not after an escaped percent sign in LaTeX', () => {
    expect(parseDivisionRefs('50\\% \\plus{section}{a}', 'latex')).toEqual(['a'])
  })

  it('while a % inside \\verb stays code, not a comment', () => {
    expect(parseDivisionRefs('\\verb|%|\\plus{section}{a}', 'latex')).toEqual(['a'])
  })

  it("nor a % in a placeholder's optional argument, which is an attribute value", () => {
    expect(parseAssetRefs('\\plus[width=50%]{image}{i}', 'latex')).toEqual([{ ref: 'i' }])
    expect(parseAssetRefs('% \\plus[width=50%]{image}{i}', 'latex')).toEqual([])
  })

  it('for typed refs, assets, snippets and placements too', () => {
    expect(parseDivisionRefsWithTypes('<!-- <plus:chapter ref="a"/> -->', 'pretext')).toEqual([])
    expect(parseAssetRefs('<!-- <plus:image ref="img"/> -->', 'pretext')).toEqual([])
    expect(parseSnippetRefs('% \\plus{snippet}{s}', 'latex')).toEqual([])
    expect(parsePlacements('<!-- ::image{ref="img"} -->', 'markdown')).toEqual([])
  })

  it('so a division placed only in a comment has no parent', () => {
    const pool = [division('root', '<!-- <plus:section ref="s"/> -->', 'pretext', 'article'), division('s', '<p/>')]
    expect(findDivisionParent(pool, 's')).toBeNull()
  })
})

describe('structural edits act on the document as built', () => {
  it('removing a division leaves its commented-out placeholder alone', () => {
    const source = '<!-- <plus:section ref="x"/> -->\n<plus:section ref="x"/>\n'
    expect(removeDivisionRef(source, 'x', 'pretext')).toBe('<!-- <plus:section ref="x"/> -->\n')
  })

  it('an insert never anchors inside a comment', () => {
    const source = '<!-- <plus:section ref="a"/> -->\n<p/>'
    expect(insertDivisionRef(source, 'b', 'section', 'a', 'pretext')).toBe(
      '<!-- <plus:section ref="a"/> -->\n<p/>\n<plus:section ref="b"/>',
    )
  })

  it('a move takes the live placeholder, not the commented one', () => {
    const source = '<!-- <plus:section ref="a"/> -->\n<plus:section ref="a"/>\n<plus:section ref="b"/>\n'
    expect(moveDivisionRef(source, 'a', 'b', 'pretext')).toBe(
      '<!-- <plus:section ref="a"/> -->\n<plus:section ref="b"/>\n<plus:section ref="a"/>\n',
    )
  })
})

describe('renameDivisionRef reaches commented-out placeholders', () => {
  it('in each format', () => {
    expect(renameDivisionRef('<!-- <plus:section ref="a"/> -->', 'a', 'b', 'section', 'pretext')).toBe(
      '<!-- <plus:section ref="b"/> -->',
    )
    expect(renameDivisionRef('<!-- ::section{ref="a"} -->', 'a', 'b', 'worksheet', 'markdown')).toBe(
      '<!-- ::worksheet{ref="b"} -->',
    )
    expect(renameDivisionRef('% \\plus{section}{a}', 'a', 'b', 'section', 'latex')).toBe('% \\plus{section}{b}')
  })

  it('alongside a live one', () => {
    expect(
      renameDivisionRef('<!-- <plus:section ref="a"/> -->\n<plus:section ref="a"/>', 'a', 'b', 'section', 'pretext'),
    ).toBe('<!-- <plus:section ref="b"/> -->\n<plus:section ref="b"/>')
  })

  it('but still not inside a verbatim span', () => {
    const source = '<pre><plus:section ref="a"/></pre>'
    expect(renameDivisionRef(source, 'a', 'b', 'section', 'pretext')).toBe(source)
  })
})

describe('assembly leaves commented-out placeholders as written', () => {
  // The child's own comment is what used to break the document: expanded inside
  // the parent's comment, its `-->` closed that comment early.
  const child = division('child', '<!-- a note -- with dashes -->\n<p>Child text</p>')

  it.each<[SourceFormat, string]>([
    ['pretext', '<p>Intro</p>\n<!-- <plus:section ref="child"/> -->'],
    ['markdown', 'Intro\n\n<!-- ::section{ref="child"} -->\n'],
    ['latex', 'Intro\n\n% \\plus{section}{child}\n'],
  ])('in a %s parent', (format, source) => {
    const doc = assembleFullProjectSource(
      [division('root', source, format, 'article'), child],
      'root',
      '',
    )
    expect(doc).toContain('Intro')
    expect(doc).not.toContain('Child text')
    expect(doc).not.toContain('a note')
  })

  it('keeps the comment verbatim and still expands a live placeholder after it', () => {
    const doc = assembleFullProjectSource(
      [
        division('root', '<!-- <plus:section ref="child"/> -->\n<plus:section ref="other"/>', 'pretext', 'article'),
        child,
        division('other', '<p>Other text</p>'),
      ],
      'root',
      '',
    )
    expect(doc).toContain('<!-- <plus:section ref="child"/> -->')
    expect(doc).toContain('Other text')
    expect(doc).not.toContain('Child text')
  })

  it('still expands a placeholder in a division whose own comments sit beside it', () => {
    const doc = assembleFullProjectSource(
      [division('root', '<!-- intro -->\n<plus:section ref="child"/>\n<!-- outro -->', 'pretext', 'article'), child],
      'root',
      '',
    )
    expect(doc).toContain('Child text')
    expect(doc).toContain('<!-- a note -- with dashes -->')
  })
})

describe('the Contents tree shows commented-out divisions in place', () => {
  const pool = [
    division('root', '<!-- <plus:section ref="a"/> -->\n<plus:section ref="b"/>', 'pretext', 'article'),
    division('a', '<plus:subsection ref="a1"/>'),
    division('a1', '<p/>', 'pretext', 'subsection'),
    division('b', '<p/>'),
  ]

  it('parseDivisionRefEntries flags them, in document order with the live ones', () => {
    expect(parseDivisionRefEntries(pool[0].source, 'pretext')).toEqual([
      { xmlId: 'a', commented: true },
      { xmlId: 'b', commented: false },
    ])
    expect(parseDivisionRefEntries('% \\plus{section}{a}\n\\plus{section}{b}', 'latex')).toEqual([
      { xmlId: 'a', commented: true },
      { xmlId: 'b', commented: false },
    ])
    expect(parseDivisionRefEntries('<pre><plus:section ref="a"/></pre>', 'pretext')).toEqual([])
  })

  it('buildDivisionTree leaves them out by default, as the document does', () => {
    expect(buildDivisionTree(pool, 'root').map((n) => n.division.xmlId)).toEqual(['b'])
    expect(getOrphanRoots(pool, 'root').map((d) => d.xmlId)).toEqual(['a'])
  })

  it('and with includeCommented follows them, flagging the whole subtree', () => {
    const tree = buildDivisionTree(pool, 'root', { includeCommented: true })
    expect(tree.map((n) => [n.division.xmlId, n.depth, n.commented])).toEqual([
      ['a', 0, true],
      ['a1', 1, true],
      ['b', 0, false],
    ])
    expect(getOrphanRoots(pool, 'root', { includeCommented: true })).toEqual([])
  })

  it('shows a division placed for real at its real spot, never its commented one', () => {
    const both = [
      division('root', '<!-- <plus:section ref="b"/> -->\n<plus:section ref="b"/>', 'pretext', 'article'),
      division('b', '<p/>'),
    ]
    expect(
      buildDivisionTree(both, 'root', { includeCommented: true }).map((n) => [n.division.xmlId, n.commented]),
    ).toEqual([['b', false]])
  })
})
