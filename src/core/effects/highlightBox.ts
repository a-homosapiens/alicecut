import { clamp01, easeOutCubic } from '../easing'
import type { EffectPreset } from './types'

/**
 * 跳动高亮块（仿抖音/Submagic 字幕）：整句一开始全部出现，
 * 当前朗读词背后垫一个圆角高亮块，逐词推进时高亮块弹跳着"跳"到下一个词。
 * 高亮块的定位与弹跳由渲染层按词包围盒计算（见 render.ts resolveWordBox）。
 */
export const highlightBox: EffectPreset = {
  id: 'highlightBox',
  name: '跳动高亮块',
  enterDuration: 280,
  layoutVariant: 'center',
  unit: 'word',
  appearAtLineStart: true,
  wordBox: true,
  apply({ enterT }) {
    return {
      dx: 0,
      dy: 0,
      scale: 1,
      rotate: 0,
      alpha: easeOutCubic(clamp01(enterT)),
      blur: 0,
      glow: 0
    }
  }
}
