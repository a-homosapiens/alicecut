/** 媒体线段（背景视频 / 音轨）：纯数据 + 时间计算，预览与导出共用 */

export type LoopSpec = number | 'infinite'

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
  return {
    kind: c.kind,
    path: c.path,
    name: c.name,
    start: Math.max(0, c.start),
    sourceDuration: c.sourceDuration,
    sourceIn,
    sourceOut: Math.min(c.sourceDuration, Math.max(sourceIn + 1, c.sourceOut ?? c.sourceDuration)),
    speed: clampSpeed(c.speed ?? 1),
    loop: normalizeLoop(c.loop ?? 1),
    layer: Math.max(0, Math.round(c.layer ?? 0)),
    tx: c.tx ?? 0,
    ty: c.ty ?? 0,
    scale: c.scale && c.scale > 0 ? c.scale : 1
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
