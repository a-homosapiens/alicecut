import { clamp01, easeOutBack, easeOutCubic, easeOutExpo, springEase } from '../easing'
import type { EffectPreset } from './types'

/** Ten caption-first entrance motions inspired by common social-video text animation families. */
export const ENTRANCE_EFFECTS: EffectPreset[] = [
  {
    id: 'float-up',
    name: 'Float Up',
    picker: 'in',
    enterDuration: 520,
    layoutVariant: 'center',
    unit: 'word',
    apply({ enterT, intensity }) {
      const e = easeOutCubic(enterT)
      return { dx: 0, dy: (1 - e) * 72 * intensity, scale: 0.92 + 0.08 * e, rotate: 0, alpha: clamp01(enterT * 1.8), blur: (1 - e) * 8 * intensity, glow: 0 }
    }
  },
  {
    id: 'cascade-down',
    name: 'Cascade Down',
    picker: 'in',
    enterDuration: 540,
    layoutVariant: 'center',
    unit: 'char',
    apply({ enterT, charIndexInUnit, unitIndex, intensity }) {
      const e = easeOutCubic(enterT)
      const side = (charIndexInUnit + unitIndex) % 2 === 0 ? -1 : 1
      return { dx: side * (1 - e) * 18 * intensity, dy: -(1 - e) * (90 + charIndexInUnit * 8) * intensity, scale: 0.78 + 0.22 * e, rotate: side * (1 - e) * 0.16, alpha: clamp01(enterT * 2), blur: (1 - e) * 5, glow: 0 }
    }
  },
  {
    id: 'zoom-focus',
    name: 'Zoom Focus',
    picker: 'in',
    enterDuration: 560,
    layoutVariant: 'center',
    unit: 'line',
    appearAtLineStart: true,
    apply({ enterT, intensity }) {
      const e = easeOutExpo(enterT)
      return { dx: 0, dy: 0, scale: 0.48 + 0.52 * e, rotate: 0, alpha: easeOutCubic(enterT), blur: (1 - e) * 20 * intensity, glow: (1 - e) * 8 * intensity }
    }
  },
  {
    id: 'tumble-in',
    name: 'Tumble In',
    picker: 'in',
    enterDuration: 620,
    layoutVariant: 'center',
    unit: 'char',
    apply({ enterT, charIndexInUnit, unitIndex, intensity }) {
      const e = clamp01(easeOutBack(enterT))
      const side = (charIndexInUnit + unitIndex) % 2 === 0 ? -1 : 1
      return { dx: side * (1 - e) * 34 * intensity, dy: -(1 - e) * 96 * intensity, scale: Math.max(0.2, 0.62 + 0.38 * e), rotate: side * (1 - e) * 1.05 * intensity, alpha: clamp01(enterT * 2.2), blur: 0, glow: 0 }
    }
  },
  {
    id: 'split-in',
    name: 'Split In',
    picker: 'in',
    enterDuration: 480,
    layoutVariant: 'center',
    unit: 'char',
    apply({ enterT, charIndexInUnit, unitIndex, intensity }) {
      const e = easeOutCubic(enterT)
      const side = (charIndexInUnit + unitIndex) % 2 === 0 ? -1 : 1
      return { dx: side * (1 - e) * 210 * intensity, dy: 0, scale: 0.86 + 0.14 * e, rotate: side * (1 - e) * 0.08, alpha: clamp01(enterT * 1.7), blur: (1 - e) * 6, glow: 0 }
    }
  },
  {
    id: 'whip-in',
    name: 'Whip In',
    picker: 'in',
    enterDuration: 380,
    layoutVariant: 'center',
    unit: 'word',
    trail: { count: 4, stepMs: 18, decay: 0.42 },
    apply({ enterT, unitIndex, intensity }) {
      const e = easeOutCubic(enterT)
      const side = unitIndex % 2 === 0 ? 1 : -1
      return { dx: side * (1 - e) * 330 * intensity, dy: side * (1 - e) * 18, scale: 0.9 + 0.1 * e, rotate: side * (1 - e) * 0.12, alpha: clamp01(enterT * 2.5), blur: (1 - e) * 3, glow: 0, skewX: side * (1 - e) * 0.22 }
    }
  },
  {
    id: 'scatter-in',
    name: 'Scatter In',
    picker: 'in',
    enterDuration: 680,
    layoutVariant: 'center',
    unit: 'char',
    apply({ enterT, unitIndex, charIndexInUnit, intensity, rand }) {
      const e = easeOutCubic(enterT)
      const key = unitIndex * 97 + charIndexInUnit * 13
      const rx = rand(key + 1) * 2 - 1
      const ry = rand(key + 2) * 2 - 1
      const rr = rand(key + 3) * 2 - 1
      return { dx: rx * (1 - e) * 220 * intensity, dy: ry * (1 - e) * 150 * intensity, scale: 0.42 + 0.58 * e, rotate: rr * (1 - e) * 1.15 * intensity, alpha: clamp01(enterT * 1.8), blur: (1 - e) * 4, glow: 0 }
    }
  },
  {
    id: 'fold-in',
    name: 'Fold In',
    picker: 'in',
    enterDuration: 560,
    layoutVariant: 'center',
    unit: 'word',
    apply({ enterT, unitIndex, intensity }) {
      const e = easeOutBack(enterT)
      const side = unitIndex % 2 === 0 ? -1 : 1
      return { dx: side * (1 - e) * 42 * intensity, dy: (1 - e) * 20, scale: Math.max(0.12, 0.18 + 0.82 * e), rotate: side * (1 - e) * 0.42, alpha: clamp01(enterT * 2), blur: 0, glow: 0, skewY: side * (1 - e) * 0.35 }
    }
  },
  {
    id: 'neon-on',
    name: 'Neon On',
    picker: 'in',
    enterDuration: 720,
    layoutVariant: 'center',
    unit: 'line',
    appearAtLineStart: true,
    apply({ enterT, intensity }) {
      const e = easeOutCubic(enterT)
      const stable = enterT >= 0.72
      const flash = Math.sin(enterT * 79) + Math.sin(enterT * 41) > 0.15 ? 1 : 0.12
      const power = stable ? 1 : flash
      return { dx: 0, dy: 0, scale: 0.97 + 0.03 * e, rotate: 0, alpha: clamp01(e * power), blur: (1 - e) * 2, glow: (8 + (1 - e) * 28) * power * intensity }
    }
  },
  {
    id: 'wave-in',
    name: 'Wave In',
    picker: 'in',
    enterDuration: 600,
    layoutVariant: 'center',
    unit: 'char',
    apply({ enterT, unitIndex, charIndexInUnit, intensity }) {
      const e = springEase(enterT)
      const phase = unitIndex * 1.7 + charIndexInUnit * 0.8
      const wave = Math.sin(phase) * 24
      return { dx: (1 - e) * Math.cos(phase) * 22 * intensity, dy: (1 - e) * (66 + wave) * intensity, scale: 0.72 + 0.28 * e, rotate: (1 - e) * Math.sin(phase) * 0.24, alpha: clamp01(enterT * 2.1), blur: 0, glow: 0 }
    }
  },
  {
    id: 'blur-in',
    name: 'Blur In',
    picker: 'in',
    enterDuration: 500,
    layoutVariant: 'center',
    unit: 'line',
    appearAtLineStart: true,
    apply({ enterT, intensity }) {
      const e = easeOutCubic(enterT)
      return { dx: 0, dy: 0, scale: 1 + (1 - e) * 0.06, rotate: 0, alpha: e, blur: (1 - e) * 24 * intensity, glow: (1 - e) * 3 }
    }
  },
  {
    id: 'elastic-in',
    name: 'Elastic In',
    picker: 'in',
    enterDuration: 620,
    layoutVariant: 'center',
    unit: 'word',
    apply({ enterT, intensity }) {
      const e = springEase(enterT)
      return { dx: 0, dy: 0, scale: Math.max(0.2, 0.62 + 0.38 * e), rotate: 0, alpha: clamp01(enterT * 2), blur: 0, glow: Math.max(0, (1 - e) * 5 * intensity) }
    }
  },
  {
    id: 'rotate-in',
    name: 'Rotate In',
    picker: 'in',
    enterDuration: 520,
    layoutVariant: 'center',
    unit: 'line',
    appearAtLineStart: true,
    apply({ enterT, intensity }) {
      const e = clamp01(easeOutBack(enterT))
      return { dx: 0, dy: (1 - e) * 18 * intensity, scale: 0.9 + 0.1 * e, rotate: (1 - e) * -0.22 * intensity, alpha: clamp01(enterT * 1.8), blur: (1 - e) * 4, glow: 0 }
    }
  },
  {
    id: 'glitch-in',
    name: 'Glitch In',
    picker: 'in',
    enterDuration: 460,
    layoutVariant: 'center',
    unit: 'char',
    apply({ enterT, unitIndex, charIndexInUnit, intensity, rand }) {
      const e = easeOutCubic(enterT)
      const key = unitIndex * 43 + charIndexInUnit * 17
      const jitter = (rand(key) * 2 - 1) * (1 - e)
      return { dx: jitter * 28 * intensity, dy: (rand(key + 1) * 2 - 1) * (1 - e) * 12 * intensity, scale: 0.96 + 0.04 * e, rotate: jitter * 0.08, alpha: clamp01(enterT * 2.4), blur: (1 - e) * 2, glow: 0 }
    }
  },
  {
    id: 'stretch-in',
    name: 'Stretch In',
    picker: 'in',
    enterDuration: 480,
    layoutVariant: 'center',
    unit: 'word',
    apply({ enterT, intensity }) {
      const e = easeOutCubic(enterT)
      return { dx: 0, dy: 0, scale: 0.72 + 0.28 * e, rotate: 0, alpha: clamp01(enterT * 2), blur: (1 - e) * 2, glow: 0, skewX: (1 - e) * 0.28 * intensity }
    }
  }
]
