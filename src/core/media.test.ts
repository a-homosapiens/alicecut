import { describe, expect, it } from 'vitest'
import {
  clipEnd,
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
    ...over
  }
}

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
