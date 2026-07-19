// AliceCut — effect plugin starter template (api 1)
// Copy this file, rename it, and edit the effects below.
//
// A plugin is an ES module whose default export is a PluginManifest.
// Types: ./effect-plugin.d.ts   ·   Guide: ./README.md
// Validate:  node scripts/validate-plugin.ts your-plugin.mjs
//
// The optional JSDoc type import below gives editor autocomplete without any
// build step or dependency (it just points at the published .d.ts):
/** @typedef {import('./effect-plugin').PluginManifest} PluginManifest */
/** @typedef {import('./effect-plugin').TextFxArgs} TextFxArgs */
/** @typedef {import('./effect-plugin').PluginHelpers} PluginHelpers */
/** @typedef {import('./effect-plugin').PartialCharFx} PartialCharFx */

/** @type {PluginManifest} */
export default {
  api: 1,
  name: 'My Effect Pack',
  version: '1.0.0',
  author: 'your-handle',
  textEffects: [
    {
      // Namespace your id to avoid collisions, e.g. "<handle>.<effect>".
      id: 'your-handle.rise',
      name: 'Rise In', // shown in the picker
      unit: 'char', // 'char' = per character, 'word' = per word
      enterDurationMs: 360,

      /**
       * Called once per character per frame. Pure + deterministic + fast.
       * Return only the fields you want to change (merged over identity).
       *
       * @param {TextFxArgs} args
       * @param {PluginHelpers} m
       * @returns {PartialCharFx}
       */
      apply(args, m) {
        const e = m.easeOutCubic(m.clamp01(args.enterT))
        return {
          dy: (1 - e) * 40 * args.intensity, // rise from 40px below
          alpha: m.clamp01(args.enterT * 2) // fade in (canvas px, 0..1 alpha)
        }
      }
    }

    // Add more effects here. Determinism rule: never call Math.random(),
    // Date.now(), or performance.now() — for randomness use args.rand(key),
    // which is seeded per line and identical every frame.
  ]
}
