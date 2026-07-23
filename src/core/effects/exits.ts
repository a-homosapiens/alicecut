import { clamp01, easeOutBack, easeOutCubic, easeOutExpo } from '../easing'
import type { EffectPreset } from './types'

/**
 * Exit presets are authored as reversible entrance curves: t=1 is the resting
 * caption and t=0 is the final departed pose. The renderer plays them 1 → 0.
 */
export const EXIT_EFFECTS: EffectPreset[] = [
  {
    id: 'fade-up-out',
    name: 'Fade Up',
    picker: 'out',
    enterDuration: 420,
    layoutVariant: 'center',
    unit: 'line',
    appearAtLineStart: true,
    apply({ enterT, intensity }) {
      const e = easeOutCubic(enterT)
      return { dx: 0, dy: -(1 - e) * 86 * intensity, scale: 1, rotate: 0, alpha: e, blur: (1 - e) * 9, glow: 0 }
    }
  },
  {
    id: 'drop-out',
    name: 'Drop Away',
    picker: 'out',
    enterDuration: 480,
    layoutVariant: 'center',
    unit: 'word',
    apply({ enterT, unitIndex, intensity }) {
      const e = easeOutCubic(enterT)
      const side = unitIndex % 2 === 0 ? -1 : 1
      return { dx: side * (1 - e) * 20, dy: (1 - e) * 150 * intensity, scale: 0.82 + 0.18 * e, rotate: side * (1 - e) * 0.38 * intensity, alpha: clamp01(enterT * 1.7), blur: (1 - e) * 3, glow: 0 }
    }
  },
  {
    id: 'zoom-away-out',
    name: 'Zoom Away',
    picker: 'out',
    enterDuration: 440,
    layoutVariant: 'center',
    unit: 'line',
    appearAtLineStart: true,
    apply({ enterT, intensity }) {
      const e = easeOutExpo(enterT)
      return { dx: 0, dy: 0, scale: 1 + (1 - e) * 0.9 * intensity, rotate: 0, alpha: easeOutCubic(enterT), blur: (1 - e) * 16, glow: (1 - e) * 8 }
    }
  },
  {
    id: 'implode-out',
    name: 'Implode',
    picker: 'out',
    enterDuration: 430,
    layoutVariant: 'center',
    unit: 'line',
    appearAtLineStart: true,
    apply({ enterT, intensity }) {
      const e = easeOutCubic(enterT)
      return { dx: 0, dy: 0, scale: Math.max(0.03, 0.04 + 0.96 * e), rotate: (1 - e) * 0.18 * intensity, alpha: clamp01(enterT * 1.5), blur: (1 - e) * 5, glow: (1 - e) * 12 }
    }
  },
  {
    id: 'scatter-out',
    name: 'Scatter Out',
    picker: 'out',
    enterDuration: 600,
    layoutVariant: 'center',
    unit: 'char',
    apply({ enterT, unitIndex, charIndexInUnit, intensity, rand }) {
      const e = easeOutCubic(enterT)
      const key = unitIndex * 101 + charIndexInUnit * 17
      const rx = rand(key + 4) * 2 - 1
      const ry = rand(key + 5) * 2 - 1
      const rr = rand(key + 6) * 2 - 1
      return { dx: rx * (1 - e) * 260 * intensity, dy: ry * (1 - e) * 190 * intensity, scale: 0.45 + 0.55 * e, rotate: rr * (1 - e) * 1.4, alpha: clamp01(enterT * 1.6), blur: (1 - e) * 5, glow: 0 }
    }
  },
  {
    id: 'whip-left-out',
    name: 'Whip Left',
    picker: 'out',
    enterDuration: 360,
    layoutVariant: 'center',
    unit: 'word',
    apply({ enterT, unitIndex, intensity }) {
      const e = easeOutCubic(enterT)
      return { dx: -(1 - e) * (310 + unitIndex * 18) * intensity, dy: (1 - e) * 12, scale: 0.88 + 0.12 * e, rotate: -(1 - e) * 0.14, alpha: clamp01(enterT * 2.2), blur: (1 - e) * 5, glow: 0, skewX: -(1 - e) * 0.28 }
    }
  },
  {
    id: 'tumble-out',
    name: 'Tumble Out',
    picker: 'out',
    enterDuration: 520,
    layoutVariant: 'center',
    unit: 'char',
    apply({ enterT, unitIndex, charIndexInUnit, intensity }) {
      const e = easeOutCubic(enterT)
      const side = (unitIndex + charIndexInUnit) % 2 === 0 ? -1 : 1
      return { dx: side * (1 - e) * 52, dy: (1 - e) * 138 * intensity, scale: 0.52 + 0.48 * e, rotate: side * (1 - e) * 1.35 * intensity, alpha: clamp01(enterT * 1.8), blur: (1 - e) * 2, glow: 0 }
    }
  },
  {
    id: 'dissolve-out',
    name: 'Dissolve',
    picker: 'out',
    enterDuration: 560,
    layoutVariant: 'center',
    unit: 'char',
    appearAtLineStart: true,
    apply({ enterT, unitIndex, charIndexInUnit, intensity, rand }) {
      const key = unitIndex * 89 + charIndexInUnit * 19
      const threshold = rand(key + 8) * 0.7
      const local = clamp01((enterT - threshold) / 0.3)
      return { dx: (rand(key + 9) - 0.5) * (1 - local) * 28 * intensity, dy: -(1 - local) * rand(key + 10) * 34, scale: 0.86 + 0.14 * local, rotate: 0, alpha: local, blur: (1 - local) * 7, glow: local < 0.5 ? 4 * intensity : 0 }
    }
  },
  {
    id: 'evaporate-out',
    name: 'Evaporate',
    picker: 'out',
    enterDuration: 620,
    layoutVariant: 'center',
    unit: 'char',
    apply({ enterT, unitIndex, charIndexInUnit, intensity, rand }) {
      const e = easeOutCubic(enterT)
      const key = unitIndex * 71 + charIndexInUnit * 23
      const drift = rand(key + 11) * 2 - 1
      return { dx: drift * (1 - e) * 46 * intensity, dy: -(1 - e) * (90 + rand(key + 12) * 100) * intensity, scale: 0.72 + 0.28 * e, rotate: drift * (1 - e) * 0.25, alpha: clamp01(enterT * 1.45), blur: (1 - e) * 13, glow: (1 - e) * 5 }
    }
  },
  {
    id: 'sink-out',
    name: 'Word Sink',
    picker: 'out',
    enterDuration: 560,
    layoutVariant: 'center',
    unit: 'word',
    appearAtLineStart: true,
    apply({ enterT, unitIndex, unitCount, intensity }) {
      const reverseIndex = Math.max(0, unitCount - 1 - unitIndex)
      const delay = unitCount > 1 ? (reverseIndex / (unitCount - 1)) * 0.34 : 0
      const local = clamp01((enterT - delay) / Math.max(0.01, 1 - delay))
      const e = easeOutCubic(local)
      return { dx: 0, dy: (1 - e) * (78 + unitIndex * 8) * intensity, scale: 0.78 + 0.22 * e, rotate: 0, alpha: clamp01(local * 1.7), blur: (1 - e) * 6, glow: 0 }
    }
  },
  {
    id: 'blur-out',
    name: 'Blur Out',
    picker: 'out',
    enterDuration: 500,
    layoutVariant: 'center',
    unit: 'line',
    appearAtLineStart: true,
    apply({ enterT, intensity }) {
      const e = easeOutCubic(enterT)
      return { dx: 0, dy: 0, scale: 1 + (1 - e) * 0.04, rotate: 0, alpha: e, blur: (1 - e) * 24 * intensity, glow: 0 }
    }
  },
  {
    id: 'shrink-out',
    name: 'Shrink Out',
    picker: 'out',
    enterDuration: 460,
    layoutVariant: 'center',
    unit: 'word',
    apply({ enterT, unitIndex, intensity }) {
      const e = easeOutCubic(enterT)
      const side = unitIndex % 2 === 0 ? -1 : 1
      return { dx: side * (1 - e) * 22 * intensity, dy: 0, scale: Math.max(0.06, 0.05 + 0.95 * e), rotate: side * (1 - e) * 0.08, alpha: clamp01(enterT * 1.5), blur: (1 - e) * 3, glow: 0 }
    }
  },
  {
    id: 'rotate-out',
    name: 'Rotate Out',
    picker: 'out',
    enterDuration: 520,
    layoutVariant: 'center',
    unit: 'line',
    appearAtLineStart: true,
    apply({ enterT, intensity }) {
      const e = clamp01(easeOutBack(enterT))
      return { dx: 0, dy: (1 - e) * -18 * intensity, scale: 0.92 + 0.08 * e, rotate: (1 - e) * 0.24 * intensity, alpha: clamp01(enterT * 1.7), blur: (1 - e) * 4, glow: 0 }
    }
  },
  {
    id: 'glitch-out',
    name: 'Glitch Out',
    picker: 'out',
    enterDuration: 460,
    layoutVariant: 'center',
    unit: 'char',
    apply({ enterT, unitIndex, charIndexInUnit, intensity, rand }) {
      const e = easeOutCubic(enterT)
      const key = unitIndex * 47 + charIndexInUnit * 19
      const jitter = (rand(key) * 2 - 1) * (1 - e)
      return { dx: jitter * 34 * intensity, dy: (rand(key + 1) * 2 - 1) * (1 - e) * 18 * intensity, scale: 0.94 + 0.06 * e, rotate: jitter * 0.1, alpha: clamp01(enterT * 1.7), blur: (1 - e) * 3, glow: 0 }
    }
  },
  {
    id: 'stretch-out',
    name: 'Stretch Out',
    picker: 'out',
    enterDuration: 480,
    layoutVariant: 'center',
    unit: 'word',
    apply({ enterT, intensity }) {
      const e = easeOutCubic(enterT)
      return { dx: 0, dy: 0, scale: 0.7 + 0.3 * e, rotate: 0, alpha: clamp01(enterT * 1.6), blur: (1 - e) * 3, glow: 0, skewX: -(1 - e) * 0.32 * intensity }
    }
  }
]
