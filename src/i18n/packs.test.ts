import { describe, expect, it } from 'vitest'
import { parseLanguagePack, makeTemplate } from './packs'

describe('parseLanguagePack', () => {
  it('解析合法语言包（只保留字符串值）', () => {
    const pack = parseLanguagePack(
      JSON.stringify({ id: 'ja', name: '日本語', strings: { 'topbar.title': 'タイトル', bad: 123 } })
    )
    expect(pack.id).toBe('ja')
    expect(pack.name).toBe('日本語')
    expect(pack.strings['topbar.title']).toBe('タイトル')
    expect('bad' in pack.strings).toBe(false)
  })

  it('非 JSON / 缺字段 / 空 strings 抛错', () => {
    expect(() => parseLanguagePack('not json')).toThrow()
    expect(() => parseLanguagePack(JSON.stringify({ name: 'x', strings: { a: 'b' } }))).toThrow() // 缺 id
    expect(() => parseLanguagePack(JSON.stringify({ id: 'x', strings: { a: 'b' } }))).toThrow() // 缺 name
    expect(() => parseLanguagePack(JSON.stringify({ id: 'x', name: 'y' }))).toThrow() // 缺 strings
    expect(() => parseLanguagePack(JSON.stringify({ id: 'x', name: 'y', strings: {} }))).toThrow() // 空
  })
})

describe('makeTemplate', () => {
  it('生成含全部键的可解析模板（英文初值）', () => {
    const tpl = makeTemplate()
    const parsed = JSON.parse(tpl)
    expect(parsed).toHaveProperty('id')
    expect(parsed).toHaveProperty('name')
    expect(parsed.strings['topbar.exportVideo']).toBe('Export Video')
    expect(Object.keys(parsed.strings).length).toBeGreaterThan(100)
  })
})
