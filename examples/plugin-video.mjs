// Showcases plugin VIDEO transitions (manifest.videoTransitions). These appear
// in the timeline clip's 转场 dropdown (built-in + plugin). A transition between
// two clips = overlap clip B's start before A ends and give B an `in`.
// Validate: node scripts/validate-plugin.ts examples/plugin-video.mjs
/** @typedef {import('../plugin-sdk/effect-plugin').PluginManifest} PluginManifest */

/** @type {PluginManifest} */
export default {
  api: 1,
  name: 'Video Pack',
  version: '1.0.0',
  author: 'claude',
  videoTransitions: [
    {
      // Zoom punch in: starts large + transparent, snaps to place. Out: fade + grow.
      id: 'video.punchIn',
      name: '冲入',
      in: (p, m) => ({ alpha: m.clamp01(p * 1.5), scale: 1.6 - 0.6 * m.easeOutCubic(p) }),
      out: (p) => ({ alpha: p, scale: 1 + 0.4 * (1 - p) })
    },
    {
      // Diagonal slide: enters from the top-left corner.
      id: 'video.diagSlide',
      name: '斜滑入',
      in: (p) => ({ dxFrac: -(1 - p) * 0.6, dyFrac: -(1 - p) * 0.6, alpha: p }),
      out: (p) => ({ dxFrac: (1 - p) * 0.6, dyFrac: (1 - p) * 0.6, alpha: p })
    },
    {
      // Vertical blinds: a top-down wipe reveal.
      id: 'video.blinds',
      name: '百叶帘',
      in: (p) => ({ wipe: { dir: 'U', reveal: p } }),
      out: (p) => ({ wipe: { dir: 'U', reveal: p } })
    }
  ]
}
