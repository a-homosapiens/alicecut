import { describe, expect, it } from 'vitest'
import type { LrcLine, LrcMeta, LrcWord } from './types'
import { renderFrame, type RenderStyle } from './render'

/** 记录 roundRect 调用的最小 Canvas 2D mock（高亮块就是唯一的圆角矩形来源） */
class MockCtx {
  font = '16px sans'
  fillStyle = ''
  strokeStyle = ''
  globalAlpha = 1
  textAlign = ''
  textBaseline = ''
  filter = 'none'
  shadowColor = ''
  shadowBlur = 0
  shadowOffsetX = 0
  shadowOffsetY = 0
  roundRects: { x: number; y: number; w: number; h: number }[] = []
  fillTextCount = 0
  transformCount = 0
  clipCount = 0
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  transform(): void {
    this.transformCount++
  }
  beginPath(): void {}
  rect(): void {}
  arc(): void {}
  moveTo(): void {}
  closePath(): void {}
  clip(): void {
    this.clipCount++
  }
  fill(): void {}
  stroke(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  fillText(): void {
    this.fillTextCount++
  }
  measureText(t: string): { width: number } {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 16)
    return { width: [...t].length * px * 0.6 }
  }
  createLinearGradient(): { addColorStop(): void } {
    return { addColorStop(): void {} }
  }
  roundRect(x: number, y: number, w: number, h: number): void {
    this.roundRects.push({ x, y, w, h })
  }
}

const mkWord = (text: string, start: number, end: number): LrcWord => ({
  text,
  start,
  end,
  chars: [...text].map((c, i, arr) => ({
    text: c,
    start: Math.round(start + ((end - start) * i) / arr.length),
    end: Math.round(start + ((end - start) * (i + 1)) / arr.length)
  }))
})

const meta: LrcMeta = { offset: 0 }
const line: LrcLine = {
  id: 0,
  start: 0,
  end: 3500,
  text: 'AABBCC',
  words: [mkWord('AA', 0, 1000), mkWord('BB', 1000, 2000), mkWord('CC', 2000, 3000)],
  effectId: null,
  dx: 0,
  dy: 0
}

const baseStyle: RenderStyle = {
  width: 1080,
  height: 1920,
  fontFamily: 'sans',
  fontWeight: 700,
  fontSize: 80,
  textColor: '#ffffff',
  glowColor: '#7dd3fc',
  bgType: 'solid',
  bgFrom: '#000000',
  bgTo: '#000000',
  bgAngle: 0,
  bgImage: null,
  bgImageScale: 1,
  bgImageX: 0,
  bgImageY: 0,
  effectId: 'highlightBox',
  intensity: 1,
  showMeta: false,
  globalDx: 0,
  globalDy: 0,
  globalRotate: 0,
  highlightColor: '#ffd400',
  textAlpha: 1,
  italic: false,
  textBgColor: '#000000',
  textBgAlpha: 0,
  halo: 0,
  shadowColor: '#000000',
  shadowAlpha: 0,
  shadowBlur: 8,
  shadowOffset: 4
}

/** 渲染一帧，返回高亮块中心 x（无块时返回 null） */
function boxCenterX(tMs: number, style: RenderStyle): number | null {
  const ctx = new MockCtx()
  renderFrame(ctx as unknown as CanvasRenderingContext2D, [line], meta, style, tMs)
  const box = ctx.roundRects[0]
  return box ? box.x + box.w / 2 : null
}

/** 渲染一帧，返回记录用的 mock 上下文 */
function render(tMs: number, style: RenderStyle, lines = [line]): MockCtx {
  const ctx = new MockCtx()
  renderFrame(ctx as unknown as CanvasRenderingContext2D, lines, meta, style, tMs)
  return ctx
}

const oneWordLine = (text: string, end: number): LrcLine => ({
  id: 0,
  start: 0,
  end,
  text,
  words: [mkWord(text, 0, end)],
  effectId: null,
  dx: 0,
  dy: 0
})

describe('highlightBox 跳动高亮块', () => {
  it('当前词背后画出高亮块', () => {
    expect(boxCenterX(900, baseStyle)).not.toBeNull()
  })

  it('高亮块随当前词推进向右跳（逐词移动）', () => {
    const c0 = boxCenterX(900, baseStyle)! // 词0 已停靠
    const c1 = boxCenterX(1030, baseStyle)! // 跳向词1 途中
    const c2 = boxCenterX(2900, baseStyle)! // 停靠词2
    expect(c0).toBeLessThan(c1)
    expect(c1).toBeLessThan(c2)
  })

  it('换用普通特效时不画高亮块', () => {
    expect(boxCenterX(900, { ...baseStyle, effectId: 'pop' })).toBeNull()
  })
})

describe('streak 运动残影', () => {
  const lines = [oneWordLine('AB', 3000)] // 两个字符
  const style = { ...baseStyle, effectId: 'streak' }

  it('入场运动期间拖出残影（额外重绘）', () => {
    // t=100：字符0 正从右滑入，应画出主体 + 多枚残影 → fillText 远多于字符数
    expect(render(100, style, lines).fillTextCount).toBeGreaterThan(2)
  })

  it('静止后不画残影（仅主体）', () => {
    // t=2500：两字符均已归位，无位移 → 每字符仅一次
    expect(render(2500, style, lines).fillTextCount).toBe(2)
  })
})

describe('wobble 错切（skew）', () => {
  const lines = [oneWordLine('ABCDEF', 3000)]

  it('飘摆特效会施加错切变换', () => {
    expect(render(500, { ...baseStyle, effectId: 'wobble' }, lines).transformCount).toBeGreaterThan(0)
  })

  it('普通特效不施加错切变换', () => {
    expect(render(500, { ...baseStyle, effectId: 'pop' }, lines).transformCount).toBe(0)
  })
})

describe('遮罩式入场转场（reveal）', () => {
  const lines = [oneWordLine('AB', 3000)]

  for (const effectId of ['wipe', 'iris', 'clockWipe'] as const) {
    it(`${effectId} 入场期间用裁剪揭示`, () => {
      // 入场途中（enterDuration≈520ms，t=200 → 进度<1）应有裁剪且画出文字
      const ctx = render(200, { ...baseStyle, effectId }, lines)
      expect(ctx.clipCount).toBeGreaterThan(0)
      expect(ctx.fillTextCount).toBeGreaterThan(0)
    })
  }

  it('揭示完成后不再裁剪（回退常规绘制）', () => {
    const ctx = render(1500, { ...baseStyle, effectId: 'wipe' }, lines)
    expect(ctx.clipCount).toBe(0)
    expect(ctx.fillTextCount).toBeGreaterThan(0)
  })

  it('普通特效不裁剪', () => {
    expect(render(200, { ...baseStyle, effectId: 'pop' }, lines).clipCount).toBe(0)
  })
})
