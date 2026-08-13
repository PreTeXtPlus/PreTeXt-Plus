import { describe, it, expect } from 'vitest'
import { resolveAssetRef, ASSET_KINDS } from '../assetTransforms'
import type { Asset } from '../types/editor'

const baseAsset: Asset = {
  id: '1',
  ref: 'euler-painting',
  kind: 'image',
  title: 'Euler',
}

describe('resolveAssetRef', () => {
  it('uses the server-computed fileRef verbatim as the source attribute', () => {
    const asset: Asset = { ...baseAsset, isFile: true, fileRef: 'euler-painting.png' }
    expect(resolveAssetRef('image', 'euler-painting', [asset])).toBe(
      '<image source="euler-painting.png"/>',
    )
  })

  // A pasted image's content type may be unrecognized (see Asset#file_extension
  // server-side), in which case the server reports no extension and fileRef is
  // just the bare ref -- this is no longer guessed at client-side.
  it('falls back to the bare ref when isFile but fileRef has no extension', () => {
    const asset: Asset = { ...baseAsset, isFile: true, fileRef: 'euler-painting' }
    expect(resolveAssetRef('image', 'euler-painting', [asset])).toBe(
      '<image source="euler-painting"/>',
    )
  })

  it('falls back to the placeholder ref when isFile but fileRef is entirely missing', () => {
    const asset: Asset = { ...baseAsset, isFile: true, url: 'https://example.com/x' }
    expect(resolveAssetRef('image', 'euler-painting', [asset])).toBe(
      '<image source="euler-painting"/>',
    )
  })

  it('emits an XML comment when isFile but neither fileRef nor url is present', () => {
    const asset: Asset = { ...baseAsset, isFile: true }
    expect(resolveAssetRef('image', 'euler-painting', [asset])).toBe(
      '<!-- image asset "euler-painting" is marked as file-based but has no fileRef or url -->',
    )
  })

  it('omits the source attribute entirely for a non-file (authored-source) asset', () => {
    const asset: Asset = { ...baseAsset, source: '<description>x</description>' }
    expect(resolveAssetRef('image', 'euler-painting', [asset])).toBe(
      '<image>\n<description>x</description>\n</image>',
    )
  })

  it('emits a self-closing tag when a non-file asset has no source content', () => {
    const asset: Asset = { ...baseAsset }
    expect(resolveAssetRef('image', 'euler-painting', [asset])).toBe('<image/>')
  })

  it('renders shortDescription as a leading <shortdescription> element', () => {
    const asset: Asset = { ...baseAsset, shortDescription: 'A portrait of Euler' }
    expect(resolveAssetRef('image', 'euler-painting', [asset])).toBe(
      '<image>\n<shortdescription>A portrait of Euler</shortdescription>\n</image>',
    )
  })

  it('places shortdescription before authored source content', () => {
    const asset: Asset = {
      ...baseAsset,
      shortDescription: 'A portrait of Euler',
      source: '<description>x</description>',
    }
    expect(resolveAssetRef('image', 'euler-painting', [asset])).toBe(
      '<image>\n<shortdescription>A portrait of Euler</shortdescription>\n<description>x</description>\n</image>',
    )
  })

  it('XML-escapes shortDescription text content', () => {
    const asset: Asset = { ...baseAsset, shortDescription: 'A & B < C > D' }
    expect(resolveAssetRef('image', 'euler-painting', [asset])).toBe(
      '<image>\n<shortdescription>A &amp; B &lt; C &gt; D</shortdescription>\n</image>',
    )
  })

  it('ignores a blank/whitespace-only shortDescription', () => {
    const asset: Asset = { ...baseAsset, shortDescription: '   ' }
    expect(resolveAssetRef('image', 'euler-painting', [asset])).toBe('<image/>')
  })

  it('falls back to an XML comment when no matching asset is found', () => {
    expect(resolveAssetRef('image', 'missing-ref', [])).toBe(
      '<!-- missing asset: image missing-ref -->',
    )
  })

  it('lists image and doenet as the recognized asset kinds', () => {
    expect(ASSET_KINDS.has('image')).toBe(true)
    expect(ASSET_KINDS.has('doenet')).toBe(true)
  })
})
