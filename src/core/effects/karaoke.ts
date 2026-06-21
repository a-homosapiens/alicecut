import { clamp01, easeOutCubic } from '../easing'
import type { EffectPreset } from './types'

/** 高亮前后的过渡窗口 ms（颜色/缩放平滑进出） */
const RAMP = 90

/**
 * 卡拉OK高亮（仿 After Effects / CapCut / Submagic 自动字幕）：
 * 整句一开始就全部出现，正在朗读的词放大并染成高亮色，逐词推进。
 */
export const karaoke: EffectPreset = {
  id: 'karaoke',
  name: '卡拉OK高亮',
  enterDuration: 280,
  layoutVariant: 'center',
  unit: 'word',
  appearAtLineStart: true,
  apply({ enterT, timeInLine, unitStart, unitEnd, intensity }) {
    // 当前词的高亮强度 h：词起点前 RAMP 内淡入，词内恒 1，词尾后 RAMP 内淡出
    let h = 0
    if (timeInLine >= unitStart - RAMP && timeInLine < unitEnd) {
      h = clamp01((timeInLine - (unitStart - RAMP)) / RAMP)
    } else if (timeInLine >= unitEnd && timeInLine < unitEnd + RAMP) {
      h = 1 - clamp01((timeInLine - unitEnd) / RAMP)
    }
    const e = easeOutCubic(h)
    return {
      dx: 0,
      dy: -10 * intensity * e,
      scale: 1 + 0.16 * intensity * e,
      rotate: 0,
      alpha: easeOutCubic(clamp01(enterT)),
      blur: 0,
      glow: 0,
      highlight: h
    }
  }
}
