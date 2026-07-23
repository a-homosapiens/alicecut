import { describe, expect, it } from 'vitest'
import { flip, flipBottom } from './flip'
import { rise } from './rise'

// blocks[0] 当前行包围盒，blocks[d] 第 d 条停靠旧行
const blocks = [
  { w: 600, h: 120 },
  { w: 500, h: 120 },
  { w: 700, h: 240 },
  { w: 400, h: 120 },
  { w: 400, h: 120 }
]
const args = { width: 1080, height: 1920, fontSize: 88, intensity: 1, blocks }

describe('翻转切换 flip（停靠式）', () => {
  const trans = flip.lineTransition!

  it('当前行姿态为恒等（居中无变换）', () => {
    const p0 = trans.pose(0, { ...args, lineId: 4 })
    expect(p0).toMatchObject({ dx: 0, dy: 0, rotate: 0, scale: 1, alpha: 1 })
  })

  it('停靠的旧行：翻转 90°、缩小、立在当前行块外侧且不消失', () => {
    const p1 = trans.pose(1, { ...args, lineId: 3 })
    expect(Math.abs(p1.rotate)).toBeCloseTo(Math.PI / 2, 5)
    expect(p1.scale).toBeLessThan(1)
    expect(p1.alpha).toBeGreaterThan(0.5)
    // 紧靠：水平偏移超过当前行半宽，但没飞出画面
    expect(Math.abs(p1.dx)).toBeGreaterThan(blocks[0].w / 2)
    expect(Math.abs(p1.dx)).toBeLessThan(args.width)
  })

  it('停靠侧左右交替', () => {
    const a = trans.pose(1, { ...args, lineId: 2 })
    const b = trans.pose(1, { ...args, lineId: 3 })
    expect(Math.sign(a.dx)).toBe(-Math.sign(b.dx))
  })

  it('新行进场起始旋转与旧行停靠旋转同向（连续翻转）', () => {
    for (let id = 1; id <= 6; id++) {
      const enter = trans.enterFrom({ ...args, lineId: id })
      const parked = trans.pose(1, { ...args, lineId: id - 1 })
      // 新行从 -dir·90° 转回 0，旧行从 0 转到 +dir·90°：符号相反即同向
      expect(Math.sign(enter.rotate)).toBe(-Math.sign(parked.rotate))
      expect(enter.alpha).toBe(0)
    }
  })

  it('超过保留深度的旧行淡出', () => {
    expect(trans.pose(2, { ...args, lineId: 1 }).alpha).toBe(0)
  })
})

describe('翻转·底对齐 flip-bottom', () => {
  const trans = flipBottom.lineTransition!

  it('停靠竖排块的下边缘与新字幕块的下边缘对齐', () => {
    const p1 = trans.pose(1, { ...args, lineId: 3 })
    // 竖排后块的垂直高度 = 原块宽度 × 缩放，底边 = dy + 高度/2
    const parkedBottom = p1.dy + (blocks[1].w * p1.scale) / 2
    const currentBottom = blocks[0].h / 2
    expect(parkedBottom).toBeCloseTo(currentBottom, 5)
  })

  it('旧字幕较长时向上延伸（中心高于新字幕中心）', () => {
    const p1 = trans.pose(1, { ...args, lineId: 3 })
    // blocks[1].w·s = 500·0.6 = 300 > 新行块高 120，必然向上伸出
    expect(p1.dy).toBeLessThan(0)
  })

  it('其余行为与居中版一致（侧边停靠、旋转 90°、左右交替）', () => {
    const a = flipBottom.lineTransition!.pose(1, { ...args, lineId: 2 })
    const b = flip.lineTransition!.pose(1, { ...args, lineId: 2 })
    expect(a.dx).toBeCloseTo(b.dx, 5)
    expect(a.rotate).toBeCloseTo(b.rotate, 5)
    expect(a.scale).toBeCloseTo(b.scale, 5)
  })
})

describe('上移切换 rise（停靠式）', () => {
  const trans = rise.lineTransition!

  it('当前行居中，旧行紧靠上方堆叠且不消失', () => {
    const p0 = trans.pose(0, { ...args, lineId: 4 })
    expect(p0).toMatchObject({ dy: 0, scale: 1, alpha: 1 })

    const p1 = trans.pose(1, { ...args, lineId: 3 })
    // 在当前行上方（负 dy 超过当前行半高），缩放后仍可见
    expect(p1.dy).toBeLessThan(-blocks[0].h / 2)
    expect(p1.scale).toBeLessThan(1)
    expect(p1.alpha).toBeGreaterThan(0.5)
  })

  it('深度越大越靠上，且按各行实际块高紧凑排布（无重叠）', () => {
    let prevTop = blocks[0].h / 2 // 当前行块顶边以下为占用区
    for (let d = 1; d <= 3; d++) {
      const p = trans.pose(d, { ...args, lineId: 4 - d })
      const half = (blocks[d].h * p.scale) / 2
      // 本行块底边在上一行占用区之上
      expect(p.dy + half).toBeLessThanOrEqual(-prevTop + 1e-6)
      prevTop = -(p.dy - half)
    }
  })

  it('透明度随深度递减，并为可配置的更长历史保留可见姿态', () => {
    const alphas = [1, 2, 3, 4, 5, 6].map((d) => trans.pose(d, { ...args, lineId: 0 }).alpha)
    expect(alphas[0]).toBeGreaterThan(alphas[1])
    expect(alphas[1]).toBeGreaterThan(alphas[2])
    expect(alphas[2]).toBeGreaterThan(alphas[3])
    expect(alphas[5]).toBeGreaterThan(0)
  })

  it('新行从下方缩小渐显进场', () => {
    const e = trans.enterFrom({ ...args, lineId: 5 })
    expect(e.dy).toBeGreaterThan(0)
    expect(e.scale).toBeLessThan(1)
    expect(e.alpha).toBe(0)
  })

  it('强度可以让停靠的旧字幕比新字幕更大', () => {
    const big = trans.pose(1, { ...args, intensity: 2, lineId: 3 })
    expect(big.scale).toBeGreaterThan(1)
  })
})
