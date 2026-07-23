import { describe, expect, it } from 'vitest'
import { BUILTIN_FONT_OPTIONS } from './fonts'

describe('built-in font catalog', () => {
  it('exposes a unique lightweight preview for every lazy-install font', () => {
    expect(BUILTIN_FONT_OPTIONS).toHaveLength(34)
    expect(new Set(BUILTIN_FONT_OPTIONS.map((font) => font.family)).size).toBe(BUILTIN_FONT_OPTIONS.length)
    expect(new Set(BUILTIN_FONT_OPTIONS.map((font) => font.previewUrl)).size).toBe(BUILTIN_FONT_OPTIONS.length)
    expect(BUILTIN_FONT_OPTIONS.every((font) => font.builtin && font.previewUrl?.endsWith('.png'))).toBe(true)
  })

  it('keeps only the compact starter set in the first installation', () => {
    expect(BUILTIN_FONT_OPTIONS.filter((font) => font.bundled).map((font) => font.family)).toEqual([
      'Smiley Sans',
      'Noto Sans SC',
      'Inter'
    ])
  })
})
