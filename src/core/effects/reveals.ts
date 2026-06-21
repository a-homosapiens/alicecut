import type { CharFx, EffectPreset } from './types'

/** 遮罩揭示类特效：整行从行首一起出现，可见性由裁剪边界推进（见 render.ts drawLineReveal） */
const SHOWN: CharFx = { dx: 0, dy: 0, scale: 1, rotate: 0, alpha: 1, blur: 0, glow: 0 }

/** 横向擦入：矩形遮罩从左向右扫过，逐渐露出整行（仿 @remotion/transitions wipe）。 */
export const wipe: EffectPreset = {
  id: 'wipe',
  name: '横向擦入',
  enterDuration: 520,
  layoutVariant: 'center',
  unit: 'char',
  appearAtLineStart: true,
  reveal: 'wipe',
  apply: () => SHOWN
}

/** 圆形展开：圆形遮罩从中心放大露出整行（仿 transitions iris）。 */
export const iris: EffectPreset = {
  id: 'iris',
  name: '圆形展开',
  enterDuration: 520,
  layoutVariant: 'center',
  unit: 'char',
  appearAtLineStart: true,
  reveal: 'iris',
  apply: () => SHOWN
}

/** 钟摆扫入：以行中心为轴的角度扇形顺时针扫满一圈露出整行（仿 transitions clockWipe）。 */
export const clockWipe: EffectPreset = {
  id: 'clockWipe',
  name: '钟摆扫入',
  enterDuration: 560,
  layoutVariant: 'center',
  unit: 'char',
  appearAtLineStart: true,
  reveal: 'clockWipe',
  apply: () => SHOWN
}
