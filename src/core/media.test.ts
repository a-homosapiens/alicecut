import { describe, expect, it } from 'vitest'
import {
  clipEnd,
  clipSourceTime,
  clipsDuration,
  normalizeLoop,
  shiftClip,
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
    loop: 1,
    ...over
  }
}

describe('normalizeLoop', () => {
  it('保留 infinite，数字取整且至少 1', () => {
    expect(normalizeLoop('infinite')).toBe('infinite')
    expect(normalizeLoop(3)).toBe(3)
    expect(normalizeLoop(2.9)).toBe(2)
    expect(normalizeLoop(0)).toBe(1)
    expect(normalizeLoop(-5)).toBe(1)
    expect(normalizeLoop('abc')).toBe(1)
    expect(normalizeLoop(undefined)).toBe(1)
  })
})

describe('clipEnd', () => {
  it('有限循环 = start + 时长×次数', () => {
    expect(clipEnd(clip(), 0)).toBe(5000)
    expect(clipEnd(clip({ loop: 3 }), 0)).toBe(13000)
  })
  it('无限循环到项目结束', () => {
    expect(clipEnd(clip({ loop: 'infinite' }), 60000)).toBe(60000)
    // 项目比线段起点还短时不为负
    expect(clipEnd(clip({ loop: 'infinite' }), 500)).toBe(1000)
  })
})

describe('clipSourceTime', () => {
  it('范围内返回源时间，循环取模', () => {
    expect(clipSourceTime(clip({ loop: 2 }), 1000, 0)).toBe(0)
    expect(clipSourceTime(clip({ loop: 2 }), 2500, 0)).toBe(1500)
    expect(clipSourceTime(clip({ loop: 2 }), 5000, 0)).toBe(0) // 进入第二遍
    expect(clipSourceTime(clip({ loop: 2 }), 8999, 0)).toBe(3999)
  })
  it('范围外返回 null', () => {
    expect(clipSourceTime(clip(), 999, 0)).toBeNull()
    expect(clipSourceTime(clip(), 5000, 0)).toBeNull()
  })
  it('无限循环只受项目结束约束', () => {
    expect(clipSourceTime(clip({ loop: 'infinite' }), 9000, 60000)).toBe(0)
    expect(clipSourceTime(clip({ loop: 'infinite' }), 61000, 60000)).toBeNull()
  })
  it('时长为 0 的素材不可见', () => {
    expect(clipSourceTime(clip({ sourceDuration: 0 }), 1000, 0)).toBeNull()
  })
})

describe('clipsDuration', () => {
  it('取有限线段的最晚结束，忽略无限循环', () => {
    expect(
      clipsDuration([
        clip({ start: 0, loop: 2 }), // 8000
        clip({ start: 10000, loop: 1 }), // 14000
        clip({ start: 0, loop: 'infinite' })
      ])
    ).toBe(14000)
    expect(clipsDuration([clip({ loop: 'infinite' })])).toBe(0)
    expect(clipsDuration([])).toBe(0)
  })
})

describe('shiftClip', () => {
  it('平移并钳制在 0', () => {
    expect(shiftClip(clip(), 500).start).toBe(1500)
    expect(shiftClip(clip(), -5000).start).toBe(0)
    const c = clip()
    expect(shiftClip(c, 0)).toBe(c)
  })
})
