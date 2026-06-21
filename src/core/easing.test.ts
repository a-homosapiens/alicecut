import { describe, expect, it } from 'vitest'
import { springEase, valueNoise } from './easing'

describe('springEase', () => {
  it('端点为 0 与 1', () => {
    expect(springEase(0)).toBe(0)
    expect(springEase(1)).toBe(1)
    expect(springEase(-0.5)).toBe(0)
    expect(springEase(2)).toBe(1)
  })

  it('中途存在过冲（> 1）', () => {
    expect(springEase(0.35)).toBeGreaterThan(1)
  })

  it('起步从 0 递增', () => {
    expect(springEase(0.05)).toBeGreaterThan(0)
  })
})

describe('valueNoise', () => {
  it('确定性：同输入同输出', () => {
    expect(valueNoise(7, 1.3)).toBe(valueNoise(7, 1.3))
  })

  it('落在 [-1, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const v = valueNoise(3, i * 0.137)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('连续平滑：x 微小变化 → 输出微小变化', () => {
    for (let i = 0; i < 50; i++) {
      const x = i * 0.31
      expect(Math.abs(valueNoise(9, x + 0.001) - valueNoise(9, x))).toBeLessThan(0.05)
    }
  })

  it('不同 seed 给出不同序列', () => {
    expect(valueNoise(1, 2.5)).not.toBe(valueNoise(2, 2.5))
  })
})
