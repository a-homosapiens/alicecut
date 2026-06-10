import { easeOutExpo, clamp01 } from '../easing'
import type { EffectPreset } from './types'

/** 缩放冲击：错落构图，每个词超大砸入回弹，重拍感最强 */
export const punch: EffectPreset = {
  id: 'punch',
  name: '缩放冲击',
  enterDuration: 320,
  layoutVariant: 'staggered',
  unit: 'word',
  apply({ unitIndex, enterT, intensity, rand }) {
    const p = easeOutExpo(enterT)
    const wobble = (rand(unitIndex * 17 + 7) - 0.5) * 0.2
    return {
      dx: 0,
      dy: 0,
      scale: 1 + (1 - p) * 1.5 * intensity,
      rotate: (1 - p) * wobble,
      alpha: clamp01(enterT * 4),
      blur: (1 - p) * 5 * intensity,
      glow: 0
    }
  }
}
