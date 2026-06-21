import { clamp01, springEase } from '../easing'
import type { EffectPreset } from './types'

/** 弹跳：逐词用真实弹簧落入——从上方落下、缩放过冲后回弹归位。 */
export const bounce: EffectPreset = {
  id: 'bounce',
  name: '弹跳',
  enterDuration: 620,
  layoutVariant: 'center',
  unit: 'word',
  apply({ enterT, intensity }) {
    const s = springEase(clamp01(enterT)) // 0→1，带回弹过冲
    return {
      dx: 0,
      dy: (1 - s) * -42 * intensity, // 从上方弹入，过冲时略微下沉再回正
      scale: 0.7 + 0.3 * s,
      rotate: 0,
      alpha: clamp01(enterT * 3),
      blur: 0,
      glow: 0
    }
  }
}
