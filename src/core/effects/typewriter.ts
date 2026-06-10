import { clamp01 } from '../easing'
import type { EffectPreset } from './types'

/** 打字机：逐字瞬现 + 行尾闪烁光标 */
export const typewriter: EffectPreset = {
  id: 'typewriter',
  name: '打字机',
  enterDuration: 90,
  layoutVariant: 'center',
  unit: 'char',
  cursor: true,
  apply({ enterT }) {
    return {
      dx: 0,
      dy: 0,
      scale: 1,
      rotate: 0,
      alpha: clamp01(enterT * 2),
      blur: 0,
      glow: 0
    }
  }
}
