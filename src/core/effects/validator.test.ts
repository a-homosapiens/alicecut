import { describe, expect, it } from 'vitest'
import { validatePlugin, VALIDATOR_HELPERS } from './validator'
import { clamp01, easeOutCubic, easeOutBack, springEase, valueNoise } from '../easing'

const good = {
  api: 1,
  name: 'Good',
  textEffects: [
    { id: 'g.a', name: 'A', unit: 'char', enterDurationMs: 300, apply: ({ enterT }: any, m: any) => ({ alpha: m.clamp01(enterT), dy: 5 }) }
  ]
}

describe('validatePlugin', () => {
  it('合法插件通过', () => {
    const r = validatePlugin(good, 'export default {}')
    expect(r.ok).toBe(true)
    expect(r.effectCount).toBe(1)
    expect(r.sample.length).toBeGreaterThan(0)
  })

  it('非确定性（Math.random）→ 致命错误', () => {
    const r = validatePlugin({
      api: 1,
      name: 'Rand',
      textEffects: [{ id: 'r.x', name: 'x', unit: 'char', apply: () => ({ alpha: Math.random() }) }]
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.level === 'error' && /确定性/.test(i.message))).toBe(true)
  })

  it('apply 抛错 → 致命错误', () => {
    const r = validatePlugin({
      api: 1,
      name: 'Throw',
      textEffects: [{ id: 't.x', name: 'x', unit: 'char', apply: () => { throw new Error('boom') } }]
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.level === 'error' && /抛错/.test(i.message))).toBe(true)
  })

  it('越界输出 → 警告但不阻断', () => {
    const r = validatePlugin({
      api: 1,
      name: 'Range',
      textEffects: [{ id: 'rg.x', name: 'x', unit: 'char', apply: () => ({ alpha: 5 }) }]
    })
    expect(r.ok).toBe(true)
    expect(r.issues.some((i) => i.level === 'warn' && /超出/.test(i.message))).toBe(true)
  })

  it('错误 api 版本 → 致命错误', () => {
    expect(validatePlugin({ api: 2, name: 'X', textEffects: [] }).ok).toBe(false)
  })

  it('源码命中 Math.random → 错误条目', () => {
    const r = validatePlugin(good, 'const x = Math.random()')
    expect(r.issues.some((i) => /源码命中/.test(i.message))).toBe(true)
  })

  it('注释里提及禁用 API 不误报（剥离注释后扫描）', () => {
    const withComment = '// never call Math.random() or Date.now()\n/* performance.now is banned */\nexport default {}'
    const r = validatePlugin(good, withComment)
    expect(r.issues.some((i) => /源码命中/.test(i.message))).toBe(false)
  })

  it('真实使用仍被检出（注释剥离不漏报代码）', () => {
    const r = validatePlugin(good, 'const t = Date.now() // comment')
    expect(r.issues.some((i) => /源码命中/.test(i.message))).toBe(true)
  })
})

describe('校验器内联工具与 easing 对齐', () => {
  it('clamp01 / easeOutCubic / easeOutBack / spring / noise 一致', () => {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20
      expect(VALIDATOR_HELPERS.clamp01(t * 2 - 0.5)).toBe(clamp01(t * 2 - 0.5))
      expect(VALIDATOR_HELPERS.easeOutCubic(t)).toBeCloseTo(easeOutCubic(t), 12)
      expect(VALIDATOR_HELPERS.easeOutBack(t)).toBeCloseTo(easeOutBack(t), 12)
      expect(VALIDATOR_HELPERS.spring(t)).toBeCloseTo(springEase(t), 12)
      expect(VALIDATOR_HELPERS.noise(7, t * 5)).toBeCloseTo(valueNoise(7, t * 5), 12)
    }
  })
})
