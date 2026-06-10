import { easeOutCubic, easeOutQuad } from '../easing'
import type { EffectPreset } from './types'

/** 滑动错落：相邻字从相反方向滑入，带运动模糊感 */
export const slide: EffectPreset = {
  id: 'slide',
  name: '滑动错落',
  enterDuration: 380,
  layoutVariant: 'center',
  unit: 'char',
  apply({ unitIndex, charIndexInUnit, enterT, intensity }) {
    const dir = (unitIndex + charIndexInUnit) % 2 === 0 ? -1 : 1
    const p = easeOutCubic(enterT)
    return {
      dx: (1 - p) * 130 * intensity * dir,
      dy: 0,
      scale: 1,
      rotate: 0,
      alpha: easeOutQuad(enterT),
      blur: (1 - p) * 7 * intensity,
      glow: 0
    }
  }
}
