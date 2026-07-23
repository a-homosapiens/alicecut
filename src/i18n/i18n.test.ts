import { describe, expect, it } from 'vitest'
import { translate, detectLocale, hasMsg, registerLanguage, availableLanguages, allKeys } from './index'
import { zh } from './zh'
import { en } from './en'

describe('translate', () => {
  it('返回对应语言译文', () => {
    expect(translate('zh', 'topbar.exportVideo')).toBe('导出视频')
    expect(translate('en', 'topbar.exportVideo')).toBe('Export Video')
  })

  it('插值 {n}', () => {
    expect(translate('zh', 'tl.layerN', { n: 3 })).toBe('第 3 层')
    expect(translate('en', 'tracks.lineCount', { n: 2 })).toBe('2 lines')
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

describe('hasMsg（区分内置/插件名）', () => {
  it('内置特效/转场键存在，未知键不存在', () => {
    expect(hasMsg('effect.karaoke')).toBe(true)
    expect(hasMsg('effect.flip-bottom')).toBe(true)
    expect(hasMsg('vtrans.fade')).toBe(true)
    expect(hasMsg('effect.someThirdPartyPlugin')).toBe(false)
  })

  it('内置特效/转场名按语言翻译', () => {
    expect(translate('en', 'effect.karaoke')).toBe('Karaoke')
    expect(translate('zh', 'vtrans.wipeL')).toBe('左擦')
  })
})

describe('语言注册表（可安装语言包）', () => {
  it('内置 zh/en 可用', () => {
    const ids = availableLanguages().map((l) => l.id)
    expect(ids).toContain('zh')
    expect(ids).toContain('en')
  })

  it('注册语言包后可翻译；缺键回退中文', () => {
    registerLanguage('ja', '日本語', { 'topbar.exportVideo': '動画を書き出す' })
    expect(translate('ja', 'topbar.exportVideo')).toBe('動画を書き出す')
    // 未提供的键回退到中文（source of truth）
    expect(translate('ja', 'topbar.importLyrics')).toBe('导入歌词')
    expect(availableLanguages().some((l) => l.id === 'ja' && l.name === '日本語')).toBe(true)
  })

  it('未知语言回退中文', () => {
    expect(translate('xx', 'topbar.exportVideo')).toBe('导出视频')
  })

  it('allKeys 返回全部界面键（供导出模板）', () => {
    const keys = allKeys()
    expect(keys).toContain('topbar.title')
    expect(keys.length).toBeGreaterThan(100)
  })
})

describe('字典完整性', () => {
  it('en 含 zh 的全部键（无缺漏）', () => {
    for (const k of Object.keys(zh)) {
      expect(en[k as keyof typeof zh], `缺少 en 译文: ${k}`).toBeTruthy()
    }
  })
})
