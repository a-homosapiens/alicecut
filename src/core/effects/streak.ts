import { clamp01 } from '../easing'
import type { EffectPreset } from './types'

/** 残影滑入：逐字从右侧快速滑入，运动期间拖出一道淡出残影（仿运动模糊）。 */
export const streak: EffectPreset = {
  id: 'streak',
  name: '残影滑入',
  enterDuration: 360,
  layoutVariant: 'center',
  unit: 'char',
  trail: { count: 5, stepMs: 22, decay: 0.5 },
  apply({ enterT, intensity }) {
    const e = clamp01(enterT)
    return {
      dx: (1 - e) * 240 * intensity, // 从右侧滑入到 0
      dy: 0,
      scale: 1,
      rotate: 0,
      alpha: e,
      blur: 0,
      glow: 0
    }
  }
}
