import { describe, it, expect } from 'vitest'
import { escapeAttribute } from '../xmlUtils'

describe('escapeAttribute', () => {
  it('escapes the characters that would break a double-quoted attribute', () => {
    expect(escapeAttribute('A & B')).toBe('A &amp; B')
    expect(escapeAttribute('A < B')).toBe('A &lt; B')
    expect(escapeAttribute('say "hi"')).toBe('say &quot;hi&quot;')
  })

  it('escapes ampersands first so entities are not double-escaped', () => {
    expect(escapeAttribute('&amp;')).toBe('&amp;amp;')
    expect(escapeAttribute('&<"')).toBe('&amp;&lt;&quot;')
  })

  it('leaves ordinary text untouched', () => {
    expect(escapeAttribute('')).toBe('')
    expect(escapeAttribute('hello-world_123')).toBe('hello-world_123')
  })

  it('produces a value that survives being embedded in an attribute', () => {
    const raw = 'a & b < c "d"'
    expect(`<x v="${escapeAttribute(raw)}"/>`).toBe('<x v="a &amp; b &lt; c &quot;d&quot;"/>')
  })
})
