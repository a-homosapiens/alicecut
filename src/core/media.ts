/** 媒体线段（背景视频 / 音轨）：纯数据 + 时间计算，预览与导出共用 */

import { clamp01, easeOutCubic } from './easing'

export type LoopSpec = number | 'infinite'

/** 视频转场类型（进/出场）：fade 淡入淡出、slide 四向滑动、zoom 缩放、wipe 横向擦 */
export type VideoTransitionType =
  | 'fade'
  | 'slideL'
  | 'slideR'
  | 'slideU'
  | 'slideD'
  | 'zoom'
  | 'wipeL'
  | 'wipeR'

export const VIDEO_TRANSITIONS: VideoTransitionType[] = [
  'fade',
  'slideL',
  'slideR',
  'slideU',
  'slideD',
  'zoom',
  'wipeL',
  'wipeR'
]

export interface VideoTransition {
  type: VideoTransitionType
  durationMs: number
}

export interface MediaClip {
  id: number
  kind: 'video' | 'audio'
  /** 源文件绝对路径 */
  path: string
  name: string
  /** 时间轴起点 ms */
  start: number
  /** 素材本身总时长 ms */
  sourceDuration: number
  /** 源入点/出点 ms（切割产生的修剪区间），0 ≤ in < out ≤ sourceDuration */
  sourceIn: number
  sourceOut: number
  /** 播放速度倍率（0.25–4），时间轴长度 = 修剪区间 / speed */
  speed: number
  /** 重复次数（≥1）；'infinite' = 一直循环到项目结束 */
  loop: LoopSpec
  /** 轨道层序（同类内 0 在最下；视频高层画面盖在低层上） */
  layer: number
  /** 视频画面变换：平移（画布像素）与缩放（以 cover 适配为基准），音频忽略 */
  tx: number
  ty: number
  scale: number
  /** 音频淡入时长 ms（从线段起点起，0 = 无）；视频忽略 */
  fadeInMs: number
  /** 音频淡出时长 ms（到线段结束处止，0 = 无）；视频忽略 */
  fadeOutMs: number
  /** 视频进场转场（null = 无）；音频忽略。视频间转场靠重叠两段 + 后一段 transIn 实现 */
  transIn?: VideoTransition | null
  /** 视频退场转场（null = 无）；音频忽略 */
  transOut?: VideoTransition | null
}

export const MIN_SPEED = 0.25
export const MAX_SPEED = 4

/** 规范化 loop：非法值回退为 1，数字向下取整且至少 1 */
export function normalizeLoop(loop: unknown): LoopSpec {
  if (loop === 'infinite') return 'infinite'
  const n = Math.floor(Number(loop))
  return Number.isFinite(n) && n >= 1 ? n : 1
}

export function clampSpeed(speed: unknown): number {
  const n = Number(speed)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, n))
}

/** 给缺字段的旧数据补默认值（工程文件/job 兼容） */
export function withClipDefaults(
  c: Partial<MediaClip> & Pick<MediaClip, 'kind' | 'path' | 'name' | 'start' | 'sourceDuration'>
): Omit<MediaClip, 'id'> {
  const sourceIn = Math.max(0, c.sourceIn ?? 0)
  const sourceOut = Math.min(c.sourceDuration, Math.max(sourceIn + 1, c.sourceOut ?? c.sourceDuration))
  const speed = clampSpeed(c.speed ?? 1)
  const loop = normalizeLoop(c.loop ?? 1)
  // 淡入/淡出钳到线段在时间轴上的总占用时长内（无限循环不设上限）
  const placedMs = loop === 'infinite' ? Infinity : ((sourceOut - sourceIn) / speed) * loop
  return {
    kind: c.kind,
    path: c.path,
    name: c.name,
    start: Math.max(0, c.start),
    sourceDuration: c.sourceDuration,
    sourceIn,
    sourceOut,
    speed,
    loop,
    layer: Math.max(0, Math.round(c.layer ?? 0)),
    tx: c.tx ?? 0,
    ty: c.ty ?? 0,
    scale: c.scale && c.scale > 0 ? c.scale : 1,
    fadeInMs: Math.min(placedMs, Math.max(0, Math.round(c.fadeInMs ?? 0))),
    fadeOutMs: Math.min(placedMs, Math.max(0, Math.round(c.fadeOutMs ?? 0))),
    transIn: normTransition(c.transIn),
    transOut: normTransition(c.transOut)
  }
}

/** 规范化视频转场：类型非法或时长 ≤0 → null */
function normTransition(t: VideoTransition | null | undefined): VideoTransition | null {
  if (!t || !VIDEO_TRANSITIONS.includes(t.type) || !(t.durationMs > 0)) return null
  return { type: t.type, durationMs: Math.round(t.durationMs) }
}

/**
 * tMs 时刻该音轨的淡入/淡出增益 0..1（线性）。
 * 线段外或无淡入淡出返回 1。淡入从线段起点、淡出到线段结束（含无限循环到项目结束）。
 */
export function clipGain(clip: MediaClip, tMs: number, projectEndMs: number): number {
  const fin = clip.fadeInMs ?? 0
  const fout = clip.fadeOutMs ?? 0
  if (fin <= 0 && fout <= 0) return 1
  const end = clipEnd(clip, projectEndMs)
  if (tMs < clip.start || tMs >= end) return 1
  let g = 1
  if (fin > 0) g = Math.min(g, (tMs - clip.start) / fin)
  if (fout > 0) g = Math.min(g, (end - tMs) / fout)
  return Math.max(0, Math.min(1, g))
}

/** 视频转场对绘制的修正：透明度、平移（占画布比例）、额外缩放、擦除遮罩 */
export interface VideoClipFx {
  alpha: number
  /** 画布宽/高的比例平移 */
  dxFrac: number
  dyFrac: number
  /** 乘到线段自身 scale 之上的额外缩放 */
  scale: number
  /** 擦除遮罩：从某侧揭示 reveal∈[0,1] 比例；null = 不裁剪 */
  wipe: { dir: 'L' | 'R' | 'U' | 'D'; reveal: number } | null
}

const IDENTITY_CLIP_FX: VideoClipFx = { alpha: 1, dxFrac: 0, dyFrac: 0, scale: 1, wipe: null }

/** 进场姿态：p 为进场进度 0→1（1 = 完全到位） */
function fxIn(type: VideoTransitionType, p: number): VideoClipFx {
  const off = 1 - p
  switch (type) {
    case 'fade':
      return { ...IDENTITY_CLIP_FX, alpha: p }
    case 'slideL':
      return { ...IDENTITY_CLIP_FX, dxFrac: -off }
    case 'slideR':
      return { ...IDENTITY_CLIP_FX, dxFrac: off }
    case 'slideU':
      return { ...IDENTITY_CLIP_FX, dyFrac: -off }
    case 'slideD':
      return { ...IDENTITY_CLIP_FX, dyFrac: off }
    case 'zoom':
      return { ...IDENTITY_CLIP_FX, alpha: p, scale: 1.3 - 0.3 * p }
    case 'wipeL':
      return { ...IDENTITY_CLIP_FX, wipe: { dir: 'L', reveal: p } }
    case 'wipeR':
      return { ...IDENTITY_CLIP_FX, wipe: { dir: 'R', reveal: p } }
  }
}

/** 退场姿态：p 为剩余呈现度 1→0（1 = 仍完整，0 = 已离场） */
function fxOut(type: VideoTransitionType, p: number): VideoClipFx {
  const off = 1 - p
  switch (type) {
    case 'fade':
      return { ...IDENTITY_CLIP_FX, alpha: p }
    case 'slideL':
      return { ...IDENTITY_CLIP_FX, dxFrac: -off }
    case 'slideR':
      return { ...IDENTITY_CLIP_FX, dxFrac: off }
    case 'slideU':
      return { ...IDENTITY_CLIP_FX, dyFrac: -off }
    case 'slideD':
      return { ...IDENTITY_CLIP_FX, dyFrac: off }
    case 'zoom':
      return { ...IDENTITY_CLIP_FX, alpha: p, scale: 1 + 0.3 * off }
    case 'wipeL':
      return { ...IDENTITY_CLIP_FX, wipe: { dir: 'L', reveal: p } }
    case 'wipeR':
      return { ...IDENTITY_CLIP_FX, wipe: { dir: 'R', reveal: p } }
  }
}

/**
 * tMs 时刻该视频线段的转场绘制修正。进场窗口 [start, start+inDur]、
 * 退场窗口 [end-outDur, end]；窗口外或无转场返回恒等。
 */
export function clipTransition(clip: MediaClip, tMs: number, projectEndMs: number): VideoClipFx {
  const ti = clip.transIn
  const to = clip.transOut
  if ((!ti || ti.durationMs <= 0) && (!to || to.durationMs <= 0)) return IDENTITY_CLIP_FX
  const end = clipEnd(clip, projectEndMs)
  if (tMs < clip.start || tMs >= end) return IDENTITY_CLIP_FX
  if (ti && ti.durationMs > 0 && tMs < clip.start + ti.durationMs) {
    return fxIn(ti.type, easeOutCubic(clamp01((tMs - clip.start) / ti.durationMs)))
  }
  if (to && to.durationMs > 0 && tMs > end - to.durationMs) {
    return fxOut(to.type, easeOutCubic(clamp01((end - tMs) / to.durationMs)))
  }
  return IDENTITY_CLIP_FX
}

/** 一圈在时间轴上占的毫秒数（修剪区间 ÷ 速度） */
export function clipSegmentMs(clip: MediaClip): number {
  return Math.max(1, (clip.sourceOut - clip.sourceIn) / clip.speed)
}

/** 线段在时间轴上的结束 ms；无限循环时取项目结束（projectEndMs） */
export function clipEnd(clip: MediaClip, projectEndMs: number): number {
  if (clip.loop === 'infinite') return Math.max(projectEndMs, clip.start)
  return clip.start + clipSegmentMs(clip) * clip.loop
}

/**
 * tMs 时刻该线段的源媒体时间 ms（已含循环取模、修剪偏移与变速）；
 * 不在线段时间范围内返回 null。
 */
export function clipSourceTime(clip: MediaClip, tMs: number, projectEndMs: number): number | null {
  if (clip.sourceOut <= clip.sourceIn) return null
  if (tMs < clip.start || tMs >= clipEnd(clip, projectEndMs)) return null
  const seg = clipSegmentMs(clip)
  return clip.sourceIn + ((tMs - clip.start) % seg) * clip.speed
}

/** 有限线段中最晚的结束 ms（无限循环线段不决定项目时长） */
export function clipsDuration(clips: MediaClip[]): number {
  let end = 0
  for (const c of clips) {
    if (c.loop !== 'infinite') end = Math.max(end, clipEnd(c, 0))
  }
  return end
}

/** 线段左右平移（不允许移到 0 之前） */
export function shiftClip(clip: MediaClip, deltaMs: number): MediaClip {
  const d = Math.max(deltaMs, -clip.start)
  return d === 0 ? clip : { ...clip, start: Math.round(clip.start + d) }
}

/**
 * 把多圈循环按圈展开成 loop=1 的线段序列（无限循环展开到 projectEndMs，
 * 最后一段按项目结束裁出点）。loop=1 时原样返回单元素数组。
 */
export function explodeLoops(clip: MediaClip, projectEndMs: number): Omit<MediaClip, 'id'>[] {
  const { id: _id, ...base } = clip
  if (clip.loop === 1) return [base]
  const seg = clipSegmentMs(clip)
  const endMs = clipEnd(clip, projectEndMs)
  const out: Omit<MediaClip, 'id'>[] = []
  for (let s = clip.start; s < endMs; s += seg) {
    const pieceEnd = Math.min(s + seg, endMs)
    out.push({
      ...base,
      start: Math.round(s),
      loop: 1,
      // 末段可能被项目结束截短：调整源出点保持画面内容一致
      sourceOut:
        pieceEnd < s + seg
          ? Math.round(clip.sourceIn + (pieceEnd - s) * clip.speed)
          : clip.sourceOut
    })
  }
  return out
}

/**
 * 在 tMs 处切开线段：返回替换原线段的新线段列表（无 id，由 store 重新分配）；
 * tMs 不在线段内部时返回 null。循环线段先按圈展开再切。
 */
export function splitClipAt(
  clip: MediaClip,
  tMs: number,
  projectEndMs: number
): Omit<MediaClip, 'id'>[] | null {
  const end = clipEnd(clip, projectEndMs)
  if (tMs <= clip.start || tMs >= end) return null
  const pieces = explodeLoops(clip, projectEndMs)
  const out: Omit<MediaClip, 'id'>[] = []
  for (const p of pieces) {
    const pSeg = Math.max(1, (p.sourceOut - p.sourceIn) / p.speed)
    const pEnd = p.start + pSeg
    if (tMs <= p.start || tMs >= pEnd) {
      out.push(p)
      continue
    }
    const cutSrc = Math.round(p.sourceIn + (tMs - p.start) * p.speed)
    out.push({ ...p, sourceOut: cutSrc })
    out.push({ ...p, start: Math.round(tMs), sourceIn: cutSrc })
  }
  return out
}
