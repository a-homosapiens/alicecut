import { create } from 'zustand'
import type { LrcLine, LrcMeta } from '../core/types'
import { parseLrc } from '../core/lrc'
import { rebuildLineText, lyricsDuration, shiftLine, retimeLine } from '../core/timing'
import { invalidateLayoutCache, type RenderStyle } from '../core/render'

export type AspectId = '9:16' | '16:9' | '1:1'

export const RESOLUTIONS: Record<AspectId, { width: number; height: number; label: string }> = {
  '9:16': { width: 1080, height: 1920, label: '竖屏 9:16 (1080×1920)' },
  '16:9': { width: 1920, height: 1080, label: '横屏 16:9 (1920×1080)' },
  '1:1': { width: 1080, height: 1080, label: '方形 1:1 (1080×1080)' }
}

export interface StyleState {
  aspect: AspectId
  fontFamily: string
  fontWeight: number
  fontSize: number
  textColor: string
  glowColor: string
  bgType: 'solid' | 'gradient'
  bgFrom: string
  bgTo: string
  bgAngle: number
  effectId: string
  intensity: number
  showMeta: boolean
}

export interface AudioInfo {
  path: string
  name: string
  url: string
  duration: number
}

interface ProjectState {
  meta: LrcMeta
  lines: LrcLine[]
  lrcName: string | null
  audio: AudioInfo | null
  style: StyleState
  /** 秒，UI 时间轴 */
  currentTime: number
  playing: boolean
  exporting: boolean
  /** 时间轴上选中的歌词线段 id */
  selectedIds: number[]

  loadLrc(text: string, name: string): void
  hydrate(data: { meta: LrcMeta; lines: LrcLine[]; style: StyleState; lrcName: string | null }): void
  setAudio(audio: AudioInfo | null): void
  updateLineText(id: number, text: string): void
  patchStyle(patch: Partial<StyleState>): void
  setCurrentTime(t: number): void
  setPlaying(p: boolean): void
  setExporting(e: boolean): void

  setSelection(ids: number[]): void
  toggleSelected(id: number): void
  selectAll(): void
  clearSelection(): void
  /** 给选中行设置特效；null = 恢复跟随全局默认 */
  setLineEffect(ids: number[], effectId: string | null): void
  /** 线段整体左右挪动：从拖拽起始快照 originals 平移 deltaMs */
  moveLinesFrom(originals: LrcLine[], deltaMs: number): void
  /** 线段边缘微调：从拖拽起始快照重设起止时间 */
  retimeLineFrom(original: LrcLine, newStart: number, newEnd: number): void
  /** 画布拖拽：从起始偏移快照平移选中行的画面位置 */
  setLineOffsetsFrom(originals: { id: number; dx: number; dy: number }[], ddx: number, ddy: number): void
}

/** 按 start 排序（渲染器和时间轴都依赖有序） */
function sortLines(lines: LrcLine[]): LrcLine[] {
  return [...lines].sort((a, b) => a.start - b.start)
}

/** 合并替换若干行（按 id），并保持排序 */
function mergeLines(lines: LrcLine[], replaced: LrcLine[]): LrcLine[] {
  const byId = new Map(replaced.map((l) => [l.id, l]))
  return sortLines(lines.map((l) => byId.get(l.id) ?? l))
}

export const useProject = create<ProjectState>((set, get) => ({
  meta: { offset: 0 },
  lines: [],
  lrcName: null,
  audio: null,
  style: {
    aspect: '9:16',
    fontFamily: 'Microsoft YaHei',
    fontWeight: 700,
    fontSize: 88,
    textColor: '#ffffff',
    glowColor: '#7dd3fc',
    bgType: 'gradient',
    bgFrom: '#0f0c29',
    bgTo: '#24243e',
    bgAngle: 160,
    effectId: 'pop',
    intensity: 1,
    showMeta: true
  },
  currentTime: 0,
  playing: false,
  exporting: false,
  selectedIds: [],

  loadLrc(text, name) {
    const parsed = parseLrc(text)
    invalidateLayoutCache()
    set({ meta: parsed.meta, lines: parsed.lines, lrcName: name, currentTime: 0, selectedIds: [] })
  },

  hydrate(data) {
    invalidateLayoutCache()
    // 兼容旧版工程文件：补齐行级字段默认值
    const lines = sortLines(
      data.lines.map((l) => ({ ...l, effectId: l.effectId ?? null, dx: l.dx ?? 0, dy: l.dy ?? 0 }))
    )
    set({
      meta: data.meta,
      lines,
      style: { ...get().style, ...data.style },
      lrcName: data.lrcName,
      currentTime: 0,
      playing: false,
      selectedIds: []
    })
  },

  setAudio(audio) {
    set({ audio })
  },

  updateLineText(id, text) {
    invalidateLayoutCache()
    set({ lines: get().lines.map((l) => (l.id === id ? rebuildLineText(l, text) : l)) })
  },

  patchStyle(patch) {
    invalidateLayoutCache()
    set({ style: { ...get().style, ...patch } })
  },

  setCurrentTime(t) {
    set({ currentTime: t })
  },
  setPlaying(p) {
    set({ playing: p })
  },
  setExporting(e) {
    set({ exporting: e })
  },

  setSelection(ids) {
    set({ selectedIds: ids })
  },
  toggleSelected(id) {
    const cur = get().selectedIds
    set({ selectedIds: cur.includes(id) ? cur.filter((i) => i !== id) : [...cur, id] })
  },
  selectAll() {
    set({ selectedIds: get().lines.map((l) => l.id) })
  },
  clearSelection() {
    set({ selectedIds: [] })
  },

  setLineEffect(ids, effectId) {
    const idSet = new Set(ids)
    set({ lines: get().lines.map((l) => (idSet.has(l.id) ? { ...l, effectId } : l)) })
  },

  moveLinesFrom(originals, deltaMs) {
    // 组内统一钳制，保持相对间距：最早的行不能移到 0 之前
    const minStart = Math.min(...originals.map((l) => l.start))
    const d = Math.max(deltaMs, -minStart)
    set({ lines: mergeLines(get().lines, originals.map((l) => shiftLine(l, d))) })
  },

  retimeLineFrom(original, newStart, newEnd) {
    set({ lines: mergeLines(get().lines, [retimeLine(original, newStart, newEnd)]) })
  },

  setLineOffsetsFrom(originals, ddx, ddy) {
    const byId = new Map(originals.map((o) => [o.id, o]))
    set({
      lines: get().lines.map((l) => {
        const o = byId.get(l.id)
        return o ? { ...l, dx: Math.round(o.dx + ddx), dy: Math.round(o.dy + ddy) } : l
      })
    })
  }
}))

/** 项目总时长（秒）：有音频取音频时长，否则按歌词推算 */
export function getProjectDuration(s: { lines: LrcLine[]; audio: AudioInfo | null }): number {
  if (s.audio && s.audio.duration > 0) return s.audio.duration
  return lyricsDuration(s.lines) / 1000
}

/** 把 store 样式转成渲染器需要的完整样式 */
export function toRenderStyle(style: StyleState): RenderStyle {
  const res = RESOLUTIONS[style.aspect]
  return {
    width: res.width,
    height: res.height,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontSize: style.fontSize,
    textColor: style.textColor,
    glowColor: style.glowColor,
    bgType: style.bgType,
    bgFrom: style.bgFrom,
    bgTo: style.bgTo,
    bgAngle: style.bgAngle,
    effectId: style.effectId,
    intensity: style.intensity,
    showMeta: style.showMeta
  }
}
