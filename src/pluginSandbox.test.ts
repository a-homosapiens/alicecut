import { describe, expect, it } from 'vitest'
import { analyzeProbe, probePluginInWorker, SandboxUnavailableError, type RawEffectProbe } from './pluginSandbox'

describe('analyzeProbe', () => {
  it('确定性匹配 → 通过', () => {
    const per: RawEffectProbe[] = [{ id: 'a', runA: [{ dy: 1 }, { dy: 2 }], runB: [{ dy: 1 }, { dy: 2 }] }]
    const r = analyzeProbe(per)
    expect(r.ok).toBe(true)
    expect(r.issues).toHaveLength(0)
  })

  it('两跑不同 → 非确定性错误', () => {
    const per: RawEffectProbe[] = [{ id: 'a', runA: [{ dy: 1 }], runB: [{ dy: 2 }] }]
    const r = analyzeProbe(per)
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.level === 'error' && /非确定性/.test(i.message))).toBe(true)
  })

  it('apply 抛错 → 错误', () => {
    const r = analyzeProbe([{ id: 'a', error: 'boom' }])
    expect(r.ok).toBe(false)
    expect(r.issues[0].level).toBe('error')
  })

  it('越界输出 → 警告但通过', () => {
    const per: RawEffectProbe[] = [{ id: 'a', runA: [{ alpha: 9 }], runB: [{ alpha: 9 }] }]
    const r = analyzeProbe(per)
    expect(r.ok).toBe(true)
    expect(r.issues.some((i) => i.level === 'warn' && /越界/.test(i.message))).toBe(true)
  })

  it('非有限值 → 警告', () => {
    const per: RawEffectProbe[] = [{ id: 'a', runA: [{ dy: Infinity }], runB: [{ dy: Infinity }] }]
    const r = analyzeProbe(per)
    expect(r.issues.some((i) => i.level === 'warn' && /非有限/.test(i.message))).toBe(true)
  })

  it('无特效 → 警告但通过', () => {
    const r = analyzeProbe([])
    expect(r.ok).toBe(true)
    expect(r.issues.some((i) => i.level === 'warn')).toBe(true)
  })
})

describe('probePluginInWorker（无 Worker 环境）', () => {
  it('node/vitest 下抛 SandboxUnavailableError（调用方据此降级）', async () => {
    await expect(probePluginInWorker('export default { api:1, name:"x" }')).rejects.toBeInstanceOf(
      SandboxUnavailableError
    )
  })
})
