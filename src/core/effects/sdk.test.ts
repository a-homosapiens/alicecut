import { describe, expect, it } from 'vitest'
import { sanitizeCharFx, textEffectToPreset, validateManifest, type TextEffectDef } from './sdk'
import { registerTextEffect, getEffect } from './index'

const baseArgs = {
  unitIndex: 0,
  unitCount: 1,
  charIndexInUnit: 0,
  enterT: 1,
  timeInLine: 0,
  lineDuration: 1000,
  unitStart: 0,
  unitEnd: 500,
  intensity: 1,
  rand: () => 0.5
}

describe('sanitizeCharFx', () => {
  it('缺省补恒等值', () => {
    expect(sanitizeCharFx({})).toEqual({
      dx: 0,
      dy: 0,
      scale: 1,
      rotate: 0,
      alpha: 1,
      blur: 0,
      glow: 0,
      highlight: 0,
      skewX: 0,
      skewY: 0
    })
  })

  it('钳制越界与非有限值', () => {
    const fx = sanitizeCharFx({ alpha: 5, highlight: -2, scale: -1, blur: -3, dx: NaN, dy: Infinity })
    expect(fx.alpha).toBe(1)
    expect(fx.highlight).toBe(0)
    expect(fx.scale).toBe(0)
    expect(fx.blur).toBe(0)
    expect(fx.dx).toBe(0)
    expect(fx.dy).toBe(0)
  })

  it('null/非对象 → 恒等', () => {
    expect(sanitizeCharFx(null).alpha).toBe(1)
  })
})

describe('textEffectToPreset', () => {
  const def: TextEffectDef = {
    id: 'p.test',
    name: '测试',
    unit: 'word',
    enterDurationMs: 200,
    apply: ({ enterT }, m) => ({ alpha: m.clamp01(enterT), dy: 7 })
  }

  it('映射基本字段', () => {
    const preset = textEffectToPreset(def)
    expect(preset.id).toBe('p.test')
    expect(preset.unit).toBe('word')
    expect(preset.enterDuration).toBe(200)
  })

  it('apply 输出经过校验', () => {
    const preset = textEffectToPreset(def)
    const fx = preset.apply(baseArgs)
    expect(fx.dy).toBe(7)
    expect(fx.alpha).toBe(1)
  })

  it('apply 抛错时回退恒等（不崩渲染）', () => {
    const bad = textEffectToPreset({
      ...def,
      id: 'p.bad',
      apply: () => {
        throw new Error('boom')
      }
    })
    expect(bad.apply(baseArgs).alpha).toBe(1)
  })
})

describe('validateManifest', () => {
  it('接受合法清单', () => {
    const m = validateManifest({
      api: 1,
      name: 'X',
      textEffects: [{ id: 'a.b', name: 'n', unit: 'char', apply: () => ({}) }]
    })
    expect(m.name).toBe('X')
    expect(m.textEffects).toHaveLength(1)
  })

  it('拒绝错误 api 版本', () => {
    expect(() => validateManifest({ api: 2, name: 'X' })).toThrow()
  })

  it('拒绝缺 name', () => {
    expect(() => validateManifest({ api: 1 })).toThrow()
  })

  it('拒绝结构不全的特效条目', () => {
    expect(() => validateManifest({ api: 1, name: 'X', textEffects: [{ id: 'a' }] })).toThrow()
  })
})

describe('注册表', () => {
  it('注册后可由 getEffect 取回', () => {
    registerTextEffect(textEffectToPreset({ id: 'p.reg', name: '注册', unit: 'char', enterDurationMs: 100, apply: () => ({}) }))
    expect(getEffect('p.reg').name).toBe('注册')
  })

  it('未知 id 回退内置 pop', () => {
    expect(getEffect('does-not-exist').id).toBe('pop')
  })
})
