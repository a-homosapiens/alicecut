import { create } from 'zustand'
import type { LrcLine, LrcMeta } from '../core/types'
import { parseCaptions, repaginateLines } from '../core/subtitles'
import { rebuildLineText, lyricsDuration, shiftLine, retimeLine } from '../core/timing'
import {
  clampSpeed,
  clipsDuration,
  normalizeLoop,
  shiftClip,
  splitClipAt,
  withClipDefaults,
  type LoopSpec,
  type MediaClip,
  type VideoTransition
} from '../core/media'
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
  /** 卡拉OK高亮色（当前词染色） */
  highlightColor: string
  /** 背景类型：纯色 / 渐变 / 图片 */
  bgType: 'solid' | 'gradient' | 'image'
  bgFrom: string
  bgTo: string
  bgAngle: number
  /** 背景图片绝对路径（bgType='image' 时使用）；null = 未选 */
  bgImage: string | null
  effectId: string
  intensity: number
  showMeta: boolean
  /** 全局文字变换：所有文字一起平移（画布像素）与旋转（度），绕画面中心 */
  globalDx: number
  globalDy: number
  globalRotate: number
  /** 文字不透明度 0–1 */
  textAlpha: number
  italic: boolean
  /** 文字底色块颜色；不透明度 0 = 无底色 */
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

interface ProjectState {
  meta: LrcMeta
  lines: LrcLine[]
  lrcName: string | null
  /** 媒体线段：背景视频 + 音轨 */
  clips: MediaClip[]
  style: StyleState
  /** 秒，UI 时间轴 */
  currentTime: number
  playing: boolean
  exporting: boolean
  /** 时间轴上选中的歌词线段 id */
  selectedIds: number[]
  /** 时间轴上选中的媒体线段 id */
  selectedClipId: number | null

  /** 已导入的插件文字特效（仅 id/name，函数体在 effects 注册表里） */
  pluginEffects: { id: string; name: string }[]
  /** 登记新导入的插件特效（去重） */
  addPluginEffects(list: { id: string; name: string }[]): void
  loadLrc(text: string, name: string): void
  /** 按"每页时长阈值"重新分页（整句 ↔ 逐词）；重置行级特效/位置 */
  repaginate(combineWithinMs: number): void
  hydrate(data: { meta: LrcMeta; lines: LrcLine[]; style: StyleState; lrcName: string | null }): void
  /** 加入媒体线段；缺省字段（trim/speed/layer/变换等）自动补默认值 */
  addClip(clip: Parameters<typeof withClipDefaults>[0]): MediaClip
  removeClip(id: number): void
  /** 媒体线段左右挪动：从拖拽起始快照平移 deltaMs */
  moveClipFrom(original: MediaClip, deltaMs: number): void
  setClipStart(id: number, startMs: number): void
  setClipLoop(id: number, loop: LoopSpec): void
  setClipSpeed(id: number, speed: number): void
  setClipLayer(id: number, layer: number): void
  /** 设置音轨淡入/淡出时长 ms（钳到线段时间轴占用时长内） */
  setClipFade(id: number, patch: { in?: number; out?: number }): void
  /** 设置视频进/退场转场（null = 清除） */
  setClipTransition(id: number, which: 'in' | 'out', trans: VideoTransition | null): void
  /** 视频画面变换：从拖拽起始快照平移 / 直接设缩放 */
  setClipTransformFrom(original: { id: number; tx: number; ty: number }, dtx: number, dty: number): void
  setClipScale(id: number, scale: number): void
  /** 在 tMs 处切开线段；切点在线段外则不动。返回是否切了 */
  splitClip(id: number, tMs: number): boolean
  setSelectedClip(id: number | null): void
  /** 在 startMs 处加一行字幕 / 一块独立文字 */
  addLineAt(startMs: number, kind: 'lyric' | 'text', text?: string): LrcLine
  removeLines(ids: number[]): void
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

function sortClips(clips: MediaClip[]): MediaClip[] {
  return [...clips].sort((a, b) => a.start - b.start)
}

let nextClipId = 1

/** 合并替换若干行（按 id），并保持排序 */
function mergeLines(lines: LrcLine[], replaced: LrcLine[]): LrcLine[] {
  const byId = new Map(replaced.map((l) => [l.id, l]))
  return sortLines(lines.map((l) => byId.get(l.id) ?? l))
}

export const useProject = create<ProjectState>((set, get) => ({
  meta: { offset: 0 },
  lines: [],
  lrcName: null,
  clips: [],
  style: {
    aspect: '9:16',
    fontFamily: 'Microsoft YaHei',
    fontWeight: 700,
    fontSize: 88,
    textColor: '#ffffff',
    glowColor: '#7dd3fc',
    highlightColor: '#ffd400',
    bgType: 'gradient',
    bgFrom: '#0f0c29',
    bgTo: '#24243e',
    bgAngle: 160,
    bgImage: null,
    effectId: 'pop',
    intensity: 1,
    showMeta: true,
    globalDx: 0,
    globalDy: 0,
    globalRotate: 0,
    textAlpha: 1,
    italic: false,
    textBgColor: '#000000',
    textBgAlpha: 0,
    halo: 0,
    shadowColor: '#000000',
    shadowAlpha: 0,
    shadowBlur: 8,
    shadowOffset: 4
  },
  currentTime: 0,
  playing: false,
  exporting: false,
  selectedIds: [],
  selectedClipId: null,
  pluginEffects: [],

  addPluginEffects(list) {
    const seen = new Set(get().pluginEffects.map((e) => e.id))
    const merged = [...get().pluginEffects, ...list.filter((e) => !seen.has(e.id))]
    set({ pluginEffects: merged })
  },

  loadLrc(text, name) {
    const parsed = parseCaptions(text, name)
    invalidateLayoutCache()
    set({ meta: parsed.meta, lines: parsed.lines, lrcName: name, currentTime: 0, selectedIds: [] })
  },

  repaginate(combineWithinMs) {
    const st = get()
    const lyric = st.lines.filter((l) => l.kind !== 'text')
    if (lyric.length === 0) return
    const textBlocks = st.lines.filter((l) => l.kind === 'text')
    // text 块 id 保留，重排的歌词行 id 顺延其后，保证全局唯一
    const maxTextId = textBlocks.reduce((m, l) => Math.max(m, l.id), -1)
    const repaged = repaginateLines(lyric, combineWithinMs).map((l, i) => ({ ...l, id: maxTextId + 1 + i }))
    invalidateLayoutCache()
    set({ lines: sortLines([...repaged, ...textBlocks]), selectedIds: [], selectedClipId: null })
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
      clips: [],
      currentTime: 0,
      playing: false,
      selectedIds: [],
      selectedClipId: null
    })
  },

  addClip(clip) {
    const full: MediaClip = { ...withClipDefaults(clip), id: nextClipId++ }
    set({ clips: sortClips([...get().clips, full]) })
    return full
  },

  removeClip(id) {
    set({
      clips: get().clips.filter((c) => c.id !== id),
      selectedClipId: get().selectedClipId === id ? null : get().selectedClipId
    })
  },

  moveClipFrom(original, deltaMs) {
    const moved = shiftClip(original, deltaMs)
    set({ clips: sortClips(get().clips.map((c) => (c.id === original.id ? moved : c))) })
  },

  setClipStart(id, startMs) {
    const start = Math.max(0, Math.round(startMs))
    set({ clips: sortClips(get().clips.map((c) => (c.id === id ? { ...c, start } : c))) })
  },

  setClipLoop(id, loop) {
    const norm = normalizeLoop(loop)
    set({ clips: get().clips.map((c) => (c.id === id ? { ...c, loop: norm } : c)) })
  },

  setClipSpeed(id, speed) {
    const s = clampSpeed(speed)
    set({ clips: get().clips.map((c) => (c.id === id ? { ...c, speed: s } : c)) })
  },

  setClipLayer(id, layer) {
    const l = Math.max(0, Math.round(layer))
    set({ clips: get().clips.map((c) => (c.id === id ? { ...c, layer: l } : c)) })
  },

  setClipFade(id, patch) {
    set({
      clips: get().clips.map((c) => {
        if (c.id !== id) return c
        const placedMs = c.loop === 'infinite' ? Infinity : ((c.sourceOut - c.sourceIn) / c.speed) * c.loop
        const clamp = (v: number): number => Math.min(placedMs, Math.max(0, Math.round(v)))
        return {
          ...c,
          fadeInMs: patch.in !== undefined ? clamp(patch.in) : c.fadeInMs,
          fadeOutMs: patch.out !== undefined ? clamp(patch.out) : c.fadeOutMs
        }
      })
    })
  },

  setClipTransition(id, which, trans) {
    const key = which === 'in' ? 'transIn' : 'transOut'
    set({ clips: get().clips.map((c) => (c.id === id ? { ...c, [key]: trans } : c)) })
  },

  setClipTransformFrom(original, dtx, dty) {
    set({
      clips: get().clips.map((c) =>
        c.id === original.id
          ? { ...c, tx: Math.round(original.tx + dtx), ty: Math.round(original.ty + dty) }
          : c
      )
    })
  },

  setClipScale(id, scale) {
    const s = Math.min(10, Math.max(0.1, scale))
    set({ clips: get().clips.map((c) => (c.id === id ? { ...c, scale: s } : c)) })
  },

  splitClip(id, tMs) {
    const st = get()
    const clip = st.clips.find((c) => c.id === id)
    if (!clip) return false
    const projectEndMs = Math.max(lyricsDuration(st.lines), clipsDuration(st.clips))
    const pieces = splitClipAt(clip, tMs, projectEndMs)
    if (!pieces) return false
    const withIds = pieces.map((p) => ({ ...p, id: nextClipId++ }))
    set({
      clips: sortClips([...st.clips.filter((c) => c.id !== id), ...withIds]),
      // 选中切点右侧那段，方便继续操作
      selectedClipId: withIds.find((p) => p.start === Math.round(tMs))?.id ?? withIds[0].id
    })
    return true
  },

  setSelectedClip(id) {
    set({ selectedClipId: id, ...(id !== null ? { selectedIds: [] } : {}) })
  },

  addLineAt(startMs, kind, text) {
    const st = get()
    const start = Math.max(0, Math.round(startMs))
    const end = start + (kind === 'text' ? 3000 : 2000)
    const content = text ?? (kind === 'text' ? '文字' : '新字幕')
    const bare: LrcLine = {
      id: st.lines.reduce((m, l) => Math.max(m, l.id), -1) + 1,
      start,
      end,
      text: '',
      words: [],
      effectId: null,
      dx: 0,
      dy: 0,
      ...(kind === 'text' ? { kind: 'text' as const } : {})
    }
    const line = rebuildLineText(bare, content)
    invalidateLayoutCache()
    set({ lines: sortLines([...st.lines, line]), selectedIds: [line.id], selectedClipId: null })
    return line
  },

  removeLines(ids) {
    const idSet = new Set(ids)
    invalidateLayoutCache()
    set({
      lines: get().lines.filter((l) => !idSet.has(l.id)),
      selectedIds: get().selectedIds.filter((i) => !idSet.has(i))
    })
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
    set({ selectedIds: ids, selectedClipId: null })
  },
  toggleSelected(id) {
    const cur = get().selectedIds
    set({
      selectedIds: cur.includes(id) ? cur.filter((i) => i !== id) : [...cur, id],
      selectedClipId: null
    })
  },
  selectAll() {
    set({ selectedIds: get().lines.map((l) => l.id), selectedClipId: null })
  },
  clearSelection() {
    set({ selectedIds: [], selectedClipId: null })
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

/** 项目总时长（秒）：歌词结尾与有限媒体线段结尾取较大者（无限循环线段不计入） */
export function getProjectDuration(s: { lines: LrcLine[]; clips: MediaClip[] }): number {
  return Math.max(lyricsDuration(s.lines), clipsDuration(s.clips)) / 1000
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
    highlightColor: style.highlightColor,
    bgType: style.bgType,
    bgFrom: style.bgFrom,
    bgTo: style.bgTo,
    bgAngle: style.bgAngle,
    bgImage: style.bgImage,
    effectId: style.effectId,
    intensity: style.intensity,
    showMeta: style.showMeta,
    globalDx: style.globalDx,
    globalDy: style.globalDy,
    globalRotate: style.globalRotate,
    textAlpha: style.textAlpha,
    italic: style.italic,
    textBgColor: style.textBgColor,
    textBgAlpha: style.textBgAlpha,
    halo: style.halo,
    shadowColor: style.shadowColor,
    shadowAlpha: style.shadowAlpha,
    shadowBlur: style.shadowBlur,
    shadowOffset: style.shadowOffset
  }
}
