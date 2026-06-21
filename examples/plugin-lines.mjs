// Showcases a whole-line docking transition (unit: 'line') via lineTransitions.
// The new line enters center; older lines shrink, tilt, and stack above as
// history, fading with depth. Validate: node scripts/validate-plugin.ts examples/plugin-lines.mjs
/** @typedef {import('../plugin-sdk/effect-plugin').PluginManifest} PluginManifest */

/** @type {PluginManifest} */
export default {
  api: 1,
  name: 'Line Pack',
  version: '1.0.0',
  author: 'claude',
  lineTransitions: [
    {
      id: 'lines.tilt',
      name: '倾斜上叠',
      enterDurationMs: 460,
      maxDepth: 3,
      // New line rises in from below, small and transparent.
      enterFrom({ height, intensity }) {
        return { dy: height * 0.2 * intensity, scale: 0.6, alpha: 0, blur: 1.5 * intensity }
      },
      // depth 0 = current center line (identity); deeper = docked above.
      pose(depth, { fontSize, intensity, blocks }, m) {
        if (depth === 0) return {} // identity → center
        const s = 0.45 + 0.3 * intensity
        const gap = fontSize * 0.4
        const blockH = (d) => blocks[Math.min(d, blocks.length - 1)].h
        // cumulative upward offset: half current block + gaps + scaled older blocks
        let dy = -(blockH(0) / 2 + gap)
        for (let k = 1; k < depth; k++) dy -= blockH(k) * s + gap
        dy -= (blockH(depth) * s) / 2
        return {
          dy,
          scale: s,
          rotate: (depth % 2 ? 1 : -1) * 0.05, // alternate slight tilt
          alpha: depth > 3 ? 0 : m.clamp01(1 - depth * 0.3)
        }
      }
    }
  ]
}
