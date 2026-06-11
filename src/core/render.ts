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
  const key = `${line.id}|${line.text}|${variant}|${style.width}x${style.height}|${style.fontSize}|${style.fontWeight} ${style.fontFamily}`
  const hit = layoutCache.get(key)
  if (hit) return hit
  if (layoutCache.size > 300) layoutCache.clear()
  const measure = (text: string, fontSize: number): number => {
    ctx.font = `${style.fontWeight} ${fontSize}px ${quoteFamily(style.fontFamily)}`
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
    ctx.font = `${style.fontWeight} ${style.fontSize * 1.1}px ${quoteFamily(style.fontFamily)}`
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
  ctx.fillStyle = style.textColor
  ctx.translate(cx + fx.dx + line.dx, cy + fx.dy + line.dy)
  if (fx.rotate !== 0) ctx.rotate(fx.rotate)
  if (fx.scale !== 1) ctx.scale(fx.scale, fx.scale)
  ctx.globalAlpha = clamp01(fx.alpha)
  if (fx.blur > 0.3) ctx.filter = `blur(${Math.min(fx.blur, 24)}px)`
  for (const p of placed) {
    ctx.font = `${style.fontWeight} ${p.fontSize}px ${quoteFamily(style.fontFamily)}`
    ctx.fillText(p.char.text, p.x - cx, p.y - cy)
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
    ctx.globalAlpha = clamp01(alpha)
    if (fx.blur > 0.3) ctx.filter = `blur(${Math.min(fx.blur, 24)}px)`
    if (fx.glow > 0.5) {
      ctx.shadowColor = style.glowColor
      ctx.shadowBlur = fx.glow
    }
    ctx.font = `${style.fontWeight} ${p.fontSize}px ${quoteFamily(style.fontFamily)}`
    ctx.fillText(p.char.text, 0, 0)
    ctx.restore()
  }

  // 打字机光标：跟在最后一个已出现字符后面闪烁
  if (effect.cursor && lineAlpha > 0.5 && lastVisible && tMs < line.end) {
    const blink = (timeInLine / 530) % 2 < 1
    if (blink) {
      const fs = lastVisible.fontSize
      ctx.globalAlpha = 0.85 * lineAlpha
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

/**
 * 渲染某一时刻的完整画面。纯确定性：同样输入永远画出同一帧，
 * 预览与导出共用。tMs 为项目时间轴毫秒。
 * 每行可有独立特效（line.effectId）与位置偏移（line.dx/dy）。
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

  drawMetaIntro(ctx, meta, style, tMs, lines[0].start)

  // 当前行 = 最后一个已开始的行（lines 按 start 排序）
  let current = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start <= tMs) current = i
    else break
  }

  // 当前行用停靠式转场时，由它统一绘制自己 + 停靠的历史行
  const drawnByStack = new Set<number>()
  if (current >= 0) {
    const curEffect = effectFor(lines[current], style)
    if (curEffect.lineTransition) {
      drawLineStack(ctx, curEffect, lines, style, tMs, current, drawnByStack)
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (drawnByStack.has(i)) continue
    const line = lines[i]
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
