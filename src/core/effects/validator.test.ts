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

describe('validatePlugin 整行转场', () => {
  const lineGood = {
    api: 1,
    name: 'Lines',
    lineTransitions: [
      {
        id: 'l.tilt',
        name: '上叠',
        enterDurationMs: 460,
        maxDepth: 2,
        enterFrom: () => ({ alpha: 0, scale: 0.6 }),
        pose: (depth: number) => (depth === 0 ? {} : { dy: -80 * depth, scale: 0.5 })
      }
    ]
  }

  it('合法整行转场通过并计入 effectCount', () => {
    const r = validatePlugin(lineGood, 'export default {}')
    expect(r.ok).toBe(true)
    expect(r.effectCount).toBe(1)
    expect(r.sample.some((s) => /enterFrom/.test(s))).toBe(true)
  })

  it('pose 非确定性 → 致命错误', () => {
    const r = validatePlugin({
      ...lineGood,
      lineTransitions: [{ ...lineGood.lineTransitions[0], pose: () => ({ dy: Math.random() }) }]
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.level === 'error' && /非确定性/.test(i.message))).toBe(true)
  })

  it('缺 enterFrom/pose → 致命错误', () => {
    const r = validatePlugin({ api: 1, name: 'X', lineTransitions: [{ id: 'a', name: 'b' }] })
    expect(r.ok).toBe(false)
  })
})

describe('validatePlugin 视频转场', () => {
  const vtGood = {
    api: 1,
    name: 'VT',
    videoTransitions: [
      { id: 'v.spin', name: '旋入', in: (p: number) => ({ alpha: p, scale: 1.2 - 0.2 * p }), out: (p: number) => ({ alpha: p }) }
    ]
  }

  it('合法视频转场通过并计入 effectCount', () => {
    const r = validatePlugin(vtGood, 'export default {}')
    expect(r.ok).toBe(true)
    expect(r.effectCount).toBe(1)
    expect(r.sample.some((s) => /in\(/.test(s))).toBe(true)
  })

  it('in 非确定性 → 致命错误', () => {
    const r = validatePlugin({
      ...vtGood,
      videoTransitions: [{ ...vtGood.videoTransitions[0], in: () => ({ alpha: Math.random() }) }]
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.level === 'error' && /非确定性/.test(i.message))).toBe(true)
  })

  it('缺 in/out → 致命错误', () => {
    expect(validatePlugin({ api: 1, name: 'X', videoTransitions: [{ id: 'a', name: 'b' }] }).ok).toBe(false)
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
