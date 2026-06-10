import { easeOutCubic } from '../easing'
import type { EffectPreset } from './types'

/** 发光渐显：柔和淡入 + 辉光呼吸脉冲 */
export const glow: EffectPreset = {
  id: 'glow',
  name: '发光渐显',
  enterDuration: 600,
  layoutVariant: 'center',
  unit: 'char',
  apply({ enterT, timeInLine, intensity }) {
    const p = easeOutCubic(enterT)
    const pulse = 0.5 + 0.5 * Math.sin((timeInLine / 1000) * Math.PI * 2 * 1.2)
    return {
      dx: 0,
      dy: 0,
      scale: 0.94 + 0.06 * p,
      rotate: 0,
      alpha: p,
      blur: 0,
      glow: intensity * ((1 - p) * 22 + 10 + pulse * 8)
    }
  }
}
