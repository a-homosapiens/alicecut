import type { LrcLine, LrcMeta } from './types'
import { layoutLine, type PlacedChar, type LayoutVariant } from './layout'
import { getEffect, type EffectPreset, type LineFx, type CharFx } from './effects'
import { seededRand, clamp01, easeOutCubic, easeOutBack } from './easing'

export interface RenderStyle {
  width: number
  height: number
  fontFamily: string
  fontWeight: number
  fontSize: number
  textColor: string
  letterSpacing: number
  wordSpacing: number
  lineSpacing: number
  textAlign: 'left' | 'center' | 'right'
  textOrientation: 'horizontal' | 'vertical'
  strokeColor: string
  strokeWidth: number
  strokeAlpha: number
  glowColor: string
  bgType: 'solid' | 'gradient' | 'image'
  bgFrom: string
  bgTo: string
  /** 渐变角度，度 */
  bgAngle: number
  /** 背景图片路径；图片本身由调用方（drawBackdrop）绘制 */
  bgImage: string | null
  /** 背景图片缩放（1 = cover 铺满基准）、画布像素偏移、旋转（度） */
  bgImageScale: number
  bgImageX: number
  bgImageY: number
  bgImageRotate: number
  /** 全局默认特效；行可用 line.effectId 覆盖 */
  effectId: string
  effectInDurationMs: number
  effectOutDurationMs: number
  intensity: number
  /** Number of old captions kept on screen by the rise transition. */
  riseHistory: number
  /** 片头显示歌名/歌手 */
  showMeta: boolean
  /** 全局文字变换：所有文字一起平移（画布像素）与旋转（度），绕画面中心 */
  globalDx: number
  globalDy: number
  globalRotate: number
  /** 卡拉OK高亮色（当前词染色） */
  highlightColor: string
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

/** 字幕组在画面上的绘制位置（多语言字幕场景，每组一个纵向偏移，避免叠在一起） */
export interface TrackPlacement {
  id: number
  offsetY: number
  visible: boolean
}

/** 上一行退场的淡出时长 ms（默认退场；停靠式转场有自己的节奏） */
const EXIT_MS = 280

/** 该行的退场特效（反向播放其进场）；line.effectOutId 为空则 null = 走默认淡出上浮 */
export function effectOutFor(line: LrcLine): EffectPreset | null {
  return line.effectOutId ? getEffect(line.effectOutId) : null
}

export interface EffectTiming {
  inMs: number
  outMs: number
  outStartMs: number
}

const durationValue = (value: unknown, fallback: number): number => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, n) : Math.max(0, fallback)
}

/**
 * Resolve a caption's two animation windows inside its own segment.
 * Invalid/legacy JSON is normalized with In priority: In is clamped first,
 * then Out receives only the remaining tail. Interactive setters implement
 * last-edited-wins before data reaches this final safety boundary.
 */
export function resolveEffectTiming(line: LrcLine, style: RenderStyle): EffectTiming {
  const segmentMs = Math.max(0, line.end - line.start)
  const baseIn = getEffect(line.effectId ?? style.effectId).enterDuration
  const baseOut = effectOutFor(line)?.enterDuration ?? EXIT_MS
  const requestedIn = durationValue(line.effectInDurationMs ?? style.effectInDurationMs, baseIn)
  const requestedOut = durationValue(line.effectOutDurationMs ?? style.effectOutDurationMs, baseOut)
  const inMs = Math.min(segmentMs, requestedIn)
  const outMs = Math.min(requestedOut, Math.max(0, segmentMs - inMs))
  return { inMs, outMs, outStartMs: line.end - outMs }
}

/** 该行实际使用的特效：行级覆盖优先，并带入已归一化的 In 时长 */
export function effectFor(line: LrcLine, style: RenderStyle): EffectPreset {
  const effect = getEffect(line.effectId ?? style.effectId)
  const duration = resolveEffectTiming(line, style).inMs
  return duration === effect.enterDuration ? effect : { ...effect, enterDuration: Math.max(0.001, duration) }
}

function lineHistoryDepth(effect: EffectPreset, style: RenderStyle): number {
  if (effect.id !== 'rise') return effect.lineTransition?.maxDepth ?? 0
  const value = Number(style.riseHistory)
  return Number.isFinite(value) ? Math.max(0, Math.min(6, Math.round(value))) : 3
}

/** 把行级文字覆盖（line.over）叠加到全局样式，得到该行实际渲染样式；无覆盖返回原样式 */
export function resolveLineStyle(line: LrcLine, style: RenderStyle): RenderStyle {
  const o = line.over
  if (!o) return style
  return {
    ...style,
    fontFamily: o.fontFamily ?? style.fontFamily,
    fontSize: o.fontSize ?? style.fontSize,
    fontWeight: o.fontWeight ?? style.fontWeight,
    italic: o.italic ?? style.italic,
    textColor: o.textColor ?? style.textColor,
    textAlpha: o.textAlpha ?? style.textAlpha,
    letterSpacing: o.letterSpacing ?? style.letterSpacing,
    wordSpacing: o.wordSpacing ?? style.wordSpacing,
    lineSpacing: o.lineSpacing ?? style.lineSpacing,
    textAlign: o.textAlign ?? style.textAlign,
    textOrientation: o.textOrientation ?? style.textOrientation,
    strokeColor: o.strokeColor ?? style.strokeColor,
    strokeWidth: o.strokeWidth ?? style.strokeWidth,
    strokeAlpha: o.strokeAlpha ?? style.strokeAlpha,
    textBgColor: o.textBgColor ?? style.textBgColor,
    textBgAlpha: o.textBgAlpha ?? style.textBgAlpha,
    glowColor: o.glowColor ?? style.glowColor,
    halo: o.halo ?? style.halo,
    shadowColor: o.shadowColor ?? style.shadowColor,
    shadowAlpha: o.shadowAlpha ?? style.shadowAlpha,
    shadowBlur: o.shadowBlur ?? style.shadowBlur,
    shadowOffset: o.shadowOffset ?? style.shadowOffset
  }
}

/* ---- 布局缓存：同一行同一样式只排版一次 ---- */
const layoutCache = new Map<string, PlacedChar[]>()

function getLayout(
  ctx: CanvasRenderingContext2D,
  line: LrcLine,
  style: RenderStyle,
  variant: 'center' | 'staggered'
): PlacedChar[] {
  const key = `${line.id}|${line.text}|${variant}|${style.width}x${style.height}|${style.fontSize}|${style.letterSpacing}|${style.wordSpacing}|${style.lineSpacing}|${style.textAlign}|${style.textOrientation}|${style.italic ? 'i' : ''}${style.fontWeight} ${style.fontFamily}`
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
    letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing,
    lineSpacing: style.lineSpacing,
    align: style.textAlign,
    orientation: style.textOrientation,
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

function paintText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: RenderStyle): void {
  if (style.strokeWidth > 0.01 && style.strokeAlpha > 0.004) {
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.lineWidth = style.strokeWidth
    ctx.strokeStyle = hexToRgba(style.strokeColor, style.strokeAlpha)
    ctx.strokeText(text, x, y)
  }
  ctx.fillText(text, x, y)
}

/** #rrggbb + alpha → rgba() 字符串（阴影颜色用） */
function hexToRgba(hex: string, alpha: number): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp01(alpha).toFixed(3)})`
}

/** 两个 #rrggbb 按 t∈[0,1] 线性混合，返回 rgb() 字符串（卡拉OK高亮染色用） */
function mixHex(a: string, b: string, t: number): string {
  const pa = a.match(/^#?([0-9a-f]{6})$/i)
  const pb = b.match(/^#?([0-9a-f]{6})$/i)
  if (!pa || !pb) return a
  const na = parseInt(pa[1], 16)
  const nb = parseInt(pb[1], 16)
  const mix = (sh: number): number =>
    Math.round(((na >> sh) & 255) + (((nb >> sh) & 255) - ((na >> sh) & 255)) * t)
  return `rgb(${mix(16)},${mix(8)},${mix(0)})`
}

/** 按高亮块颜色亮度选对比文字色（亮块配深字 / 暗块配白字），保证块内词可读 */
function contrastColor(hex: string): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i)
  if (!m) return '#111111'
  const n = parseInt(m[1], 16)
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return lum > 150 ? '#111111' : '#ffffff'
}

/* ---- 跳动高亮块（highlightBox 特效）---- */
interface WordBoxRect {
  cx: number
  cy: number
  w: number
  h: number
}

/** 高亮块从上一词跳到当前词的弹跳时长 ms */
const BOX_SPRING_MS = 220

/**
 * 计算当前帧高亮块的姿态：找出"最近开始"的词（当前朗读词），
 * 取其包围盒为目标；从上一词包围盒按弹跳缓动插值过去，逐词"跳"。
 * 首词无前驱 → 缩放+淡入登场。返回块矩形（画布坐标，未含行偏移）。
 */
function resolveWordBox(
  placed: PlacedChar[],
  tMs: number,
  fontSize: number
): { activeIdx: number; rect: WordBoxRect; alpha: number } | null {
  interface Group {
    start: number
    minX: number
    maxX: number
    top: number
    bottom: number
  }
  const groups = new Map<number, Group>()
  for (const p of placed) {
    const top = p.y - p.fontSize * 0.62
    const bottom = p.y + p.fontSize * 0.62
    const g = groups.get(p.unitIndex)
    if (!g) {
      groups.set(p.unitIndex, { start: p.word.start, minX: p.x - p.w / 2, maxX: p.x + p.w / 2, top, bottom })
    } else {
      g.minX = Math.min(g.minX, p.x - p.w / 2)
      g.maxX = Math.max(g.maxX, p.x + p.w / 2)
      g.top = Math.min(g.top, top)
      g.bottom = Math.max(g.bottom, bottom)
    }
  }
  if (groups.size === 0) return null

  // 当前词 = 已开始且开始时间最晚的词
  let activeIdx = -1
  let activeStart = -Infinity
  for (const [idx, g] of groups) {
    if (g.start <= tMs && (g.start > activeStart || (g.start === activeStart && idx > activeIdx))) {
      activeIdx = idx
      activeStart = g.start
    }
  }
  if (activeIdx < 0) return null

  const padX = fontSize * 0.3
  const padY = fontSize * 0.18
  const rectOf = (g: Group): WordBoxRect => ({
    cx: (g.minX + g.maxX) / 2,
    cy: (g.top + g.bottom) / 2,
    w: g.maxX - g.minX + padX * 2,
    h: g.bottom - g.top + padY * 2
  })
  const cur = rectOf(groups.get(activeIdx)!)
  const t = clamp01((tMs - activeStart) / BOX_SPRING_MS)
  const prevG = groups.get(activeIdx - 1)
  if (!prevG) {
    // 首词登场：从 0 缩放弹入并淡入
    const s = easeOutBack(t)
    return { activeIdx, alpha: clamp01(t * 2), rect: { cx: cur.cx, cy: cur.cy, w: cur.w * s, h: cur.h * s } }
  }
  const prev = rectOf(prevG)
  const ePos = easeOutBack(t)
  const eSize = easeOutCubic(t)
  const L = (a: number, b: number, k: number): number => a + (b - a) * k
  return {
    activeIdx,
    alpha: 1,
    rect: {
      cx: L(prev.cx, cur.cx, ePos),
      cy: L(prev.cy, cur.cy, ePos),
      w: L(prev.w, cur.w, eSize),
      h: L(prev.h, cur.h, eSize)
    }
  }
}

/** 绘制圆角高亮块（在当前词文字之下） */
function drawWordBox(
  ctx: CanvasRenderingContext2D,
  rect: WordBoxRect,
  style: RenderStyle,
  alpha: number,
  dx: number,
  dy: number
): void {
  ctx.save()
  ctx.globalAlpha = clamp01(alpha)
  ctx.fillStyle = style.highlightColor
  const w = Math.max(rect.w, 1)
  const h = Math.max(rect.h, 1)
  ctx.beginPath()
  ctx.roundRect(rect.cx - w / 2 + dx, rect.cy - h / 2 + dy, w, h, Math.min(h * 0.34, style.fontSize * 0.34))
  ctx.fill()
  ctx.restore()
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
  if (style.bgType === 'image') {
    // 图片由 drawBackdrop 按 cover 绘制；这里先铺黑底兜底（图片未加载/有空白时）
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, style.width, style.height)
    return
  }
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
    paintText(ctx, meta.title, cx, cy - style.fontSize * 0.75, style)
  }
  if (meta.artist) {
    ctx.globalAlpha = alpha * 0.7
    ctx.font = `400 ${style.fontSize * 0.5}px ${quoteFamily(style.fontFamily)}`
    paintText(ctx, meta.artist, cx, cy + style.fontSize * 0.55, style)
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

/** 选中编辑用：某行文字块在画布上的静止位置（含该行 dx/dy 偏移 + 所属字幕组的纵向偏移） */
export function getLineBlockRect(
  ctx: CanvasRenderingContext2D,
  line: LrcLine,
  styleIn: RenderStyle,
  trackOffsetY = 0
): BlockRect | null {
  const style = resolveLineStyle(line, styleIn) // 选择框/吸附按该行实际字号
  const placed = getLayout(ctx, line, style, effectFor(line, style).layoutVariant)
  if (placed.length === 0) return null
  const b = measureBlock(placed, style.fontSize)
  return { x: b.x + line.dx, y: b.y + line.dy + trackOffsetY, w: b.w, h: b.h }
}

/**
 * 若该行设置了 over.rotate（度），绕其文字块中心旋转后再绘制；否则直接绘制。
 * 覆盖所有绘制路径（逐字特效 / 揭示 / 停靠转场 / 独立文字块）：把叶子绘制放进回调即可。
 */
function withLineRotate(
  ctx: CanvasRenderingContext2D,
  line: LrcLine,
  style: RenderStyle,
  variant: LayoutVariant,
  lineDy: number,
  draw: () => void
): void {
  const deg = line.over?.rotate ?? 0
  if (!deg) {
    draw()
    return
  }
  const placed = getLayout(ctx, line, style, variant)
  if (placed.length === 0) {
    draw()
    return
  }
  const b = measureBlock(placed, style.fontSize)
  const bcx = b.x + b.w / 2 + line.dx
  const bcy = b.y + b.h / 2 + line.dy + lineDy
  ctx.save()
  ctx.translate(bcx, bcy)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.translate(-bcx, -bcy)
  draw()
  ctx.restore()
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
    paintText(ctx, p.char.text, p.x - cx, p.y - cy, style)
  }
  if (hasShadow && style.halo > 0.5) {
    applyGlow(ctx, style, style.halo)
    for (const p of placed) {
      ctx.font = fontStr(style, p.fontSize)
      paintText(ctx, p.char.text, p.x - cx, p.y - cy, style)
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
  drawn: Set<number>,
  trackOffsetY: number
): void {
  const trans = effect.lineTransition!
  const historyDepth = lineHistoryDepth(effect, style)
  const eased = easeOutCubic(clamp01((tMs - lines[current].start) / effect.enterDuration))

  // 实测各深度行的包围盒，停靠位置据此紧靠排布
  const layouts: PlacedChar[][] = []
  const styles: RenderStyle[] = []
  const blocks: { w: number; h: number }[] = []
  for (let d = 0; d <= historyDepth + 1; d++) {
    const i = current - d
    const lineStyle = i >= 0 ? resolveLineStyle(lines[i], style) : style
    const placed = i >= 0 ? getLayout(ctx, lines[i], lineStyle, effect.layoutVariant) : []
    styles.push(lineStyle)
    layouts.push(placed)
    const b = measureBlock(placed, lineStyle.fontSize)
    blocks.push({ w: b.w, h: b.h })
  }

  // 由深到浅绘制，新行盖在最上层
  for (let d = Math.min(historyDepth + 1, current); d >= 0; d--) {
    const placed = layouts[d]
    drawn.add(current - d)
    if (placed.length === 0) continue
    const line = lines[current - d]
    // A caption with an explicit Out effect has already left at its own
    // segment end; do not resurrect it as parked history for the next line.
    if (d > 0 && line.effectOutId) continue
    const lineStyle = styles[d]
    const args = {
      lineId: line.id,
      width: lineStyle.width,
      height: lineStyle.height,
      fontSize: lineStyle.fontSize,
      intensity: lineStyle.intensity,
      blocks
    }
    const posedTarget = trans.pose(d, args)
    // The extra depth is rendered for one transition only so the oldest parked
    // caption fades away instead of disappearing on a hard frame boundary.
    const target = d > historyDepth ? { ...posedTarget, alpha: 0 } : posedTarget
    // 进场前一刻所有行都还在浅一级的停靠位（块序整体后移一位）
    const source =
      d === 0 ? trans.enterFrom(args) : trans.pose(d - 1, { ...args, blocks: blocks.slice(1) })
    const fx = lerpLineFx(source, target, eased)
    if (fx.alpha <= 0.003 || fx.scale <= 0.003) continue
    withLineRotate(ctx, line, lineStyle, effect.layoutVariant, trackOffsetY, () =>
      drawBlock(ctx, placed, line, lineStyle, trackOffsetY === 0 ? fx : { ...fx, dy: fx.dy + trackOffsetY })
    )
  }
}

/**
 * 计算某字符在指定时刻的 CharFx；时刻早于其出场门限则返回 null（残影/主体共用）。
 * enterTOverride 给定时跳过门限、用该进场进度（退场反向播放：传 1−exitT）。
 */
function charFxAt(
  effect: EffectPreset,
  p: PlacedChar,
  line: LrcLine,
  tMs: number,
  intensity: number,
  rand: (key: number) => number,
  unitCount: number,
  enterTOverride?: number
): CharFx | null {
  const [uStart, uEnd] = effect.unit === 'word' ? [p.word.start, p.word.end] : [p.char.start, p.char.end]
  const lineDuration = Math.max(1, line.end - line.start)
  // The configured In duration describes the whole entrance window. Preserve
  // the source word/character ordering, but remap its stagger into the first
  // 65% so the final unit also settles before the In window ends.
  const sourceProgress = clamp01((uStart - line.start) / lineDuration)
  const staggerSpan = effect.appearAtLineStart || effect.unit === 'line' ? 0 : effect.enterDuration * 0.65
  const gateStart = line.start + sourceProgress * staggerSpan
  const unitDuration = Math.max(0.001, effect.enterDuration - staggerSpan)
  if (enterTOverride == null && tMs < gateStart) return null
  const enterT = enterTOverride ?? clamp01((tMs - gateStart) / unitDuration)
  return effect.apply({
    unitIndex: p.unitIndex,
    unitCount,
    charIndexInUnit: p.charIndexInUnit,
    enterT,
    timeInLine: tMs - line.start,
    lineDuration,
    unitStart: uStart - line.start,
    unitEnd: uEnd - line.start,
    intensity,
    rand
  })
}

/** 运动残影：按更早时刻的姿态画 count 枚淡出残影（仅在字符相对当前帧有位移时） */
function drawCharTrail(
  ctx: CanvasRenderingContext2D,
  effect: EffectPreset,
  p: PlacedChar,
  line: LrcLine,
  style: RenderStyle,
  tMs: number,
  lineAlpha: number,
  lineDy: number,
  mainFx: CharFx,
  rand: (key: number) => number,
  unitCount: number
): void {
  const trail = effect.trail!
  const decay = trail.decay ?? 0.5
  for (let i = trail.count; i >= 1; i--) {
    const gf = charFxAt(effect, p, line, tMs - i * trail.stepMs, style.intensity, rand, unitCount)
    if (!gf) continue
    // 与当前帧几乎重合 = 没在动，不画残影，避免静止时字符变粗
    if (Math.abs(gf.dx - mainFx.dx) < 0.5 && Math.abs(gf.dy - mainFx.dy) < 0.5) continue
    const a = gf.alpha * lineAlpha * (1 - i / (trail.count + 1)) * decay
    if (a <= 0.01 || gf.scale <= 0.003) continue
    ctx.save()
    ctx.translate(p.x + gf.dx + line.dx, p.y + gf.dy + lineDy + line.dy)
    if (p.rotate !== 0 || gf.rotate !== 0) ctx.rotate(p.rotate + gf.rotate)
    if (gf.scale !== 1) ctx.scale(gf.scale, gf.scale)
    ctx.globalAlpha = clamp01(a * style.textAlpha)
    ctx.fillStyle = style.textColor
    ctx.font = fontStr(style, p.fontSize)
    paintText(ctx, p.char.text, 0, 0, style)
    ctx.restore()
  }
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  effect: EffectPreset,
  line: LrcLine,
  style: RenderStyle,
  tMs: number,
  lineAlpha: number,
  lineDy: number,
  exitT?: number
): void {
  const placed = getLayout(ctx, line, style, effect.layoutVariant)
  if (placed.length === 0) return
  const rand = seededRand(line.id + 1)
  const unitCount = line.words.length
  const timeInLine = tMs - line.start
  // 退场：反向播放 effect 的进场（enterT 1→0），所有字一起退；进场用逐字门限
  const enterOverride = exitT != null ? 1 - clamp01(exitT) : undefined

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  drawTextBg(ctx, placed, style, lineAlpha, line.dx, line.dy + lineDy)
  ctx.fillStyle = style.textColor

  // 跳动高亮块/残影/光标只用于进场，退场不画
  const box = effect.wordBox && exitT == null ? resolveWordBox(placed, tMs, style.fontSize) : null
  const boxTextColor = box ? contrastColor(style.highlightColor) : style.textColor
  if (box && box.alpha > 0.003) {
    drawWordBox(ctx, box.rect, style, lineAlpha * box.alpha, line.dx, line.dy + lineDy)
  }

  let lastVisible: PlacedChar | null = null
  for (const p of placed) {
    const fx = charFxAt(effect, p, line, tMs, style.intensity, rand, unitCount, enterOverride)
    if (!fx) continue
    const alpha = fx.alpha * lineAlpha
    if (alpha <= 0.003 || fx.scale <= 0.003) continue
    lastVisible = p

    // 运动残影画在主体之下
    if (effect.trail && exitT == null) drawCharTrail(ctx, effect, p, line, style, tMs, lineAlpha, lineDy, fx, rand, unitCount)

    ctx.save()
    ctx.translate(p.x + fx.dx + line.dx, p.y + fx.dy + lineDy + line.dy)
    if (p.rotate !== 0 || fx.rotate !== 0) ctx.rotate(p.rotate + fx.rotate)
    if (fx.scale !== 1) ctx.scale(fx.scale, fx.scale)
    if (fx.skewX || fx.skewY) ctx.transform(1, fx.skewY ?? 0, fx.skewX ?? 0, 1, 0, 0)
    ctx.globalAlpha = clamp01(alpha * style.textAlpha)
    if (fx.blur > 0.3) ctx.filter = `blur(${Math.min(fx.blur, 24)}px)`
    ctx.fillStyle =
      box && p.unitIndex === box.activeIdx
        ? boxTextColor
        : fx.highlight
          ? mixHex(style.textColor, style.highlightColor, clamp01(fx.highlight))
          : style.textColor
    ctx.font = fontStr(style, p.fontSize)
    // 特效辉光与常驻光晕取较强者；阴影与光晕共用 shadow 通道，都开时画两遍
    const glow = Math.max(fx.glow > 0.5 ? fx.glow : 0, style.halo)
    const hasShadow = applyShadow(ctx, style, alpha)
    if (!hasShadow && glow > 0.5) applyGlow(ctx, style, glow)
    paintText(ctx, p.char.text, 0, 0, style)
    if (hasShadow && glow > 0.5) {
      applyGlow(ctx, style, glow)
      paintText(ctx, p.char.text, 0, 0, style)
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

/**
 * 遮罩式入场转场：在 enterDuration 内用动画裁剪区域把整行揭示出来。
 * 揭示完成后（进度≥1）直接走常规 drawLine。整块在裁剪内一次性全显，
 * 可见性完全由裁剪边界推进决定。
 */
function drawLineReveal(
  ctx: CanvasRenderingContext2D,
  effect: EffectPreset,
  line: LrcLine,
  style: RenderStyle,
  tMs: number,
  lineDy = 0
): void {
  const p = clamp01((tMs - line.start) / effect.enterDuration)
  if (p >= 1) {
    drawLine(ctx, effect, line, style, tMs, 1, lineDy)
    return
  }
  const placed = getLayout(ctx, line, style, effect.layoutVariant)
  if (placed.length === 0) return
  const b = measureBlock(placed, style.fontSize)
  // 余量：避免裁掉抗锯齿边缘与辉光（擦入的推进边仍是硬边，符合 wipe 观感）
  const pad = style.fontSize * 0.6
  const x = b.x + line.dx - pad
  const y = b.y + line.dy + lineDy - pad
  const w = b.w + pad * 2
  const h = b.h + pad * 2
  const e = easeOutCubic(p)

  ctx.save()
  ctx.beginPath()
  if (effect.reveal === 'iris') {
    ctx.arc(x + w / 2, y + h / 2, Math.max(Math.hypot(w, h) * 0.5 * e, 0.01), 0, Math.PI * 2)
  } else if (effect.reveal === 'clockWipe') {
    const cx = x + w / 2
    const cy = y + h / 2
    const a0 = -Math.PI / 2 // 从 12 点方向顺时针扫
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, Math.hypot(w, h) * 0.5, a0, a0 + e * Math.PI * 2)
    ctx.closePath()
  } else {
    // wipe：矩形从左向右展开
    ctx.rect(x, y, w * e, h)
  }
  ctx.clip()
  drawLine(ctx, effect, line, style, tMs, 1, lineDy)
  ctx.restore()
}

/** 独立文字块：不参与歌词流，自己的起止区间内独立进退场 */
function drawTextBlock(ctx: CanvasRenderingContext2D, line: LrcLine, styleIn: RenderStyle, tMs: number): void {
  const style = resolveLineStyle(line, styleIn) // 行级文字覆盖
  const effect = effectFor(line, style)
  withLineRotate(ctx, line, style, effect.layoutVariant, 0, () => {
    const timing = resolveEffectTiming(line, style)
    const exitP = timing.outMs > 0 && tMs >= timing.outStartMs
      ? easeOutCubic(clamp01((tMs - timing.outStartMs) / timing.outMs))
      : 0

    // Explicit Out always wins over a parking-style In transition.
    const explicitOut = exitP > 0 ? effectOutFor(line) : null
    if (explicitOut) {
      drawLine(ctx, explicitOut, line, style, tMs, 1, 0, exitP)
      return
    }

    if (!effect.lineTransition) {
      const out = exitP > 0 ? effectOutFor(line) : null
      if (effect.reveal && exitP === 0) drawLineReveal(ctx, effect, line, style, tMs)
      else if (out) drawLine(ctx, out, line, style, tMs, 1, 0, exitP)
      else drawLine(ctx, effect, line, style, tMs, 1 - exitP, -exitP * style.fontSize * 0.5)
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
  })
}

/**
 * 渲染某一时刻的完整画面。纯确定性：同样输入永远画出同一帧，
 * 预览与导出共用。tMs 为项目时间轴毫秒。
 * 每行可有独立特效（line.effectId）与位置偏移（line.dx/dy）。
 * kind='text' 的行是独立文字块，不参与当前行/停靠堆叠逻辑。
 * drawBackdrop：可选的背景视频绘制层（画在纯色/渐变之上、文字之下），
 * 由调用方提供——预览取播放中的帧，导出取精确 seek 后的帧。
 */

/**
 * 绘制一个字幕组的完整歌词流：找当前行 → 停靠式转场（整块 + 历史）或逐行常规进退场。
 * trackOffsetY 是该字幕组相对画面中心的纵向偏移（多语言字幕错开不重叠），
 * 与每行自己的 dy 叠加——用法等同于原先仅在退场时使用的 lineDy 参数。
 */
function drawLyricFlow(
  ctx: CanvasRenderingContext2D,
  lyric: LrcLine[],
  style: RenderStyle,
  tMs: number,
  trackOffsetY: number
): void {
  if (lyric.length === 0) return

  // 当前行 = 最后一个已开始的行（lyric 按 start 排序）
  let current = -1
  for (let i = 0; i < lyric.length; i++) {
    if (lyric[i].start <= tMs && tMs < lyric[i].end) current = i
    else break
  }

  // 当前行用停靠式转场时，由它统一绘制自己 + 停靠的历史行
  const drawnByStack = new Set<number>()
  if (current >= 0) {
    const currentLine = lyric[current]
    const curEffect = effectFor(currentLine, style)
    const timing = resolveEffectTiming(currentLine, resolveLineStyle(currentLine, style))
    const explicitOutActive = !!currentLine.effectOutId && timing.outMs > 0 && tMs >= timing.outStartMs
    if (curEffect.lineTransition && !explicitOutActive) {
      drawLineStack(ctx, curEffect, lyric, style, tMs, current, drawnByStack, trackOffsetY)
    }
  }

  for (let i = 0; i < lyric.length; i++) {
    if (drawnByStack.has(i)) continue
    const line = lyric[i]
    if (tMs < line.start || tMs >= line.end) continue
    const effect = effectFor(line, style)
    const ls = resolveLineStyle(line, style) // 行级文字覆盖
    const timing = resolveEffectTiming(line, ls)
    withLineRotate(ctx, line, ls, effect.layoutVariant, trackOffsetY, () => {
      if (timing.outMs <= 0 || tMs < timing.outStartMs) {
        if (effect.reveal) drawLineReveal(ctx, effect, line, ls, tMs, trackOffsetY)
        else drawLine(ctx, effect, line, ls, tMs, 1, trackOffsetY)
      } else {
        // 退场：指定了退场特效则反向播放它，否则默认淡出 + 上浮
        const exitP = easeOutCubic(clamp01((tMs - timing.outStartMs) / timing.outMs))
        const out = effectOutFor(line)
        if (out) drawLine(ctx, out, line, ls, tMs, 1, trackOffsetY, exitP)
        else drawLine(ctx, effect, line, ls, tMs, 1 - exitP, trackOffsetY - exitP * ls.fontSize * 0.5)
      }
    })
  }
}

/** 按 trackId 分组（?? 0 = 主字幕组）；lyric 已按 start 排序，filter 保留组内相对顺序 */
function groupByTrack(lyric: LrcLine[]): Map<number, LrcLine[]> {
  const groups = new Map<number, LrcLine[]>()
  for (const l of lyric) {
    const tid = l.trackId ?? 0
    const g = groups.get(tid)
    if (g) g.push(l)
    else groups.set(tid, [l])
  }
  return groups
}

/** 各字幕组的绘制位置：外部给定的 placements + 数据中多出的 trackId 兜底 */
function resolvePlacements(groups: Map<number, LrcLine[]>, tracks?: TrackPlacement[]): TrackPlacement[] {
  return tracks
    ? [
        ...tracks,
        // 兜底：数据里存在但 placements 里没给的 trackId（工程文件手改/异常数据）也画出来，
        // 内容不无声消失——叠在默认位置也比整段消失更容易被发现
        ...[...groups.keys()]
          .filter((id) => !tracks.some((p) => p.id === id))
          .map((id) => ({ id, offsetY: 0, visible: true }))
      ]
    : [...groups.keys()].sort((a, b) => a - b).map((id) => ({ id, offsetY: 0, visible: true }))
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  lines: LrcLine[],
  meta: LrcMeta,
  style: RenderStyle,
  tMs: number,
  drawBackdrop?: (ctx: CanvasRenderingContext2D) => void,
  opts: { skipBackground?: boolean; tracks?: TrackPlacement[] } = {}
): void {
  if (!opts.skipBackground) {
    drawBackground(ctx, style)
    drawBackdrop?.(ctx)
  }
  if (lines.length === 0) return

  // 全局文字变换：绕画面中心平移+旋转所有文字（背景/视频不受影响）
  const hasGlobalTf = style.globalDx !== 0 || style.globalDy !== 0 || style.globalRotate !== 0
  if (hasGlobalTf) {
    ctx.save()
    ctx.translate(style.width / 2 + style.globalDx, style.height / 2 + style.globalDy)
    ctx.rotate((style.globalRotate * Math.PI) / 180)
    ctx.translate(-style.width / 2, -style.height / 2)
  }

  const lyric = lines.filter((l) => l.kind !== 'text')

  if (lyric.length > 0) {
    const groups = groupByTrack(lyric)
    const placements = resolvePlacements(groups, opts.tracks)

    // 片头：用"可见字幕组中最早开始"的行判定淡出时机，避免被隐藏字幕组的行带偏
    const visibleIds = new Set(placements.filter((p) => p.visible).map((p) => p.id))
    const visibleFirst = lyric.find((l) => visibleIds.has(l.trackId ?? 0))
    drawMetaIntro(ctx, meta, style, tMs, (visibleFirst ?? lyric[0]).start)

    for (const p of placements) {
      if (!p.visible) continue
      const group = groups.get(p.id)
      if (!group || group.length === 0) continue
      drawLyricFlow(ctx, group, style, tMs, p.offsetY)
    }
  }

  // 独立文字块画在最上层；按 layer 升序，高层后画（盖在上面）
  const textBlocks = lines.filter((l) => l.kind === 'text').sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0))
  for (const line of textBlocks) {
    if (tMs < line.start || tMs >= line.end) continue
    drawTextBlock(ctx, line, style, tMs)
  }

  if (hasGlobalTf) ctx.restore()
}

/** 全局文字变换矩阵应用到当前 ctx（供预览选中框等覆盖层与渲染保持一致） */
export function applyGlobalTextTransform(ctx: CanvasRenderingContext2D, style: RenderStyle): void {
  if (style.globalDx === 0 && style.globalDy === 0 && style.globalRotate === 0) return
  ctx.translate(style.width / 2 + style.globalDx, style.height / 2 + style.globalDy)
  ctx.rotate((style.globalRotate * Math.PI) / 180)
  ctx.translate(-style.width / 2, -style.height / 2)
}

/* ---- 帧指纹：导出跳过重复帧用 ----
 *
 * renderFrame 是 tMs 的纯确定性函数：把这一帧绘制会用到的所有随时间变化的
 * 量（每个字符的 CharFx、高亮块姿态、光标闪烁相位、进/退场进度、停靠转场
 * 进度、片头淡入淡出透明度……）序列化成一个字符串。lines/meta/style/tracks
 * 不变时，相邻两帧指纹相同 ⇔ 两帧像素完全一致，导出循环据此直接重发上一帧
 * 的像素缓冲，跳过渲染与回读（歌词视频的静止段落占比很高）。
 *
 * 下面的 fp* 系列与 draw* 系列一一对应，遍历结构必须保持同步：
 * fpLine ↔ drawLine（含残影/高亮块/光标）、fpLineReveal ↔ drawLineReveal、
 * fpTextBlock ↔ drawTextBlock、fpLyricFlow ↔ drawLyricFlow（含停靠转场）。
 */

/** drawLine 的指纹：逐字符 CharFx + 残影姿态 + 高亮块 + 光标闪烁相位 */
function fpLine(
  parts: string[],
  ctx: CanvasRenderingContext2D,
  effect: EffectPreset,
  line: LrcLine,
  style: RenderStyle,
  tMs: number,
  lineAlpha: number,
  lineDy: number,
  exitT?: number
): void {
  const placed = getLayout(ctx, line, style, effect.layoutVariant)
  if (placed.length === 0) return
  const rand = seededRand(line.id + 1)
  const unitCount = line.words.length
  const enterOverride = exitT != null ? 1 - clamp01(exitT) : undefined

  parts.push(`L${line.id};${effect.id};${lineAlpha};${lineDy}`)

  const box = effect.wordBox && exitT == null ? resolveWordBox(placed, tMs, style.fontSize) : null
  if (box) parts.push(`B${box.activeIdx};${box.alpha};${box.rect.cx};${box.rect.cy};${box.rect.w};${box.rect.h}`)

  let lastVisible = -1
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i]
    const fx = charFxAt(effect, p, line, tMs, style.intensity, rand, unitCount, enterOverride)
    if (!fx) continue
    const alpha = fx.alpha * lineAlpha
    if (alpha <= 0.003 || fx.scale <= 0.003) continue
    lastVisible = i
    parts.push(
      `${i};${fx.dx};${fx.dy};${fx.scale};${fx.rotate};${fx.alpha};${fx.blur};${fx.glow};${fx.highlight ?? 0};${fx.skewX ?? 0};${fx.skewY ?? 0}`
    )
    // 残影：与 drawCharTrail 相同的可见性判定，把会画出来的残影姿态计入指纹
    if (effect.trail && exitT == null) {
      const trail = effect.trail
      const decay = trail.decay ?? 0.5
      for (let k = trail.count; k >= 1; k--) {
        const gf = charFxAt(effect, p, line, tMs - k * trail.stepMs, style.intensity, rand, unitCount)
        if (!gf) continue
        if (Math.abs(gf.dx - fx.dx) < 0.5 && Math.abs(gf.dy - fx.dy) < 0.5) continue
        const a = gf.alpha * lineAlpha * (1 - k / (trail.count + 1)) * decay
        if (a <= 0.01 || gf.scale <= 0.003) continue
        parts.push(`t${k};${gf.dx};${gf.dy};${gf.scale};${gf.rotate};${a}`)
      }
    }
  }

  // 打字机光标：位置由最后一个可见字符决定，闪烁相位随时间翻转
  if (effect.cursor && lineAlpha > 0.5 && lastVisible >= 0 && tMs < line.end) {
    const blink = ((tMs - line.start) / 530) % 2 < 1
    if (blink) parts.push(`c${lastVisible}`)
  }
}

/** drawLineReveal 的指纹：揭示进行中计入裁剪进度，完成后回退常规 fpLine */
function fpLineReveal(
  parts: string[],
  ctx: CanvasRenderingContext2D,
  effect: EffectPreset,
  line: LrcLine,
  style: RenderStyle,
  tMs: number,
  lineDy = 0
): void {
  const p = clamp01((tMs - line.start) / effect.enterDuration)
  if (p < 1) parts.push(`R${effect.reveal};${p}`)
  fpLine(parts, ctx, effect, line, style, tMs, 1, lineDy)
}

/** drawTextBlock 的指纹 */
function fpTextBlock(
  parts: string[],
  ctx: CanvasRenderingContext2D,
  line: LrcLine,
  styleIn: RenderStyle,
  tMs: number
): void {
  const style = resolveLineStyle(line, styleIn)
  const effect = effectFor(line, style)
  const timing = resolveEffectTiming(line, style)
  const exitP = timing.outMs > 0 && tMs >= timing.outStartMs
    ? easeOutCubic(clamp01((tMs - timing.outStartMs) / timing.outMs))
    : 0

  if (!effect.lineTransition) {
    const out = exitP > 0 ? effectOutFor(line) : null
    if (effect.reveal && exitP === 0) fpLineReveal(parts, ctx, effect, line, style, tMs)
    else if (out) fpLine(parts, ctx, out, line, style, tMs, 1, 0, exitP)
    else fpLine(parts, ctx, effect, line, style, tMs, 1 - exitP, -exitP * style.fontSize * 0.5)
    return
  }

  if (exitP > 0 && effectOutFor(line)) {
    fpLine(parts, ctx, effectOutFor(line)!, line, style, tMs, 1, 0, exitP)
    return
  }

  // 停靠式整块演绎：姿态只由进场进度与退场进度决定（布局/样式在导出期间不变）
  const eased = easeOutCubic(clamp01((tMs - line.start) / effect.enterDuration))
  parts.push(`T${line.id};${effect.id};${eased};${exitP}`)
}

/** drawLyricFlow 的指纹：当前行序号 + 停靠转场进度 + 各可见行的逐字姿态 */
function fpLyricFlow(
  parts: string[],
  ctx: CanvasRenderingContext2D,
  lyric: LrcLine[],
  style: RenderStyle,
  tMs: number,
  trackOffsetY: number
): void {
  if (lyric.length === 0) return

  let current = -1
  for (let i = 0; i < lyric.length; i++) {
    if (lyric[i].start <= tMs && tMs < lyric[i].end) current = i
    else break
  }

  const drawnByStack = new Set<number>()
  if (current >= 0) {
    const currentLine = lyric[current]
    const curEffect = effectFor(currentLine, style)
    const timing = resolveEffectTiming(currentLine, resolveLineStyle(currentLine, style))
    const explicitOutActive = !!currentLine.effectOutId && timing.outMs > 0 && tMs >= timing.outStartMs
    if (curEffect.lineTransition && !explicitOutActive) {
      // 停靠姿态（pose/enterFrom）只依赖行内容与样式，导出期间不变；
      // 随时间变化的只有当前行序号与进场缓动进度
      const eased = easeOutCubic(clamp01((tMs - lyric[current].start) / curEffect.enterDuration))
      const historyDepth = lineHistoryDepth(curEffect, style)
      parts.push(`S${curEffect.id};${current};${eased};${historyDepth}`)
      for (let d = Math.min(historyDepth + 1, current); d >= 0; d--) {
        drawnByStack.add(current - d)
      }
    }
  }

  for (let i = 0; i < lyric.length; i++) {
    if (drawnByStack.has(i)) continue
    const line = lyric[i]
    if (tMs < line.start || tMs >= line.end) continue
    const effect = effectFor(line, style)
    const ls = resolveLineStyle(line, style)
    const timing = resolveEffectTiming(line, ls)
    if (timing.outMs <= 0 || tMs < timing.outStartMs) {
      if (effect.reveal) fpLineReveal(parts, ctx, effect, line, ls, tMs, trackOffsetY)
      else fpLine(parts, ctx, effect, line, ls, tMs, 1, trackOffsetY)
    } else {
      const exitP = easeOutCubic(clamp01((tMs - timing.outStartMs) / timing.outMs))
      const out = effectOutFor(line)
      if (out) fpLine(parts, ctx, out, line, ls, tMs, 1, trackOffsetY, exitP)
      else fpLine(parts, ctx, effect, line, ls, tMs, 1 - exitP, trackOffsetY - exitP * ls.fontSize * 0.5)
    }
  }
}

/**
 * 计算某一时刻画面的指纹。lines/meta/style/tracks 不变的前提下，
 * 相邻两个时刻指纹相同 ⇒ renderFrame 画出的像素完全一致。
 * 背景（纯色/渐变/图片）不随时间变化，不计入；背景视频由调用方自行判断
 * （有可见视频线段的帧不适用指纹跳帧）。
 */
export function renderFingerprint(
  ctx: CanvasRenderingContext2D,
  lines: LrcLine[],
  meta: LrcMeta,
  style: RenderStyle,
  tMs: number,
  opts: { tracks?: TrackPlacement[] } = {}
): string {
  if (lines.length === 0) return ''
  const parts: string[] = []

  const lyric = lines.filter((l) => l.kind !== 'text')
  if (lyric.length > 0) {
    const groups = groupByTrack(lyric)
    const placements = resolvePlacements(groups, opts.tracks)

    // 片头歌名/歌手：透明度随时间淡入淡出（中段恒 1、首行开始后恒 0 的区间是静止的）
    if (style.showMeta && (meta.title || meta.artist)) {
      const visibleIds = new Set(placements.filter((p) => p.visible).map((p) => p.id))
      const visibleFirst = lyric.find((l) => visibleIds.has(l.trackId ?? 0))
      const first = (visibleFirst ?? lyric[0]).start
      const alpha = Math.min(clamp01(tMs / 600), clamp01((first - tMs) / 500))
      if (alpha > 0) parts.push(`M${alpha}`)
    }

    for (const p of placements) {
      if (!p.visible) continue
      const group = groups.get(p.id)
      if (!group || group.length === 0) continue
      parts.push(`G${p.id}`)
      fpLyricFlow(parts, ctx, group, style, tMs, p.offsetY)
    }
  }

  const textBlocks = lines.filter((l) => l.kind === 'text').sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0))
  for (const line of textBlocks) {
    if (tMs < line.start || tMs >= line.end) continue
    fpTextBlock(parts, ctx, line, style, tMs)
  }

  return parts.join('|')
}
