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
  /** 转场类型 id：内置（见 VIDEO_TRANSITIONS）或插件注册的 id */
  type: string
  durationMs: number
}

export interface MediaClip {
  id: number
  kind: 'video' | 'audio'
  /** 源文件绝对路径 */
  path: string
  /** Original user-selected path. `path` may point at a disposable compatibility proxy. */
  sourcePath?: string
  /** Missing files stay in the project so they can be relinked instead of silently disappearing. */
  offline?: boolean
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
  /** 视频画面旋转（度，绕画面矩形中心），音频忽略；缺省 0 = 不旋转 */
  rotate: number
  /** 音频淡入时长 ms（从线段起点起，0 = 无）；视频忽略 */
  fadeInMs: number
  /** 音频淡出时长 ms（到线段结束处止，0 = 无）；视频忽略 */
  fadeOutMs: number
  /** Per-clip audio gain. Applied to audio clips and to video clips that contain audio. */
  volume?: number
  /** 视频进场转场（null = 无）；音频忽略。视频间转场靠重叠两段 + 后一段 transIn 实现 */
  transIn?: VideoTransition | null
  /** 视频退场转场（null = 无）；音频忽略 */
  transOut?: VideoTransition | null
}

/** 媒体线段最大层序（视频/音频共用）；层 0 为最底 */
export const MAX_LAYER = 4

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
  const sourceDuration = Math.max(0, Number.isFinite(c.sourceDuration) ? c.sourceDuration : 0)
  const sourceIn = Math.min(Math.max(0, sourceDuration - 1), Math.max(0, c.sourceIn ?? 0))
  const sourceOut = Math.min(sourceDuration, Math.max(Math.min(sourceDuration, sourceIn + 1), c.sourceOut ?? sourceDuration))
  const speed = clampSpeed(c.speed ?? 1)
  const loop = normalizeLoop(c.loop ?? 1)
  // 淡入/淡出钳到线段在时间轴上的总占用时长内（无限循环不设上限）
  const placedMs = loop === 'infinite' ? Infinity : ((sourceOut - sourceIn) / speed) * loop
  return {
    kind: c.kind,
    path: c.path,
    sourcePath: c.sourcePath ?? c.path,
    offline: c.offline ?? false,
    name: c.name,
    start: Math.max(0, c.start),
    sourceDuration,
    sourceIn,
    sourceOut,
    speed,
    loop,
    layer: Math.min(MAX_LAYER, Math.max(0, Math.round(c.layer ?? 0))),
    tx: c.tx ?? 0,
    ty: c.ty ?? 0,
    scale: c.scale && c.scale > 0 ? c.scale : 1,
    rotate: c.rotate ?? 0,
    fadeInMs: Math.min(placedMs, Math.max(0, Math.round(c.fadeInMs ?? 0))),
    fadeOutMs: Math.min(placedMs, Math.max(0, Math.round(c.fadeOutMs ?? 0))),
    volume: Math.min(1, Math.max(0, Number.isFinite(c.volume) ? Number(c.volume) : 1)),
    transIn: normTransition(c.transIn),
    transOut: normTransition(c.transOut)
  }
}

/**
 * 规范化视频转场：要求非空字符串 type 且时长 >0；否则 null。
 * 不强制 type 必须已注册——插件转场可能在工程加载后才注册，先留住数据，
 * 渲染时 clipTransition 查不到该 type 即回退恒等（插件载入后自然生效）。
 */
function normTransition(t: VideoTransition | null | undefined): VideoTransition | null {
  if (!t || typeof t.type !== 'string' || t.type.length === 0 || !(t.durationMs > 0)) return null
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

/* ---- 视频转场注册表（内置 + 插件）---- */

/** 一个视频转场实现：进场 in(p) / 退场 out(p)，p 见 fxIn/fxOut 语义 */
export interface VideoTransitionImpl {
  id: string
  name: string
  in(p: number): VideoClipFx
  out(p: number): VideoClipFx
}

/** 内置转场显示名 */
const BUILTIN_NAMES: Record<VideoTransitionType, string> = {
  fade: '淡入淡出',
  slideL: '左滑',
  slideR: '右滑',
  slideU: '上滑',
  slideD: '下滑',
  zoom: '缩放',
  wipeL: '左擦',
  wipeR: '右擦'
}

const videoTransitionRegistry = new Map<string, VideoTransitionImpl>()

/** 注册（或覆盖）一个视频转场实现 */
export function registerVideoTransition(impl: VideoTransitionImpl): void {
  videoTransitionRegistry.set(impl.id, impl)
}

export function getVideoTransition(id: string): VideoTransitionImpl | undefined {
  return videoTransitionRegistry.get(id)
}

/** 当前可用的全部转场（内置 + 插件），供选择器展示 */
export function videoTransitionList(): { id: string; name: string }[] {
  return [...videoTransitionRegistry.values()].map(({ id, name }) => ({ id, name }))
}

// 注册 8 个内置转场（沿用 fxIn/fxOut 实现）
for (const t of VIDEO_TRANSITIONS) {
  registerVideoTransition({ id: t, name: BUILTIN_NAMES[t], in: (p) => fxIn(t, p), out: (p) => fxOut(t, p) })
}

/**
 * tMs 时刻该视频线段的转场绘制修正。进场窗口 [start, start+inDur]、
 * 退场窗口 [end-outDur, end]；窗口外、无转场或 type 未注册返回恒等。
 * ignoreIn=true 时跳过进场（junction 转场把 transIn 挪到前一段尾部播放，本段自身不再重复进场）。
 */
export function clipTransition(clip: MediaClip, tMs: number, projectEndMs: number, ignoreIn = false): VideoClipFx {
  const ti = ignoreIn ? null : clip.transIn
  const to = clip.transOut
  if ((!ti || ti.durationMs <= 0) && (!to || to.durationMs <= 0)) return IDENTITY_CLIP_FX
  const end = clipEnd(clip, projectEndMs)
  if (tMs < clip.start || tMs >= end) return IDENTITY_CLIP_FX
  if (ti && ti.durationMs > 0 && tMs < clip.start + ti.durationMs) {
    return getVideoTransition(ti.type)?.in(easeOutCubic(clamp01((tMs - clip.start) / ti.durationMs))) ?? IDENTITY_CLIP_FX
  }
  if (to && to.durationMs > 0 && tMs > end - to.durationMs) {
    return getVideoTransition(to.type)?.out(easeOutCubic(clamp01((end - tMs) / to.durationMs))) ?? IDENTITY_CLIP_FX
  }
  return IDENTITY_CLIP_FX
}

/* ---- 相邻视频线段之间的过渡（junction）----
 * 两段同层视频首尾相接（A.end === B.start）时，B 的 transIn 不再从黑场进场，而是作为
 * A→B 的过渡：在 A 的尾部窗口 [B.start−d, B.start] 里，B 冻结在首帧、按 transIn.in 姿态叠加
 * 绘制在 A（仍在自己窗口内正常播放）之上——fade = 交叉淡化，slide/wipe/zoom = 覆盖进入。
 */

/** 本视频线段相对其前一相邻线段的过渡时长 ms（夹到两段可用长度内）；无相邻前段或无 transIn 时 0。 */
export function junctionLeadMs(clip: MediaClip, clips: readonly MediaClip[]): number {
  if (clip.kind !== 'video') return 0
  const ti = clip.transIn
  if (!ti || !(ti.durationMs > 0)) return 0
  const prev = clips.find(
    (o) =>
      o.id !== clip.id &&
      o.kind === 'video' &&
      o.layer === clip.layer &&
      o.loop !== 'infinite' &&
      clipEnd(o, 0) === clip.start
  )
  if (!prev) return 0
  const prevLen = clipEnd(prev, 0) - prev.start
  const selfLen = clip.loop === 'infinite' ? Infinity : clipEnd(clip, 0) - clip.start
  return Math.max(0, Math.min(ti.durationMs, prevLen, selfLen))
}

/**
 * 渲染用源时间：正常窗口内 = clipSourceTime；junction 预卷窗口 [start−lead, start) 内冻结在首帧
 * （sourceIn）；两者都不在时返回 null。
 */
export function clipRenderSourceTime(
  clip: MediaClip,
  tMs: number,
  projectEndMs: number,
  leadMs: number
): number | null {
  const normal = clipSourceTime(clip, tMs, projectEndMs)
  if (normal !== null) return normal
  if (leadMs > 0 && tMs >= clip.start - leadMs && tMs < clip.start) return clip.sourceIn
  return null
}

/** junction 预卷窗口内该视频线段的入场姿态（叠加在前一段之上）；窗口外恒等。 */
export function junctionInFxAt(clip: MediaClip, tMs: number, leadMs: number): VideoClipFx {
  if (leadMs <= 0 || tMs < clip.start - leadMs || tMs >= clip.start) return IDENTITY_CLIP_FX
  const ti = clip.transIn
  if (!ti) return IDENTITY_CLIP_FX
  const p = easeOutCubic(clamp01((tMs - (clip.start - leadMs)) / leadMs))
  return getVideoTransition(ti.type)?.in(p) ?? IDENTITY_CLIP_FX
}

/** 把部分 VideoClipFx 合并到恒等并钳制（插件转场用） */
export function sanitizeVideoFx(p: Partial<VideoClipFx> | null | undefined): VideoClipFx {
  if (!p || typeof p !== 'object') return { ...IDENTITY_CLIP_FX }
  const n = (v: unknown, f: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : f)
  let wipe: VideoClipFx['wipe'] = null
  if (p.wipe && typeof p.wipe === 'object' && ['L', 'R', 'U', 'D'].includes((p.wipe as { dir: string }).dir)) {
    wipe = { dir: (p.wipe as { dir: 'L' | 'R' | 'U' | 'D' }).dir, reveal: clamp01(n((p.wipe as { reveal: number }).reveal, 1)) }
  }
  return {
    alpha: clamp01(n(p.alpha, 1)),
    dxFrac: n(p.dxFrac, 0),
    dyFrac: n(p.dyFrac, 0),
    scale: Math.max(0, n(p.scale, 1)),
    wipe
  }
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
 * 同层视频线段不重叠：把 desiredStart 夹到「不与任何邻居重叠、且不越过邻居」的位置——
 * 拖过头就贴着邻居边缘停住（bounce/stick）。
 * neighbors：同层其它视频线段的 [start, end] 区间；origStart：拖拽起点位置；len：本段时间轴长度。
 * 只限制本段所在的那段空隙（由起点位置决定的左右邻居），因此不能拖着穿过邻居换位。
 */
export function clampStartNoOverlap(
  neighbors: readonly (readonly [number, number])[],
  origStart: number,
  len: number,
  desiredStart: number
): number {
  let lo = 0
  let hi = Infinity
  const origCenter = origStart + len / 2
  for (const [ns, ne] of neighbors) {
    if (ne <= origStart) lo = Math.max(lo, ne) // 完全在左侧的邻居
    else if (ns >= origStart + len) hi = Math.min(hi, ns) // 完全在右侧的邻居
    else if ((ns + ne) / 2 < origCenter) lo = Math.max(lo, ne) // 预存重叠（旧工程）：按中心分侧
    else hi = Math.min(hi, ns)
  }
  const maxStart = hi === Infinity ? Infinity : hi - len
  return Math.max(0, Math.min(Math.max(desiredStart, lo), maxStart))
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
