import { describe, expect, it } from 'vitest'
import type { LrcLine, LrcMeta, LrcWord } from './types'
import { renderFrame, renderFingerprint, getLineBlockRect, resolveEffectTiming, type RenderStyle } from './render'

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
  lineJoin = ''
  miterLimit = 0
  lineWidth = 0
  roundRects: { x: number; y: number; w: number; h: number }[] = []
  fillTextCount = 0
  strokeTextCount = 0
  fillRectCount = 0
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
  fillRect(): void {
    this.fillRectCount++
  }
  strokeRect(): void {}
  fillText(): void {
    this.fillTextCount++
  }
  strokeText(): void {
    this.strokeTextCount++
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
  letterSpacing: 4,
  wordSpacing: 12,
  lineSpacing: 1,
  textAlign: 'center',
  textOrientation: 'horizontal',
  strokeColor: '#000000',
  strokeWidth: 0,
  strokeAlpha: 1,
  glowColor: '#7dd3fc',
  bgType: 'solid',
  bgFrom: '#000000',
  bgTo: '#000000',
  bgAngle: 0,
  bgImage: null,
  bgImageScale: 1,
  bgImageX: 0,
  bgImageY: 0,
  bgImageRotate: 0,
  effectId: 'highlightBox',
  effectInDurationMs: 480,
  effectOutDurationMs: 320,
  intensity: 1,
  riseHistory: 3,
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

describe('caption effect timing', () => {
  it('keeps both windows inside the segment and gives In priority for invalid saved data', () => {
    const short = { ...line, end: 1000, effectInDurationMs: 800, effectOutDurationMs: 700 }
    expect(resolveEffectTiming(short, baseStyle)).toEqual({ inMs: 800, outMs: 200, outStartMs: 800 })
  })

  it('uses the remaining segment tail as the Out window', () => {
    const timed = { ...line, end: 2000, effectInDurationMs: 450, effectOutDurationMs: 600 }
    expect(resolveEffectTiming(timed, baseStyle)).toEqual({ inMs: 450, outMs: 600, outStartMs: 1400 })
  })

  it('keeps an explicit None effect fully visible through both In and Out windows', () => {
    const noEffect = { ...line, effectId: 'none', effectOutId: 'none', effectInDurationMs: 1000, effectOutDurationMs: 1000 }
    expect(render(1, baseStyle, [noEffect]).fillTextCount).toBe([...line.text].length)
    expect(render(line.end - 1, baseStyle, [noEffect]).fillTextCount).toBe([...line.text].length)
  })
})

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

describe('transparent overlay rendering', () => {
  it('skipBackground draws text without painting the background or backdrop', () => {
    const ctx = new MockCtx()
    let backdropCalls = 0
    renderFrame(
      ctx as unknown as CanvasRenderingContext2D,
      [line],
      meta,
      { ...baseStyle, effectId: 'pop' },
      900,
      () => { backdropCalls++ },
      { skipBackground: true }
    )
    expect(ctx.fillRectCount).toBe(0)
    expect(backdropCalls).toBe(0)
    expect(ctx.fillTextCount).toBeGreaterThan(0)
  })
})

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

describe('多字幕组（trackId 分流渲染）', () => {
  const trackA = oneWordLine('甲', 3000) // trackId 缺省 = 0（主字幕组）
  const trackB: LrcLine = { ...oneWordLine('乙', 3000), id: 1, trackId: 2 } // 额外字幕组 id 2

  it('两个字幕组的 highlightBox 各自独立判定当前行，互不影响', () => {
    const ctx = new MockCtx()
    renderFrame(ctx as unknown as CanvasRenderingContext2D, [trackA, trackB], meta, baseStyle, 900, undefined, {
      tracks: [
        { id: 0, offsetY: 0, visible: true },
        { id: 2, offsetY: 300, visible: true }
      ]
    })
    // 两组各画一个跳动高亮块（highlightBox 特效的圆角矩形就是高亮块本身）
    expect(ctx.roundRects.length).toBe(2)
  })

  it('visible: false 的字幕组不绘制', () => {
    const ctx = new MockCtx()
    renderFrame(ctx as unknown as CanvasRenderingContext2D, [trackA, trackB], meta, baseStyle, 900, undefined, {
      tracks: [
        { id: 0, offsetY: 0, visible: true },
        { id: 2, offsetY: 300, visible: false }
      ]
    })
    expect(ctx.roundRects.length).toBe(1)
  })

  it('省略 opts.tracks 时仍按发现的 trackId 各自绘制，不会因为不认识 trackId 而丢内容', () => {
    const ctx = render(900, baseStyle, [trackA, trackB])
    expect(ctx.roundRects.length).toBe(2)
  })

  it('单字幕组（无 trackId）渲染结果与不传 opts 完全一致——多字幕组分流不改变既有行为', () => {
    const a = render(900, baseStyle, [line]).fillTextCount
    const ctx = new MockCtx()
    renderFrame(ctx as unknown as CanvasRenderingContext2D, [line], meta, baseStyle, 900, undefined, {
      tracks: [{ id: 0, offsetY: 0, visible: true }]
    })
    expect(ctx.fillTextCount).toBe(a)
  })
})

describe('renderFingerprint 帧指纹（导出跳过重复帧）', () => {
  const fp = (tMs: number, style: RenderStyle, lines = [line]): string => {
    const ctx = new MockCtx()
    return renderFingerprint(ctx as unknown as CanvasRenderingContext2D, lines, meta, style, tMs)
  }

  it('静止段落指纹相同：pop 全部进场完成后（退场前）', () => {
    const style = { ...baseStyle, effectId: 'pop' }
    // 入场在前 480ms 内完成；Out 窗口从 3180ms 开始。
    expect(fp(3000, style)).toBe(fp(3100, style))
  })

  it('进场动画期间指纹不同', () => {
    const style = { ...baseStyle, effectId: 'pop' }
    expect(fp(100, style)).not.toBe(fp(150, style))
  })

  it('退场期间指纹不同', () => {
    const style = { ...baseStyle, effectId: 'pop' }
    expect(fp(3250, style)).not.toBe(fp(3300, style))
  })

  it('uses the configured Out duration inside the segment', () => {
    const style = { ...baseStyle, effectId: 'pop' }
    const withLongOut = [{ ...line, effectOutId: 'evaporate-out', effectOutDurationMs: 700 }]
    expect(fp(3000, style, withLongOut)).not.toBe(fp(3300, style, withLongOut))
    expect(fp(3500, style, withLongOut)).toBe(fp(4000, style, withLongOut))
  })

  it('plays an explicit Out even when the In effect is a parking transition', () => {
    const style = { ...baseStyle, effectId: 'rise' }
    const lines = [{ ...line, effectId: 'rise', effectOutId: 'evaporate-out', effectOutDurationMs: 500 }]
    expect(fp(3250, style, lines)).toContain('evaporate-out')
  })

  it('持续动画特效（wobble 噪声漂移）指纹每帧不同', () => {
    const style = { ...baseStyle, effectId: 'wobble' }
    expect(fp(3000, style)).not.toBe(fp(3033, style))
  })

  it('持续动画特效（glow 辉光脉冲）指纹每帧不同', () => {
    const style = { ...baseStyle, effectId: 'glow' }
    expect(fp(3000, style)).not.toBe(fp(3033, style))
  })

  it('卡拉OK：同一词的稳定高亮区间内指纹相同，跨词推进时不同', () => {
    const style = { ...baseStyle, effectId: 'karaoke' }
    // 词1 = [1000,2000)：1500/1533 都在其稳定高亮区（RAMP=90 已过）
    expect(fp(1500, style)).toBe(fp(1533, style))
    // 1950 → 2050 跨过词1/词2 边界（高亮淡出+淡入）
    expect(fp(1950, style)).not.toBe(fp(2050, style))
  })

  it('打字机光标：同一闪烁相位内指纹相同，相位翻转后不同', () => {
    const style = { ...baseStyle, effectId: 'typewriter' }
    // In 已完成且尚未进入 Out；700/750 在同一闪烁相位，500/700 跨相位。
    expect(fp(700, style)).toBe(fp(750, style))
    expect(fp(500, style)).not.toBe(fp(700, style))
  })

  it('行结束后的空档期指纹相同', () => {
    const style = { ...baseStyle, effectId: 'pop' }
    // Out 在 3500ms 的 segment end 前完成，之后画面为空。
    expect(fp(4000, style)).toBe(fp(4500, style))
  })

  it('无歌词行时指纹恒为空串', () => {
    expect(fp(0, baseStyle, [])).toBe('')
    expect(fp(1000, baseStyle, [])).toBe('')
  })

  it('停靠式转场（rise）：进场完成后指纹相同，进场期间不同', () => {
    const style = { ...baseStyle, effectId: 'rise' }
    // enterDuration 480ms：600/700 已完成（eased 恒 1），100/200 进行中
    expect(fp(600, style)).toBe(fp(700, style))
    expect(fp(100, style)).not.toBe(fp(200, style))
  })
})

describe('getLineBlockRect 的字幕组纵向偏移', () => {
  it('trackOffsetY 参数原样叠加到返回的 y 上，不影响 x/w/h', () => {
    const ctx = new MockCtx()
    const r0 = getLineBlockRect(ctx as unknown as CanvasRenderingContext2D, line, baseStyle)
    const r1 = getLineBlockRect(ctx as unknown as CanvasRenderingContext2D, line, baseStyle, 250)
    expect(r0).not.toBeNull()
    expect(r1).toEqual({ ...r0, y: r0!.y + 250 })
  })
})
