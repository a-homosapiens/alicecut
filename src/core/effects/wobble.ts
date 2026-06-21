import { clamp01, valueNoise } from '../easing'
import type { EffectPreset } from './types'

/**
 * 飘摆：逐字用平滑噪声做有机的轻微漂移 + 旋转 + 错切，像被风吹动。
 * 各字相位独立（按词序/字序播种），整行不会同步晃动。
 */
export const wobble: EffectPreset = {
  id: 'wobble',
  name: '飘摆',
  enterDuration: 320,
  layoutVariant: 'center',
  unit: 'char',
  apply({ enterT, timeInLine, unitIndex, charIndexInUnit, intensity }) {
    const seed = unitIndex * 31 + charIndexInUnit * 7 + 1
    const x = timeInLine / 620 // 噪声推进速度
    const k = intensity
    return {
      dx: valueNoise(seed, x) * 6 * k,
      dy: valueNoise(seed + 101, x) * 6 * k,
      scale: 1,
      rotate: valueNoise(seed + 202, x) * 0.06 * k,
      alpha: clamp01(enterT * 2),
      blur: 0,
      glow: 0,
      skewX: valueNoise(seed + 303, x) * 0.12 * k
    }
  }
}
