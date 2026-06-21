import { describe, expect, it } from 'vitest'
import { translate, detectLocale } from './index'
import { zh } from './zh'
import { en } from './en'

describe('translate', () => {
  it('返回对应语言译文', () => {
    expect(translate('zh', 'topbar.exportVideo')).toBe('导出视频')
    expect(translate('en', 'topbar.exportVideo')).toBe('Export Video')
  })

  it('插值 {n}', () => {
    expect(translate('zh', 'topbar.videoSuffix', { n: 3 })).toBe('· 3 段')
    expect(translate('en', 'topbar.audioSuffix', { n: 2 })).toBe('· 2 tracks')
  })
})

describe('detectLocale', () => {
  it('zh* → zh，其余 → en', () => {
    expect(detectLocale('zh-CN')).toBe('zh')
    expect(detectLocale('zh')).toBe('zh')
    expect(detectLocale('en-US')).toBe('en')
    expect(detectLocale(undefined)).toBe('en')
    expect(detectLocale('fr')).toBe('en')
  })
})

describe('字典完整性', () => {
  it('en 含 zh 的全部键（无缺漏）', () => {
    for (const k of Object.keys(zh)) {
      expect(en[k as keyof typeof zh], `缺少 en 译文: ${k}`).toBeTruthy()
    }
  })
})
