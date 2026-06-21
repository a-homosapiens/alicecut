import { describe, expect, it } from 'vitest'
import { installTextEffects } from './plugins'
import { getEffect } from './core/effects'
import type { PluginManifest } from './core/effects/sdk'

/**
 * 端到端注册路径（GUI 导入在 loadPluginSource 通过 Worker 闸门 + 主世界 import 后，
 * 走的就是 installTextEffects → 注册表 → getEffect）。这里直接用清单对象验证该段，
 * 不涉及浏览器专属的 blob/Worker 机制（那部分由 pluginSandbox/validator 覆盖）。
 */
describe('插件导入注册路径', () => {
  const manifest: PluginManifest = {
    api: 1,
    name: 'Neon-ish',
    textEffects: [
      {
        id: 'test.neon',
        name: '霓虹',
        unit: 'char',
        enterDurationMs: 420,
        apply: (a, m) => ({ glow: 10 * a.intensity, alpha: m.clamp01(a.enterT), highlight: 0.25 })
      }
    ]
  }

  it('installTextEffects 注册后 getEffect 取回可用预设', () => {
    const added = installTextEffects(manifest)
    expect(added).toEqual([{ id: 'test.neon', name: '霓虹' }])
    const preset = getEffect('test.neon')
    expect(preset.name).toBe('霓虹')
    expect(preset.unit).toBe('char')
    expect(preset.enterDuration).toBe(420)
  })

  it('注册的预设 apply 经过合并+钳制', () => {
    installTextEffects(manifest)
    const fx = getEffect('test.neon').apply({
      unitIndex: 0,
      unitCount: 1,
      charIndexInUnit: 0,
      enterT: 1,
      timeInLine: 0,
      lineDuration: 1000,
      unitStart: 0,
      unitEnd: 500,
      intensity: 1,
      rand: () => 0.5
    })
    expect(fx.glow).toBe(10)
    expect(fx.alpha).toBe(1)
    expect(fx.highlight).toBe(0.25)
    // 未指定字段取恒等默认
    expect(fx.dx).toBe(0)
    expect(fx.scale).toBe(1)
  })
})
