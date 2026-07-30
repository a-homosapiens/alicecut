import { describe, expect, it } from 'vitest'
import { isSupportedFontData } from './fontData'

const data = (...bytes: number[]): ArrayBuffer => new Uint8Array(bytes).buffer
const tagged = (tag: string): ArrayBuffer => data(...[...tag].map((character) => character.charCodeAt(0)))

describe('font data validation', () => {
  it('accepts supported sfnt and web-font signatures', () => {
    expect(isSupportedFontData(data(0x00, 0x01, 0x00, 0x00))).toBe(true)
    for (const tag of ['OTTO', 'true', 'typ1', 'ttcf', 'wOFF', 'wOF2']) {
      expect(isSupportedFontData(tagged(tag))).toBe(true)
    }
  })

  it('rejects an HTML fallback returned with HTTP 200', () => {
    expect(isSupportedFontData(tagged('<!DO'))).toBe(false)
  })

  it('rejects truncated and Git LFS pointer content', () => {
    expect(isSupportedFontData(data(0x00, 0x01, 0x00))).toBe(false)
    expect(isSupportedFontData(tagged('vers'))).toBe(false)
  })
})
