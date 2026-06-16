import type { LrcLine, LrcMeta } from './types'
import { layoutLine, type PlacedChar } from './layout'
import { getEffect, type EffectPreset, type LineFx } from './effects'
import { seededRand, clamp01, easeOutCubic } from './easing'

export interface RenderStyle {
  width: number
  height: number
  fontFamily: string
  fontWeight: number
  fontSize: number
  textColor: string
  glowColor: string
  bgType: 'solid' | 'gradient'
  bgFrom: string
  bgTo: string
  /** 渐变角度，度 */
  bgAngle: number
  /** 全局默认特效；行可用 line.effectId 覆盖 */
  effectId: string
  intensity: number
  /** 片头显示歌名/歌手 */
  showMeta: boolean
  /** 文字不透明度 0–1 */
  textAlpha: number
  italic: boolean
  /** 文字底色块；不透明度 0 = 无底色 */
  textBgColor: string
  textBgAlpha: number
  /** 常驻光晕强度 px（0 = 关），颜色用 glowColor */
  halo: number
  /** 阴影：不透明度 0 = 关 */
  shadowColor: string
  shadowAlpha: number
  shadowBlur: number
  shadowOffset: number
}

/** 上一行退场的淡出时长 ms（默认退场；停靠式转场有自己的节奏） */
const EXIT_MS = 280

/** 该行实际使用的特效：行级覆盖优先，否则全局默认 */
export function effectFor(line: LrcLine, style: RenderStyle): EffectPreset {
  return getEffect(line.effectId ?? style.effectId)
}

/* ---- 布局缓存：同一行同一样式只排版一次 ---- */
const layoutCache = new Map<string, PlacedChar[]>()

function getLayout(
  ctx: CanvasRenderingContext2D,
  line: LrcLine,
  style: RenderStyle,
  variant: 'center' | 'staggered'
): PlacedChar[] {
  const key = `${line.id}|${line.text}|${variant}|${style.width}x${style.height}|${style.fontSize}|${style.italic ? 'i' : ''}${style.fontWeight} ${style.fontFamily}`
  const hit = layoutCache.get(key)
  if (hit) return hit
  if (layoutCache.size > 300) layoutCache.clear()
  const measure = (text: string, fontSize: number): number => {
    ctx.font = fontStr(style, fontSize)
    return ctx.measureText(text).width
  }
  const placed = layoutLine(line, {
    width: style.width,
    height: style.height,
    fontSize: style.fontSize,
    variant,
    measure
  })
  layoutCache.set(key, placed)
  return placed
}

export function invalidateLayoutCache(): void {
  layoutCache.clear()
}

function quoteFamily(family: string): string {
  return /[\s一-鿿]/.test(family) ? `"${family}"` : family
}

/** 组装 ctx.font 字符串（含斜体/字重） */
function fontStr(style: RenderStyle, fontSize: number): string {
  return `${style.italic ? 'italic ' : ''}${style.fontWeight} ${fontSize}px ${quoteFamily(style.fontFamily)}`
}

/** #rrggbb + alpha → rgba() 字符串（阴影颜色用） */
function hexToRgba(hex: string, alpha: number): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp01(alpha).toFixed(3)})`
}

/** 文字底色块：在整行文字后面垫一个圆角色块（透明度可调） */
function drawTextBg(
  ctx: CanvasRenderingContext2D,
  placed: PlacedChar[],
  style: RenderStyle,
  alpha: number,
  dx: number,
  dy: number
): void {
  if (style.textBgAlpha <= 0.004 || placed.length === 0) return
  const b = measureBlock(placed, style.fontSize)
  const pad = style.fontSize * 0.28
  ctx.save()
  ctx.globalAlpha = clamp01(style.textBgAlpha * alpha)
  ctx.fillStyle = style.textBgColor
  ctx.beginPath()
  ctx.roundRect(b.x + dx - pad, b.y + dy - pad, b.w + pad * 2, b.h + pad * 2, style.fontSize * 0.14)
  ctx.fill()
  ctx.restore()
}

/** 设置投影通道（offset 沿 45° 方向）；返回是否启用 */
function applyShadow(ctx: CanvasRenderingContext2D, style: RenderStyle, alpha: number): boolean {
  if (style.shadowAlpha <= 0.004) return false
  ctx.shadowColor = hexToRgba(style.shadowColor, style.shadowAlpha * alpha)
  ctx.shadowBlur = style.shadowBlur
  ctx.shadowOffsetX = style.shadowOffset
  ctx.shadowOffsetY = style.shadowOffset
  return true
}

/** 设置光晕通道（无偏移的彩色辉光） */
function applyGlow(ctx: CanvasRenderingContext2D, style: RenderStyle, glow: number): void {
  ctx.shadowColor = style.glowColor
  ctx.shadowBlur = glow
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

function drawBackground(ctx: CanvasRenderingContext2D, style: RenderStyle): void {
  if (style.bgType === 'solid') {
    ctx.fillStyle = style.bgFrom
  } else {
    const rad = ((style.bgAngle - 90) * Math.PI) / 180
    const cx = style.width / 2
    const cy = style.height / 2
    const r = Math.sqrt(cx * cx + cy * cy)
    const g = ctx.createLinearGradient(
      cx - Math.cos(rad) * r,
      cy - Math.sin(rad) * r,
      cx + Math.cos(rad) * r,
      cy + Math.sin(rad) * r
    )
    g.addColorStop(0, style.bgFrom)
    g.addColorStop(1, style.bgTo)
    ctx.fillStyle = g
  }
  ctx.fillRect(0, 0, style.width, style.height)
}

function drawMetaIntro(
  ctx: CanvasRenderingContext2D,
  meta: LrcMeta,
  style: RenderStyle,
  tMs: number,
  firstLineStart: number
): void {
  if (!style.showMeta || (!meta.title && !meta.artist)) return
  const fadeIn = clamp01(tMs / 600)
  const fadeOut = clamp01((firstLineStart - tMs) / 500)
  const alpha = Math.min(fadeIn, fadeOut)
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = style.textColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const cx = style.width / 2
  const cy = style.height / 2
  if (meta.title) {
    ctx.font = fontStr(style, style.fontSize * 1.1)
    ctx.fillText(meta.title, cx, cy - style.fontSize * 0.75)
  }
  if (meta.artist) {
    ctx.globalAlpha = alpha * 0.7
    ctx.font = `400 ${style.fontSize * 0.5}px ${quoteFamily(style.fontFamily)}`
    ctx.fillText(meta.artist, cx, cy + style.fontSize * 0.55)
  }
  ctx.restore()
}

function lerpLineFx(a: LineFx, b: LineFx, t: number): LineFx {
  const l = (x: number, y: number): number => x + (y - x) * t
  return {
    dx: l(a.dx, b.dx),
    dy: l(a.dy, b.dy),
    scale: l(a.scale, b.scale),
    rotate: l(a.rotate, b.rotate),
    alpha: l(a.alpha, b.alpha),
    blur: l(a.blur, b.blur)
  }
}

export interface BlockRect {
  x: number
  y: number
  w: number
  h: number
}

/** 整行包围盒（未缩放，画布像素，含行位置偏移） */
function measureBlock(placed: PlacedChar[], fontSize: number): BlockRect {
  if (placed.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of placed) {
    minX = Math.min(minX, p.x - p.w / 2)
    maxX = Math.max(maxX, p.x + p.w / 2)
    minY = Math.min(minY, p.y - p.fontSize * 0.62)
    maxY = Math.max(maxY, p.y + p.fontSize * 0.62)
  }
  return {
    x: minX,
    y: minY,
    w: Math.max(maxX - minX, fontSize * 0.5),
    h: Math.max(maxY - minY, fontSize)
  }
}

/** 选中编辑用：某行文字块在画布上的静止位置（含该行 dx/dy 偏移） */
export function getLineBlockRect(
  ctx: CanvasRenderingContext2D,
  line: LrcLine,
  style: RenderStyle
): BlockRect | null {
  const placed = getLayout(ctx, line, style, effectFor(line, style).layoutVariant)
  if (placed.length === 0) return null
  const b = measureBlock(placed, style.fontSize)
  return { x: b.x + line.dx, y: b.y + line.dy, w: b.w, h: b.h }
}

/** 整行块绘制：绕画面中心做统一变换，再叠加该行的位置偏移 */
function drawBlock(
  ctx: CanvasRenderingContext2D,
  placed: PlacedChar[],
  line: LrcLine,
  style: RenderStyle,
  fx: LineFx
): void {
  const cx = style.width / 2
  const cy = style.height / 2
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.translate(cx + fx.dx + line.dx, cy + fx.dy + line.dy)
  if (fx.rotate !== 0) ctx.rotate(fx.rotate)
  if (fx.scale !== 1) ctx.scale(fx.scale, fx.scale)
  if (fx.blur > 0.3) ctx.filter = `blur(${Math.min(fx.blur, 24)}px)`
  drawTextBg(ctx, placed, style, clamp01(fx.alpha), -cx, -cy)
  ctx.fillStyle = style.textColor
  ctx.globalAlpha = clamp01(fx.alpha * style.textAlpha)
  // 阴影与光晕共用 canvas 的 shadow 通道：都开时先画带投影的一遍，再叠一遍光晕
  const hasShadow = applyShadow(ctx, style, fx.alpha)
  if (!hasShadow && style.halo > 0.5) applyGlow(ctx, style, style.halo)
  for (const p of placed) {
    ctx.font = fontStr(style, p.fontSize)
    ctx.fillText(p.char.text, p.x - cx, p.y - cy)
  }
  if (hasShadow && style.halo > 0.5) {
    applyGlow(ctx, style, style.halo)
    for (const p of placed) {
      ctx.font = fontStr(style, p.fontSize)
      ctx.fillText(p.char.text, p.x - cx, p.y - cy)
    }
  }
  ctx.restore()
}

/**
 * 停靠式行级转场：当前行在中心，旧行按深度停靠（堆叠上方/立在侧边）。
 * 新行进场期间，所有行从上一个停靠位（pose(depth-1)）联动滑到当前停靠位。
 * 绘制过的行索引记入 drawn，避免常规路径重复绘制。
 */
function drawLineStack(
  ctx: CanvasRenderingContext2D,
  effect: EffectPreset,
  lines: LrcLine[],
  style: RenderStyle,
  tMs: number,
  current: number,
  drawn: Set<number>
): void {
  const trans = effect.lineTransition!
  const eased = easeOutCubic(clamp01((tMs - lines[current].start) / effect.enterDuration))

  // 实测各深度行的包围盒，停靠位置据此紧靠排布
  const layouts: PlacedChar[][] = []
  const blocks: { w: number; h: number }[] = []
  for (let d = 0; d <= trans.maxDepth + 1; d++) {
    const i = current - d
    const placed = i >= 0 ? getLayout(ctx, lines[i], style, effect.layoutVariant) : []
    layouts.push(placed)
    const b = measureBlock(placed, style.fontSize)
    blocks.push({ w: b.w, h: b.h })
  }

  // 由深到浅绘制，新行盖在最上层
  for (let d = Math.min(trans.maxDepth + 1, current); d >= 0; d--) {
    const placed = layouts[d]
    drawn.add(current - d)
    if (placed.length === 0) continue
    const line = lines[current - d]
    const args = {
      lineId: line.id,
      width: style.width,
      height: style.height,
      fontSize: style.fontSize,
      intensity: style.intensity,
      blocks
    }
    const target = trans.pose(d, args)
    // 进场前一刻所有行都还在浅一级的停靠位（块序整体后移一位）
    const source =
      d === 0 ? trans.enterFrom(args) : trans.pose(d - 1, { ...args, blocks: blocks.slice(1) })
    const fx = lerpLineFx(source, target, eased)
    if (fx.alpha <= 0.003 || fx.scale <= 0.003) continue
    drawBlock(ctx, placed, line, style, fx)
  }
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  effect: EffectPreset,
  line: LrcLine,
  style: RenderStyle,
  tMs: number,
  lineAlpha: number,
  lineDy: number
): void {
  const placed = getLayout(ctx, line, style, effect.layoutVariant)
  if (placed.length === 0) return
  const rand = seededRand(line.id + 1)
  const unitCount = line.words.length
  const timeInLine = tMs - line.start

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  drawTextBg(ctx, placed, style, lineAlpha, line.dx, line.dy + lineDy)
  ctx.fillStyle = style.textColor

  let lastVisible: PlacedChar | null = null
  for (const p of placed) {
    const unitStart = effect.unit === 'word' ? p.word.start : p.char.start
    if (tMs < unitStart) continue
    const enterT = clamp01((tMs - unitStart) / effect.enterDuration)
    const fx = effect.apply({
      unitIndex: p.unitIndex,
      unitCount,
      charIndexInUnit: p.charIndexInUnit,
      enterT,
      timeInLine,
      lineDuration: line.end - line.start,
      intensity: style.intensity,
      rand
    })
    const alpha = fx.alpha * lineAlpha
    if (alpha <= 0.003 || fx.scale <= 0.003) continue
    lastVisible = p

    ctx.save()
    ctx.translate(p.x + fx.dx + line.dx, p.y + fx.dy + lineDy + line.dy)
    if (p.rotate !== 0 || fx.rotate !== 0) ctx.rotate(p.rotate + fx.rotate)
    if (fx.scale !== 1) ctx.scale(fx.scale, fx.scale)
    ctx.globalAlpha = clamp01(alpha * style.textAlpha)
    if (fx.blur > 0.3) ctx.filter = `blur(${Math.min(fx.blur, 24)}px)`
    ctx.font = fontStr(style, p.fontSize)
    // 特效辉光与常驻光晕取较强者；阴影与光晕共用 shadow 通道，都开时画两遍
    const glow = Math.max(fx.glow > 0.5 ? fx.glow : 0, style.halo)
    const hasShadow = applyShadow(ctx, style, alpha)
    if (!hasShadow && glow > 0.5) applyGlow(ctx, style, glow)
    ctx.fillText(p.char.text, 0, 0)
    if (hasShadow && glow > 0.5) {
      applyGlow(ctx, style, glow)
      ctx.fillText(p.char.text, 0, 0)
    }
    ctx.restore()
  }

  // 打字机光标：跟在最后一个已出现字符后面闪烁
  if (effect.cursor && lineAlpha > 0.5 && lastVisible && tMs < line.end) {
    const blink = (timeInLine / 530) % 2 < 1
    if (blink) {
      const fs = lastVisible.fontSize
      ctx.globalAlpha = 0.85 * lineAlpha * style.textAlpha
      ctx.fillRect(
        lastVisible.x + line.dx + lastVisible.w / 2 + fs * 0.12,
        lastVisible.y + line.dy + lineDy - fs * 0.42,
        fs * 0.07,
        fs * 0.84
      )
    }
  }
  ctx.restore()
}

/** 独立文字块：不参与歌词流，自己的起止区间内独立进退场 */
function drawTextBlock(ctx: CanvasRenderingContext2D, line: LrcLine, style: RenderStyle, tMs: number): void {
  const effect = effectFor(line, style)
  const exitP = tMs >= line.end ? easeOutCubic((tMs - line.end) / EXIT_MS) : 0

  if (!effect.lineTransition) {
    drawLine(ctx, effect, line, style, tMs, 1 - exitP, -exitP * style.fontSize * 0.5)
    return
  }

  // 停靠式特效没有"历史行"语义：作为整块用它的进场姿态演绎 enterFrom → 中心位
  const placed = getLayout(ctx, line, style, effect.layoutVariant)
  if (placed.length === 0) return
  const b = measureBlock(placed, style.fontSize)
  const args = {
    lineId: line.id,
    width: style.width,
    height: style.height,
    fontSize: style.fontSize,
    intensity: style.intensity,
    blocks: [{ w: b.w, h: b.h }]
  }
  const trans = effect.lineTransition
  const eased = easeOutCubic(clamp01((tMs - line.start) / effect.enterDuration))
  const fx = lerpLineFx(trans.enterFrom(args), trans.pose(0, args), eased)
  fx.alpha *= 1 - exitP
  fx.dy -= exitP * style.fontSize * 0.5
  if (fx.alpha <= 0.003 || fx.scale <= 0.003) return
  drawBlock(ctx, placed, line, style, fx)
}

/**
 * 渲染某一时刻的完整画面。纯确定性：同样输入永远画出同一帧，
 * 预览与导出共用。tMs 为项目时间轴毫秒。
 * 每行可有独立特效（line.effectId）与位置偏移（line.dx/dy）。
 * kind='text' 的行是独立文字块，不参与当前行/停靠堆叠逻辑。
 * drawBackdrop：可选的背景视频绘制层（画在纯色/渐变之上、文字之下），
 * 由调用方提供——预览取播放中的帧，导出取精确 seek 后的帧。
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  lines: LrcLine[],
  meta: LrcMeta,
  style: RenderStyle,
  tMs: number,
  drawBackdrop?: (ctx: CanvasRenderingContext2D) => void
): void {
  drawBackground(ctx, style)
  drawBackdrop?.(ctx)
  if (lines.length === 0) return

  const lyric = lines.filter((l) => l.kind !== 'text')

  if (lyric.length > 0) {
    drawMetaIntro(ctx, meta, style, tMs, lyric[0].start)

    // 当前行 = 最后一个已开始的行（lines 按 start 排序）
    let current = -1
    for (let i = 0; i < lyric.length; i++) {
      if (lyric[i].start <= tMs) current = i
      else break
    }

    // 当前行用停靠式转场时，由它统一绘制自己 + 停靠的历史行
    const drawnByStack = new Set<number>()
    if (current >= 0) {
      const curEffect = effectFor(lyric[current], style)
      if (curEffect.lineTransition) {
        drawLineStack(ctx, curEffect, lyric, style, tMs, current, drawnByStack)
      }
    }

    for (let i = 0; i < lyric.length; i++) {
      if (drawnByStack.has(i)) continue
      const line = lyric[i]
      if (tMs < line.start || tMs >= line.end + EXIT_MS) continue
      const effect = effectFor(line, style)
      if (tMs < line.end) {
        drawLine(ctx, effect, line, style, tMs, 1, 0)
      } else {
        // 默认退场：淡出 + 上浮（停靠式特效的行离开堆叠后也走这里收尾）
        const exitP = easeOutCubic((tMs - line.end) / EXIT_MS)
        drawLine(ctx, effect, line, style, tMs, 1 - exitP, -exitP * style.fontSize * 0.5)
      }
    }
  }

  // 独立文字块画在最上层
  for (const line of lines) {
    if (line.kind !== 'text') continue
    if (tMs < line.start || tMs >= line.end + EXIT_MS) continue
    drawTextBlock(ctx, line, style, tMs)
  }
}
