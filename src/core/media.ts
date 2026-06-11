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
  /** 素材本身时长 ms */
  sourceDuration: number
  /** 重复次数（≥1）；'infinite' = 一直循环到项目结束 */
  loop: LoopSpec
}

/** 规范化 loop：非法值回退为 1，数字向下取整且至少 1 */
export function normalizeLoop(loop: unknown): LoopSpec {
  if (loop === 'infinite') return 'infinite'
  const n = Math.floor(Number(loop))
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** 线段在时间轴上的结束 ms；无限循环时取项目结束（projectEndMs） */
export function clipEnd(clip: MediaClip, projectEndMs: number): number {
  if (clip.loop === 'infinite') return Math.max(projectEndMs, clip.start)
  return clip.start + clip.sourceDuration * clip.loop
}

/**
 * tMs 时刻该线段的源媒体时间 ms（已含循环取模）；
 * 不在线段时间范围内返回 null。
 */
export function clipSourceTime(clip: MediaClip, tMs: number, projectEndMs: number): number | null {
  if (clip.sourceDuration <= 0) return null
  if (tMs < clip.start || tMs >= clipEnd(clip, projectEndMs)) return null
  return (tMs - clip.start) % clip.sourceDuration
}

/** 有限线段中最晚的结束 ms（无限循环线段不决定项目时长） */
export function clipsDuration(clips: MediaClip[]): number {
  let end = 0
  for (const c of clips) {
    if (c.loop !== 'infinite') end = Math.max(end, c.start + c.sourceDuration * c.loop)
  }
  return end
}

/** 线段左右平移（不允许移到 0 之前） */
export function shiftClip(clip: MediaClip, deltaMs: number): MediaClip {
  const d = Math.max(deltaMs, -clip.start)
  return d === 0 ? clip : { ...clip, start: Math.round(clip.start + d) }
}
