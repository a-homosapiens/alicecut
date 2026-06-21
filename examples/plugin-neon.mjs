// Sample plugin authored against the published SDK (plugin-sdk/effect-plugin.d.ts).
// Distinct from plugin-wave: shows glow/highlight, per-char stagger via rand,
// and a per-word shutter. Validate: node scripts/validate-plugin.ts examples/plugin-neon.mjs
/** @typedef {import('../plugin-sdk/effect-plugin').PluginManifest} PluginManifest */

/** @type {PluginManifest} */
export default {
  api: 1,
  name: 'Neon Pack',
  version: '1.0.0',
  author: 'claude',
  textEffects: [
    {
      // Neon flicker-in: chars fade in with a pulsing glow, each char's flicker
      // phase decorrelated via the deterministic rand (stable every frame).
      id: 'neon.flicker',
      name: '霓虹闪入',
      unit: 'char',
      enterDurationMs: 420,
      apply(a, m) {
        const e = m.easeOutCubic(m.clamp01(a.enterT))
        const phase = a.rand(a.unitIndex * 17 + a.charIndexInUnit) * 6.283
        // settle to a steady soft glow; flicker only while entering
        const flicker = (1 - e) * (0.5 + 0.5 * Math.sin(a.timeInLine / 40 + phase))
        return {
          alpha: m.clamp01(a.enterT * 1.8) * (0.55 + 0.45 * (1 - (1 - e) * 0.5)),
          glow: (6 + 18 * flicker) * a.intensity,
          highlight: 0.25 * e
        }
      }
    },
    {
      // Shutter: each word snaps in vertically (squash → release) using spring.
      id: 'neon.shutter',
      name: '百叶窗',
      unit: 'word',
      enterDurationMs: 500,
      apply(a, m) {
        const s = m.spring(m.clamp01(a.enterT))
        return {
          scale: 1, // keep width
          skewY: (1 - s) * 0.5 * a.intensity, // shear releases as it springs in
          dy: (1 - s) * -24 * a.intensity,
          alpha: m.clamp01(a.enterT * 3)
        }
      }
    }
  ]
}
