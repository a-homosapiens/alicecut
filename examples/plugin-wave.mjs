// 示例特效插件（api=1）。导入后会在「特效」选择器里出现，预览与导出通用。
// 契约见 docs/plugin-platform.md / src/core/effects/sdk.ts。
export default {
  api: 1,
  name: '示例特效包',
  version: '1.0.0',
  author: 'demo',
  textEffects: [
    {
      id: 'demo.wave',
      name: '波浪',
      unit: 'char',
      enterDurationMs: 300,
      apply({ enterT, charIndexInUnit, unitIndex, timeInLine, intensity }, m) {
        const phase = timeInLine / 220 + (unitIndex + charIndexInUnit) * 0.6
        return {
          dy: Math.sin(phase) * 10 * intensity,
          rotate: Math.sin(phase) * 0.05 * intensity,
          alpha: m.clamp01(enterT * 2)
        }
      }
    },
    {
      id: 'demo.drop',
      name: '弹跳落入',
      unit: 'word',
      enterDurationMs: 600,
      apply({ enterT, intensity }, m) {
        const s = m.spring(m.clamp01(enterT))
        return {
          dy: (1 - s) * -60 * intensity,
          scale: 0.6 + 0.4 * s,
          alpha: m.clamp01(enterT * 3)
        }
      }
    }
  ]
}
