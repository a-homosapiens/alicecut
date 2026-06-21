import { describe, expect, it } from 'vitest'
import {
  sanitizeCharFx,
  sanitizeLineFx,
  textEffectToPreset,
  lineEffectToPreset,
  videoTransitionToImpl,
  validateManifest,
  normReveal,
  normTrail,
  type TextEffectDef,
  type LineEffectDef,
  type VideoTransitionDef
} from './sdk'
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

describe('声明式能力：reveal / trail / wordBox', () => {
  it('normReveal 仅接受已知枚举', () => {
    expect(normReveal('iris')).toBe('iris')
    expect(normReveal('wipe')).toBe('wipe')
    expect(normReveal('bogus')).toBeUndefined()
    expect(normReveal(123)).toBeUndefined()
  })

  it('normTrail 钳制并拒绝非法', () => {
    expect(normTrail({ count: 99, stepMs: 9999, decay: 5 })).toEqual({ count: 12, stepMs: 200, decay: 1 })
    expect(normTrail({ count: 0 })).toBeUndefined()
    expect(normTrail(null)).toBeUndefined()
    expect(normTrail({ count: 3, stepMs: 20 })).toEqual({ count: 3, stepMs: 20 })
  })

  it('textEffectToPreset 透传规范化后的声明式字段', () => {
    const preset = textEffectToPreset({
      id: 'p.mask',
      name: 'M',
      unit: 'char',
      enterDurationMs: 500,
      reveal: 'iris',
      trail: { count: 4, stepMs: 20 },
      wordBox: true,
      apply: () => ({})
    } as TextEffectDef)
    expect(preset.reveal).toBe('iris')
    expect(preset.trail).toEqual({ count: 4, stepMs: 20 })
    expect(preset.wordBox).toBe(true)
  })

  it('未声明时不带这些字段', () => {
    const preset = textEffectToPreset({ id: 'p.plain', name: 'P', unit: 'char', enterDurationMs: 300, apply: () => ({}) })
    expect(preset.reveal).toBeUndefined()
    expect(preset.trail).toBeUndefined()
    expect(preset.wordBox).toBeUndefined()
  })

  it('validateManifest 丢弃非法 reveal、保留合法声明式字段', () => {
    const m = validateManifest({
      api: 1,
      name: 'X',
      textEffects: [
        { id: 'a.good', name: 'g', unit: 'char', reveal: 'clockWipe', wordBox: true, apply: () => ({}) },
        { id: 'a.bad', name: 'b', unit: 'char', reveal: 'nope', apply: () => ({}) }
      ]
    })
    expect(m.textEffects?.[0].reveal).toBe('clockWipe')
    expect(m.textEffects?.[0].wordBox).toBe(true)
    expect(m.textEffects?.[1].reveal).toBeUndefined()
  })
})

describe('整行停靠式转场 lineTransitions', () => {
  const def: LineEffectDef = {
    id: 'l.tilt',
    name: '上叠',
    enterDurationMs: 460,
    maxDepth: 3,
    enterFrom: ({ height }) => ({ dy: height * 0.2, scale: 0.6, alpha: 0 }),
    pose: (depth) => (depth === 0 ? {} : { dy: -100 * depth, scale: 0.5, alpha: 1 - depth * 0.3 })
  }

  it('sanitizeLineFx 合并恒等并钳制', () => {
    expect(sanitizeLineFx({})).toEqual({ dx: 0, dy: 0, scale: 1, rotate: 0, alpha: 1, blur: 0 })
    expect(sanitizeLineFx({ alpha: 9, scale: -2, blur: -1 })).toMatchObject({ alpha: 1, scale: 0, blur: 0 })
  })

  it('lineEffectToPreset 建出 unit=line + lineTransition', () => {
    const preset = lineEffectToPreset(def)
    expect(preset.unit).toBe('line')
    expect(preset.enterDuration).toBe(460)
    expect(preset.lineTransition).toBeDefined()
    expect(preset.lineTransition!.maxDepth).toBe(3)
    const center = preset.lineTransition!.pose(0, { lineId: 0, width: 1080, height: 1920, fontSize: 88, intensity: 1, blocks: [{ w: 1, h: 1 }] })
    expect(center).toEqual({ dx: 0, dy: 0, scale: 1, rotate: 0, alpha: 1, blur: 0 })
  })

  it('maxDepth 钳到 0..6', () => {
    expect(lineEffectToPreset({ ...def, maxDepth: 99 }).lineTransition!.maxDepth).toBe(6)
    expect(lineEffectToPreset({ ...def, maxDepth: -5 }).lineTransition!.maxDepth).toBe(0)
  })

  it('enterFrom/pose 抛错回退恒等（不崩渲染）', () => {
    const bad = lineEffectToPreset({
      ...def,
      pose: () => {
        throw new Error('boom')
      }
    })
    const args = { lineId: 0, width: 1080, height: 1920, fontSize: 88, intensity: 1, blocks: [{ w: 1, h: 1 }] }
    expect(bad.lineTransition!.pose(1, args)).toEqual({ dx: 0, dy: 0, scale: 1, rotate: 0, alpha: 1, blur: 0 })
  })

  it('validateManifest 携带 lineTransitions，拒绝缺 enterFrom/pose', () => {
    const m = validateManifest({ api: 1, name: 'X', lineTransitions: [def] })
    expect(m.lineTransitions).toHaveLength(1)
    expect(() => validateManifest({ api: 1, name: 'X', lineTransitions: [{ id: 'x', name: 'y' }] })).toThrow()
  })
})

describe('视频转场 videoTransitions', () => {
  const def: VideoTransitionDef = {
    id: 'v.spin',
    name: '旋入',
    in: (p, m) => ({ alpha: m.clamp01(p), scale: 1.2 - 0.2 * p }),
    out: (p) => ({ alpha: p })
  }

  it('videoTransitionToImpl 建出 in/out 并钳制输出', () => {
    const impl = videoTransitionToImpl(def)
    expect(impl.id).toBe('v.spin')
    const fx = impl.in(1)
    expect(fx).toEqual({ alpha: 1, dxFrac: 0, dyFrac: 0, scale: 1, wipe: null })
  })

  it('越界/wipe 经 sanitize', () => {
    const impl = videoTransitionToImpl({
      id: 'v.wipe',
      name: 'W',
      in: () => ({ alpha: 9, wipe: { dir: 'L', reveal: 5 } }),
      out: () => ({})
    })
    const fx = impl.in(0.5)
    expect(fx.alpha).toBe(1)
    expect(fx.wipe).toEqual({ dir: 'L', reveal: 1 })
  })

  it('in 抛错回退恒等', () => {
    const impl = videoTransitionToImpl({ id: 'v.bad', name: 'B', in: () => { throw new Error('x') }, out: () => ({}) })
    expect(impl.in(0.5)).toEqual({ alpha: 1, dxFrac: 0, dyFrac: 0, scale: 1, wipe: null })
  })

  it('validateManifest 携带 videoTransitions，拒绝缺 in/out', () => {
    const m = validateManifest({ api: 1, name: 'X', videoTransitions: [def] })
    expect(m.videoTransitions).toHaveLength(1)
    expect(() => validateManifest({ api: 1, name: 'X', videoTransitions: [{ id: 'a', name: 'b' }] })).toThrow()
  })
})
