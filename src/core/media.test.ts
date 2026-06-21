import { describe, expect, it } from 'vitest'
import {
  clipEnd,
  clipGain,
  clipTransition,
  clipSegmentMs,
  clipSourceTime,
  clipsDuration,
  explodeLoops,
  normalizeLoop,
  shiftClip,
  splitClipAt,
  withClipDefaults,
  type MediaClip
} from './media'

function clip(over: Partial<MediaClip> = {}): MediaClip {
  return {
    id: 1,
    kind: 'video',
    path: 'C:/x.mp4',
    name: 'x.mp4',
    start: 1000,
    sourceDuration: 4000,
    sourceIn: 0,
    sourceOut: 4000,
    speed: 1,
    loop: 1,
    layer: 0,
    tx: 0,
    ty: 0,
    scale: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    ...over
  }
}

describe('clipGain 淡入/淡出', () => {
  // start 1000, seg 4000, loop 1 → end 5000
  it('无淡入淡出恒为 1', () => {
    const c = clip({ kind: 'audio' })
    expect(clipGain(c, 3000, 99999)).toBe(1)
  })

  it('淡入：起点 0 → 满增益线性上升', () => {
    const c = clip({ kind: 'audio', fadeInMs: 1000 })
    expect(clipGain(c, 1000, 99999)).toBe(0)
    expect(clipGain(c, 1500, 99999)).toBeCloseTo(0.5, 5)
    expect(clipGain(c, 2000, 99999)).toBe(1)
    expect(clipGain(c, 3000, 99999)).toBe(1)
  })

  it('淡出：到结束处线性下降', () => {
    const c = clip({ kind: 'audio', fadeOutMs: 1000 })
    expect(clipGain(c, 4000, 99999)).toBe(1)
    expect(clipGain(c, 4500, 99999)).toBeCloseTo(0.5, 5)
    expect(clipGain(c, 4999, 99999)).toBeCloseTo(0.001, 3)
  })

  it('淡入淡出并存时取较小者', () => {
    const c = clip({ kind: 'audio', fadeInMs: 1000, fadeOutMs: 1000 })
    expect(clipGain(c, 1500, 99999)).toBeCloseTo(0.5, 5) // 受淡入限制
    expect(clipGain(c, 4500, 99999)).toBeCloseTo(0.5, 5) // 受淡出限制
    expect(clipGain(c, 2500, 99999)).toBe(1)
  })

  it('线段外返回 1（不改音量）', () => {
    const c = clip({ kind: 'audio', fadeInMs: 1000, fadeOutMs: 1000 })
    expect(clipGain(c, 500, 99999)).toBe(1)
    expect(clipGain(c, 5000, 99999)).toBe(1)
  })

  it('无限循环淡出锚定到项目结束', () => {
    const c = clip({ kind: 'audio', loop: 'infinite', fadeOutMs: 1000 })
    // 项目结束 8000 → 淡出窗口 [7000, 8000]
    expect(clipGain(c, 7500, 8000)).toBeCloseTo(0.5, 5)
    expect(clipGain(c, 3000, 8000)).toBe(1)
  })
})

describe('withClipDefaults 淡入淡出', () => {
  it('补默认 0 并钳到线段占用时长内', () => {
    const c = withClipDefaults({ kind: 'audio', path: 'a.mp3', name: 'a', start: 0, sourceDuration: 4000 })
    expect(c.fadeInMs).toBe(0)
    expect(c.fadeOutMs).toBe(0)
    // seg 4000, loop 1 → 占用 4000ms；超额淡入被钳
    const big = withClipDefaults({
      kind: 'audio',
      path: 'a.mp3',
      name: 'a',
      start: 0,
      sourceDuration: 4000,
      fadeInMs: 99999
    })
    expect(big.fadeInMs).toBe(4000)
  })
})

describe('clipTransition 视频转场', () => {
  // start 1000, seg 4000, loop 1 → end 5000
  it('无转场恒等', () => {
    const fx = clipTransition(clip(), 3000, 99999)
    expect(fx).toEqual({ alpha: 1, dxFrac: 0, dyFrac: 0, scale: 1, wipe: null })
  })

  it('fade 进场：起点 alpha 0，窗口外 alpha 1', () => {
    const c = clip({ transIn: { type: 'fade', durationMs: 1000 } })
    expect(clipTransition(c, 1000, 99999).alpha).toBe(0)
    expect(clipTransition(c, 1500, 99999).alpha).toBeGreaterThan(0)
    expect(clipTransition(c, 1500, 99999).alpha).toBeLessThan(1)
    expect(clipTransition(c, 2500, 99999).alpha).toBe(1) // 进场窗口外
  })

  it('fade 退场：结束前 alpha 衰减到 0', () => {
    const c = clip({ transOut: { type: 'fade', durationMs: 1000 } })
    expect(clipTransition(c, 3500, 99999).alpha).toBe(1) // 退场窗口外
    expect(clipTransition(c, 4500, 99999).alpha).toBeLessThan(1)
    expect(clipTransition(c, 4990, 99999).alpha).toBeLessThan(0.1)
  })

  it('slide 进场：起点有方向位移，到位后归零', () => {
    const c = clip({ transIn: { type: 'slideL', durationMs: 1000 } })
    expect(clipTransition(c, 1000, 99999).dxFrac).toBe(-1)
    expect(clipTransition(c, 2500, 99999).dxFrac).toBe(0)
  })

  it('zoom 进场：放大 + 淡入', () => {
    const c = clip({ transIn: { type: 'zoom', durationMs: 1000 } })
    const fx = clipTransition(c, 1000, 99999)
    expect(fx.scale).toBeCloseTo(1.3, 5)
    expect(fx.alpha).toBe(0)
  })

  it('wipe 进场：揭示比例随进度增加', () => {
    const c = clip({ transIn: { type: 'wipeL', durationMs: 1000 } })
    const fx = clipTransition(c, 1300, 99999)
    expect(fx.wipe).not.toBeNull()
    expect(fx.wipe!.dir).toBe('L')
    expect(fx.wipe!.reveal).toBeGreaterThan(0)
    expect(fx.wipe!.reveal).toBeLessThan(1)
  })

  it('线段外恒等', () => {
    const c = clip({ transIn: { type: 'fade', durationMs: 1000 } })
    expect(clipTransition(c, 500, 99999).alpha).toBe(1)
    expect(clipTransition(c, 6000, 99999).alpha).toBe(1)
  })
})

describe('withClipDefaults 视频转场规范化', () => {
  const mk = (over: Record<string, unknown>): ReturnType<typeof withClipDefaults> =>
    withClipDefaults({ kind: 'video', path: 'v.mp4', name: 'v', start: 0, sourceDuration: 4000, ...over })

  it('合法转场保留', () => {
    expect(mk({ transIn: { type: 'wipeR', durationMs: 800 } }).transIn).toEqual({ type: 'wipeR', durationMs: 800 })
  })
  it('未知类型或非正时长 → null', () => {
    expect(mk({ transIn: { type: 'bogus', durationMs: 500 } }).transIn).toBeNull()
    expect(mk({ transOut: { type: 'fade', durationMs: 0 } }).transOut).toBeNull()
  })
  it('缺省为 null', () => {
    const c = mk({})
    expect(c.transIn).toBeNull()
    expect(c.transOut).toBeNull()
  })
})

describe('normalizeLoop', () => {
  it('保留 infinite，数字取整且至少 1', () => {
    expect(normalizeLoop('infinite')).toBe('infinite')
    expect(normalizeLoop(3)).toBe(3)
    expect(normalizeLoop(2.9)).toBe(2)
    expect(normalizeLoop(0)).toBe(1)
    expect(normalizeLoop('abc')).toBe(1)
  })
})

describe('withClipDefaults', () => {
  it('旧数据补默认值', () => {
    const c = withClipDefaults({
      kind: 'audio',
      path: 'a.mp3',
      name: 'a',
      start: 100,
      sourceDuration: 5000
    })
    expect(c.sourceIn).toBe(0)
    expect(c.sourceOut).toBe(5000)
    expect(c.speed).toBe(1)
    expect(c.layer).toBe(0)
    expect(c.scale).toBe(1)
  })
  it('speed 钳制到 0.25–4', () => {
    expect(withClipDefaults({ ...clip(), speed: 10 }).speed).toBe(4)
    expect(withClipDefaults({ ...clip(), speed: 0.1 }).speed).toBe(0.25)
    expect(withClipDefaults({ ...clip(), speed: NaN }).speed).toBe(1)
  })
})

describe('clipEnd / clipSegmentMs', () => {
  it('有限循环 = start + 修剪区间/速度 × 次数', () => {
    expect(clipEnd(clip(), 0)).toBe(5000)
    expect(clipEnd(clip({ loop: 3 }), 0)).toBe(13000)
    expect(clipEnd(clip({ speed: 2 }), 0)).toBe(3000) // 4s 素材 2 倍速 = 2s
    expect(clipEnd(clip({ sourceIn: 1000, sourceOut: 3000 }), 0)).toBe(3000)
  })
  it('无限循环到项目结束', () => {
    expect(clipEnd(clip({ loop: 'infinite' }), 60000)).toBe(60000)
    expect(clipEnd(clip({ loop: 'infinite' }), 500)).toBe(1000)
  })
  it('segment 长度', () => {
    expect(clipSegmentMs(clip())).toBe(4000)
    expect(clipSegmentMs(clip({ speed: 0.5 }))).toBe(8000)
  })
})

describe('clipSourceTime', () => {
  it('范围内返回源时间，循环取模', () => {
    expect(clipSourceTime(clip({ loop: 2 }), 1000, 0)).toBe(0)
    expect(clipSourceTime(clip({ loop: 2 }), 2500, 0)).toBe(1500)
    expect(clipSourceTime(clip({ loop: 2 }), 5000, 0)).toBe(0)
  })
  it('修剪与变速', () => {
    const c = clip({ sourceIn: 1000, sourceOut: 3000, speed: 2 }) // 时间轴 1s 长
    expect(clipSourceTime(c, 1000, 0)).toBe(1000)
    expect(clipSourceTime(c, 1500, 0)).toBe(2000) // 0.5s × 2 倍速 = 源 1s 处
    expect(clipSourceTime(c, 2000, 0)).toBeNull() // 已结束
  })
  it('范围外返回 null', () => {
    expect(clipSourceTime(clip(), 999, 0)).toBeNull()
    expect(clipSourceTime(clip(), 5000, 0)).toBeNull()
  })
  it('无限循环只受项目结束约束', () => {
    expect(clipSourceTime(clip({ loop: 'infinite' }), 9000, 60000)).toBe(0)
    expect(clipSourceTime(clip({ loop: 'infinite' }), 61000, 60000)).toBeNull()
  })
})

describe('clipsDuration', () => {
  it('取有限线段的最晚结束，忽略无限循环', () => {
    expect(
      clipsDuration([
        clip({ start: 0, loop: 2 }),
        clip({ start: 10000, loop: 1 }),
        clip({ start: 0, loop: 'infinite' })
      ])
    ).toBe(14000)
    expect(clipsDuration([])).toBe(0)
  })
})

describe('shiftClip', () => {
  it('平移并钳制在 0', () => {
    expect(shiftClip(clip(), 500).start).toBe(1500)
    expect(shiftClip(clip(), -5000).start).toBe(0)
  })
})

describe('explodeLoops', () => {
  it('loop=1 原样返回', () => {
    expect(explodeLoops(clip(), 0)).toHaveLength(1)
  })
  it('有限循环按圈展开', () => {
    const pieces = explodeLoops(clip({ loop: 3 }), 0)
    expect(pieces.map((p) => p.start)).toEqual([1000, 5000, 9000])
    expect(pieces.every((p) => p.loop === 1)).toBe(true)
  })
  it('无限循环展开到项目结束，末段裁出点', () => {
    const pieces = explodeLoops(clip({ loop: 'infinite' }), 10000)
    expect(pieces.map((p) => p.start)).toEqual([1000, 5000, 9000])
    expect(pieces[2].sourceOut).toBe(1000) // 9s–10s 只放源的前 1s
  })
})

describe('splitClipAt', () => {
  it('单段在中间切成两半', () => {
    const r = splitClipAt(clip(), 2500, 0)!
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ start: 1000, sourceIn: 0, sourceOut: 1500 })
    expect(r[1]).toMatchObject({ start: 2500, sourceIn: 1500, sourceOut: 4000 })
  })
  it('变速线段按源时间换算切点', () => {
    const r = splitClipAt(clip({ speed: 2 }), 2000, 0)! // 时间轴 1 秒处 = 源 2 秒
    expect(r[0].sourceOut).toBe(2000)
    expect(r[1].sourceIn).toBe(2000)
  })
  it('循环线段先展开再切', () => {
    const r = splitClipAt(clip({ loop: 2 }), 6000, 0)! // 第二圈 1 秒处
    expect(r).toHaveLength(3)
    expect(r[0]).toMatchObject({ start: 1000, loop: 1, sourceOut: 4000 })
    expect(r[1]).toMatchObject({ start: 5000, sourceOut: 1000 })
    expect(r[2]).toMatchObject({ start: 6000, sourceIn: 1000 })
  })
  it('切点在外部返回 null', () => {
    expect(splitClipAt(clip(), 1000, 0)).toBeNull()
    expect(splitClipAt(clip(), 5000, 0)).toBeNull()
  })
})
