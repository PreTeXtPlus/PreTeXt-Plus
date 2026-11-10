import { describe, it, expect } from 'vitest'
import {
  assembleExercisePreviewSource,
  assembleFullProjectSource,
  EXERCISE_REF_TAGS,
  exerciseEmbedCode,
  isInsideTaskHolder,
  parseExerciseRefs,
  parsePlacements,
  placedExerciseElement,
  removeExerciseRef,
  renameExerciseRef,
  wrapExerciseSource,
} from '../sectionUtils'
import { derivePretextContent } from '../contentConversion'
import type { Exercise, Snippet } from '../types/editor'
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

describe('the element an exercise is placed as', () => {
  const assemble = (source: string, more: Partial<{ exercises: Exercise[]; snippets: Snippet[] }> = {}) =>
    assembleFullProjectSource(
      [root(source)],
      'root',
      '',
      [],
      undefined,
      more.snippets ?? [],
      more.exercises ?? [exercise],
    )
  const opening = (xml: string) => /<(exercise|task|project) xml:id="ex-stop"/.exec(xml)?.[1]

  it.each([
    ['exercise', 'exercise'],
    ['project', 'project'],
    ['task', 'exercise'],
  ])('outside a holder, plus:%s is an <%s>', (tag, element) => {
    expect(opening(assemble(`<plus:${tag} ref="ex-stop"/>`))).toBe(element)
  })

  it.each(['exercise', 'project', 'activity', 'exploration', 'investigation', 'task'])(
    'inside <%s>, every tag is a <task>',
    (holder) => {
      for (const tag of EXERCISE_REF_TAGS) {
        expect(opening(assemble(`<${holder}><plus:${tag} ref="ex-stop"/></${holder}>`)), tag).toBe('task')
      }
    },
  )

  it('closes the element it opened, keeping attributes and the instance name', () => {
    const xml = assemble('<plus:project ref="ex-stop" instance="a" component="b"/>')
    expect(xml).toContain('<project xml:id="ex-stop-a" label="ex-stop-a"')
    expect(xml).toContain('component="b"')
    expect(xml).toContain('</project>')
  })

  it('an exercise placed in another exercise record is a task of it', () => {
    const outer: Exercise = { ref: 'outer', source: '<plus:exercise ref="ex-stop"/>' }
    const xml = assemble('<plus:project ref="outer"/>', { exercises: [outer, exercise] })
    expect(xml).toContain('<project xml:id="outer"')
    expect(opening(xml)).toBe('task')
  })

  it('a snippet carries the place it was put into its own placeholders', () => {
    const snippets: Snippet[] = [{ ref: 'bit', source: '<plus:exercise ref="ex-stop"/>', sourceFormat: 'pretext' }]
    expect(opening(assemble('<project><plus:snippet ref="bit"/></project>', { snippets }))).toBe('task')
    expect(opening(assemble('<plus:snippet ref="bit"/>', { snippets }))).toBe('exercise')
  })

  it('a holder named in a comment, a verbatim span or already closed does not count', () => {
    for (const before of ['<!-- <project> -->', '<pre><project></pre>', '<project/>', '<project></project>']) {
      expect(opening(assemble(`${before}<plus:task ref="ex-stop"/>`)), before).toBe('exercise')
    }
  })

  it('the embed code names the chosen tag in each format', () => {
    expect(exerciseEmbedCode('a', 'pretext', 'task')).toBe('<plus:task ref="a"/>')
    expect(exerciseEmbedCode('a', 'markdown', 'project')).toBe('::project{ref="a"}')
    expect(exerciseEmbedCode('a', 'latex', 'task')).toBe('\\plus{task}{a}')
  })

  it('finds, renames and removes the placeholders of every tag, keeping each tag', () => {
    const source = '<plus:exercise ref="a"/><plus:task ref="a"/><plus:project ref="a"/>'
    expect(parseExerciseRefs(source, 'pretext')).toEqual([{ ref: 'a' }, { ref: 'a' }, { ref: 'a' }])
    expect(renameExerciseRef(source, 'a', 'b')).toBe('<plus:exercise ref="b"/><plus:task ref="b"/><plus:project ref="b"/>')
    expect(removeExerciseRef(source, 'a')).toBe('')
    expect(parsePlacements(source, 'pretext').map((p) => p.tag)).toEqual(['exercise', 'task', 'project'])
  })

  // The lint reads a holder in the buffer's own syntax and assembly reads it in
  // the converted XML, so the two have to agree on what a source means.
  describe.each([
    ['pretext', (h: string, p: string) => `<${h}>${p}</${h}>`, (t: string) => `<plus:${t} ref="ex-stop"/>`],
    ['latex', (h: string, p: string) => `\\begin{${h}}\n${p}\n\\end{${h}}`, (t: string) => `\\plus{${t}}{ex-stop}`],
    ['markdown', (h: string, p: string) => `:::${h}\n${p}\n:::`, (t: string) => `::${t}{ref="ex-stop"}`],
  ] as const)('in %s', (format, hold, place) => {
    const verdict = (source: string, tag: 'exercise' | 'task' | 'project') => {
      const inside = isInsideTaskHolder(source, format, source.indexOf(place(tag)))
      const division: Division = { ...root(source), sourceFormat: format }
      const assembled = opening(assembleFullProjectSource([division], 'root', '', [], undefined, [], [exercise]))
      return { lint: placedExerciseElement(tag, inside), assembled }
    }
    it.each(EXERCISE_REF_TAGS)('lint and assembly agree on plus:%s', (tag) => {
      for (const source of [place(tag), hold('exercise', place(tag)), hold('project', place(tag))]) {
        const { lint, assembled } = verdict(source, tag)
        expect(assembled, source).toBe(lint)
      }
    })
  })
})
