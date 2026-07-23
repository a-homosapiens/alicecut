import { describe, expect, it } from 'vitest'
import { seededRand } from '../easing'
import { EFFECTS, getEffect } from './index'
import { ENTRANCE_EFFECTS } from './entrances'
import { EXIT_EFFECTS } from './exits'

const args = {
  unitIndex: 1,
  unitCount: 4,
  charIndexInUnit: 2,
  enterT: 0.5,
  timeInLine: 500,
  lineDuration: 2000,
  unitStart: 250,
  unitEnd: 750,
  intensity: 1,
  rand: seededRand(42)
}

describe('direction-specific built-in effect catalog', () => {
  it('registers the direction-specific entrance and exit presets', () => {
    expect(ENTRANCE_EFFECTS).toHaveLength(15)
    expect(EXIT_EFFECTS).toHaveLength(15)
    expect(ENTRANCE_EFFECTS.every((effect) => effect.picker === 'in')).toBe(true)
    expect(EXIT_EFFECTS.every((effect) => effect.picker === 'out')).toBe(true)
  })

  it('uses globally unique stable ids', () => {
    const ids = EFFECTS.map((effect) => effect.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('provides an identity None effect in both pickers', () => {
    const none = getEffect('none')
    expect(none.picker).toBe('both')
    for (const enterT of [0, 0.5, 1]) {
      expect(none.apply({ ...args, enterT })).toMatchObject({
        dx: 0,
        dy: 0,
        scale: 1,
        rotate: 0,
        alpha: 1,
        blur: 0,
        glow: 0
      })
    }
  })

  it('all new presets are deterministic, finite, and stay in renderer-safe ranges', () => {
    for (const effect of [...ENTRANCE_EFFECTS, ...EXIT_EFFECTS]) {
      for (const enterT of [0, 0.25, 0.5, 0.75, 1]) {
        const input = { ...args, enterT }
        const a = effect.apply(input)
        const b = effect.apply(input)
        expect(a, effect.id).toEqual(b)
        for (const value of [a.dx, a.dy, a.scale, a.rotate, a.alpha, a.blur, a.glow, a.skewX ?? 0, a.skewY ?? 0]) {
          expect(Number.isFinite(value), effect.id).toBe(true)
        }
        expect(a.scale, effect.id).toBeGreaterThan(0)
        expect(a.alpha, effect.id).toBeGreaterThanOrEqual(0)
        expect(a.alpha, effect.id).toBeLessThanOrEqual(1)
        expect(a.blur, effect.id).toBeGreaterThanOrEqual(0)
        expect(a.glow, effect.id).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('all exit presets end at the normal resting transform before reverse playback', () => {
    for (const effect of EXIT_EFFECTS) {
      const final = effect.apply({ ...args, enterT: 1 })
      expect(final.dx, effect.id).toBeCloseTo(0, 8)
      expect(final.dy, effect.id).toBeCloseTo(0, 8)
      expect(final.scale, effect.id).toBeCloseTo(1, 8)
      expect(final.rotate, effect.id).toBeCloseTo(0, 8)
      expect(final.alpha, effect.id).toBeCloseTo(1, 8)
      expect(final.blur, effect.id).toBeCloseTo(0, 8)
    }
  })
})
