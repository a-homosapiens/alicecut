import { describe, expect, it } from 'vitest'
import { mergeStoredSettings, parseStoredSettings } from './settingsCore'

describe('stored settings', () => {
  it('falls back safely for missing or malformed data', () => {
    expect(parseStoredSettings('')).toEqual({})
    expect(parseStoredSettings('[]')).toEqual({})
  })

  it('preserves the recent project directory when locale changes', () => {
    const current = parseStoredSettings('{"locale":"zh","lastProjectDirectory":"D:/projects"}')
    expect(mergeStoredSettings(current, { locale: 'en' })).toEqual({
      locale: 'en',
      lastProjectDirectory: 'D:/projects'
    })
  })
})
