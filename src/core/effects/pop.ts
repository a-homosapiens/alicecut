import { easeOutBack, easeOutCubic, clamp01 } from '../easing'
import type { EffectPreset } from './types'

/** 逐字弹出：缩放过冲 0→1.1→1 + 从下方轻微上浮淡入 */
export const pop: EffectPreset = {
  id: 'pop',
  name: '逐字弹出',
  enterDuration: 400,
  layoutVariant: 'center',
  unit: 'char',
  apply({ enterT, intensity }) {
    const s = easeOutBack(enterT)
    return {
      dx: 0,
      dy: (1 - easeOutCubic(enterT)) * 26 * intensity,
      scale: Math.max(0.001, s < 0 ? 0 : 1 + (s - 1) * intensity),
      rotate: 0,
      alpha: easeOutCubic(clamp01(enterT * 1.6)),
      blur: 0,
      glow: 0
    }
  }
}
