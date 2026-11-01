import { describe, it, expect } from 'vitest'
import {
  assembleExercisePreviewSource,
  assembleFullProjectSource,
  exerciseEmbedCode,
  parseExerciseRefs,
  parsePlacements,
  removeExerciseRef,
  renameExerciseRef,
  wrapExerciseSource,
} from '../sectionUtils'
import { derivePretextContent } from '../contentConversion'
import type { Exercise } from '../types/editor'
import type { Division } from '../types/sections'

const exercise: Exercise = {
  ref: 'ex-stop',
  title: 'Stop <m>x</m>',
  source: '<statement><p>What color?</p></statement>\n<choices><choice correct="yes"><statement><p>Red</p></statement></choice></choices>',
  attrs: {},
}

const root = (source: string): Division => ({
  xmlId: 'root',
  type: 'article',
  title: 'Doc',
  source,
  sourceFormat: 'pretext',
})

describe('wrapExerciseSource', () => {
  it('builds the <exercise> element from the record around its body', () => {
    expect(wrapExerciseSource(exercise)).toBe(
      '<exercise xml:id="ex-stop" label="ex-stop">\n<title>Stop <m>x</m></title>\n' +
        exercise.source +
        '\n</exercise>',
    )
  })

  it('writes attrs onto the element, never letting them override the ref', () => {
    const xml = wrapExerciseSource({
      ...exercise,
      title: '',
      attrs: { language: 'python', label: 'other', adaptive: 'yes' },
    })
    expect(xml).toMatch(/^<exercise xml:id="ex-stop" label="ex-stop" language="python" adaptive="yes">\n<statement>/)
    expect(xml).not.toContain('<title>')
  })
})

describe('exercise placeholders', () => {
  it('resolves <plus:exercise ref/> during assembly', () => {
    const doc = assembleFullProjectSource(
      [root('<p>Try this:</p>\n<plus:exercise ref="ex-stop"/>')],
      'root',
      '',
      [],
      undefined,
      [],
      [exercise],
    )
    expect(doc).toContain('<exercise xml:id="ex-stop" label="ex-stop">')
    expect(doc).not.toContain('plus:exercise')
  })

  it('qualifies a second placement by its instance name', () => {
    const doc = assembleFullProjectSource(
      [root('<plus:exercise ref="ex-stop"/>\n<plus:exercise ref="ex-stop" instance="again"/>')],
      'root',
      '',
      [],
      undefined,
      [],
      [exercise],
    )
    expect(doc).toContain('label="ex-stop"')
    expect(doc).toContain('label="ex-stop-again"')
  })

  it('leaves a comment for a missing exercise', () => {
    const doc = assembleFullProjectSource([root('<plus:exercise ref="nope"/>')], 'root', '')
    expect(doc).toContain('<!-- missing exercise: nope -->')
  })

  it('parses, renames and removes all three syntaxes', () => {
    expect(parseExerciseRefs('<plus:exercise ref="a"/><plus:snippet ref="b"/>', 'pretext')).toEqual([{ ref: 'a' }])
    expect(parseExerciseRefs('::exercise{ref="a"}', 'markdown')).toEqual([{ ref: 'a' }])
    expect(parseExerciseRefs('\\plus{exercise}{a}', 'latex')).toEqual([{ ref: 'a' }])
    expect(renameExerciseRef('<plus:exercise ref="a" instance="x"/>', 'a', 'b')).toBe(
      '<plus:exercise ref="b" instance="x"/>',
    )
    expect(removeExerciseRef('x<plus:exercise ref="a"/>y\\plus{exercise}{a}', 'a')).toBe('xy')
    expect(exerciseEmbedCode('a', 'latex')).toBe('\\plus{exercise}{a}')
    expect(parsePlacements('<plus:exercise ref="a"/>', 'pretext')[0]).toMatchObject({ tag: 'exercise', ref: 'a' })
  })

  it.each([
    ['latex', '\\plus{exercise}{ex-stop}'],
    ['markdown', '::exercise{ref="ex-stop"}'],
  ] as const)('the %s converter emits the placeholder assembly resolves', (format, source) => {
    expect(derivePretextContent(source, format).pretextSource).toMatch(/<plus:exercise\s+ref="ex-stop"\s*\/>/)
  })
})

describe('assembleExercisePreviewSource', () => {
  it('places the exercise alone in a plain article', () => {
    const doc = assembleExercisePreviewSource(
      'ex-stop',
      { divisions: [], snippets: [], assets: [], exercises: [exercise] },
      '',
    )
    expect(doc).toMatch(/^<pretext[^>]*>/)
    expect(doc).toContain('<title>exercise preview</title>\n<exercise xml:id="ex-stop"')
  })
})
