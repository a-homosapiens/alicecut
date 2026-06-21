// Showcases the declarative capabilities added to the plugin contract:
// reveal (clip-mask), trail (motion blur), and wordBox (jumping highlight).
// These are static fields the host renders — apply still runs alongside.
// Validate: node scripts/validate-plugin.ts examples/plugin-masks.mjs
/** @typedef {import('../plugin-sdk/effect-plugin').PluginManifest} PluginManifest */

/** @type {PluginManifest} */
export default {
  api: 1,
  name: 'Mask Pack',
  version: '1.0.0',
  author: 'claude',
  textEffects: [
    {
      // Geometric iris reveal: whole line present, a growing circle opens it.
      id: 'mask.iris',
      name: '圆形展开',
      unit: 'char',
      enterDurationMs: 520,
      appearAtLineStart: true,
      reveal: 'iris',
      apply() {
        return {} // identity — the clip mask performs the reveal
      }
    },
    {
      // Motion-blur streak: slide in from the right with a fading trail.
      id: 'mask.streak',
      name: '残影滑入',
      unit: 'char',
      enterDurationMs: 360,
      trail: { count: 5, stepMs: 22, decay: 0.5 },
      apply(a, m) {
        const e = m.easeOutCubic(m.clamp01(a.enterT))
        return { dx: (1 - e) * 220 * a.intensity, alpha: m.clamp01(a.enterT * 1.6) }
      }
    },
    {
      // Karaoke word box: line appears at once; a box springs to the spoken word.
      id: 'mask.wordbox',
      name: '跳动高亮块',
      unit: 'word',
      enterDurationMs: 280,
      appearAtLineStart: true,
      wordBox: true,
      apply(a, m) {
        return { alpha: m.clamp01(a.enterT) }
      }
    }
  ]
}
