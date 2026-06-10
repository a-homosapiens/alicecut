import type { EffectPreset, LineFx, LineFxArgs } from './types'
import { IDENTITY_LINE_FX } from './types'

/** 停靠缩放：强度滑杆控制上方旧字幕比新字幕大还是小（1.7+ 时会更大） */
function parkedScale(intensity: number): number {
  return 0.4 + 0.35 * intensity
}

const PARKED_ALPHA = [1, 0.85, 0.6, 0.35]

/**
 * 上移切换：整句从下方进入中心。旧字幕不消失——缩放后向上挪，
 * 紧靠在新字幕上方逐条堆叠成历史；越往上越淡，超出深度后淡出。
 */
export const rise: EffectPreset = {
  id: 'rise',
  name: '上移切换',
  enterDuration: 480,
  layoutVariant: 'center',
  unit: 'line',
  lineTransition: {
    maxDepth: 3,
    enterFrom({ height, intensity }: LineFxArgs): LineFx {
      return {
        dx: 0,
        dy: height * 0.22 * intensity,
        rotate: 0,
        scale: 0.6,
        alpha: 0,
        blur: 1.5 * intensity
      }
    },
    pose(depth, { fontSize, intensity, blocks }: LineFxArgs): LineFx {
      if (depth === 0) return IDENTITY_LINE_FX
      const s = parkedScale(intensity)
      const gap = fontSize * 0.45
      const blockH = (d: number): number => blocks[Math.min(d, blocks.length - 1)].h
      // 累计向上偏移：当前行上半块 + 间距 + 中间各旧行缩放后的高度 + 自己的半块
      let dy = -(blockH(0) / 2 + gap)
      for (let k = 1; k < depth; k++) dy -= blockH(k) * s + gap
      dy -= (blockH(depth) * s) / 2
      const alpha = depth < PARKED_ALPHA.length ? PARKED_ALPHA[depth] : 0
      return { dx: 0, dy, rotate: 0, scale: s, alpha, blur: 0 }
    }
  },
  apply() {
    return { dx: 0, dy: 0, scale: 1, rotate: 0, alpha: 1, blur: 0, glow: 0 }
  }
}
