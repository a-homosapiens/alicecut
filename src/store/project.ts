import { create } from 'zustand'
import type { LrcLine, LrcMeta, LineTextOverride, CaptionTrack, ImageAsset } from '../core/types'
import { parseCaptions, repaginateLines } from '../core/subtitles'
import { rebuildLineText, lyricsDuration, shiftLine, retimeLine } from '../core/timing'
import {
  clampSpeed,
  clampStartNoOverlap,
  clipEnd,
  clipsDuration,
  normalizeLoop,
  splitClipAt,
  withClipDefaults,
  MAX_LAYER,
  type LoopSpec,
  type MediaClip,
  type VideoTransition
} from '../core/media'
import { invalidateLayoutCache, type RenderStyle } from '../core/render'
import type { Locale } from '../i18n'

/** 启动语言：先按系统语言猜，随后由主进程（持久化值）校正，避免首屏闪烁 */
const initialLocale: Locale =
  typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'

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
  letterSpacing: number
  wordSpacing: number
  lineSpacing: number
  textAlign: 'left' | 'center' | 'right'
  textOrientation: 'horizontal' | 'vertical'
  strokeColor: string
  strokeWidth: number
  strokeAlpha: number
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
  /** 背景图片缩放（1 = cover 铺满）与画布像素偏移（可拖动/调节） */
  bgImageScale: number
  bgImageX: number
  bgImageY: number
  /** 背景图片旋转（度，绕画面中心）；缺省 0 */
  bgImageRotate: number
  effectId: string
  /** 全局字幕 In / Out 特效时长（每行会按 segment 时长自动压缩避免重叠） */
  effectInDurationMs: number
  effectOutDurationMs: number
  intensity: number
  /** Rise effect: number of previous captions that remain parked above the current caption. */
  riseHistory: number
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

const STYLE_NUMBER_LIMITS: Partial<Record<keyof StyleState, readonly [number, number]>> = {
  fontWeight: [100, 900], fontSize: [8, 600], letterSpacing: [-50, 200], wordSpacing: [-50, 400],
  lineSpacing: [0.1, 10], strokeWidth: [0, 100], strokeAlpha: [0, 1], bgAngle: [-360, 360],
  bgImageScale: [0.05, 20], bgImageX: [-10000, 10000], bgImageY: [-10000, 10000],
  bgImageRotate: [-360, 360], effectInDurationMs: [0, 60000], effectOutDurationMs: [0, 60000],
  intensity: [0, 10], riseHistory: [0, 20], globalDx: [-10000, 10000], globalDy: [-10000, 10000],
  globalRotate: [-360, 360], textAlpha: [0, 1], textBgAlpha: [0, 1], halo: [0, 200],
  shadowAlpha: [0, 1], shadowBlur: [0, 200], shadowOffset: [-500, 500]
}

/** Runtime boundary for project files, console commands, and UI patches. */
export function normalizeStyle(base: StyleState, patch: unknown): StyleState {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const source = patch as Record<string, unknown>
  const out = { ...base }
  for (const [key, bounds] of Object.entries(STYLE_NUMBER_LIMITS) as [keyof StyleState, readonly [number, number]][]) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      ;(out as unknown as Record<string, unknown>)[key] = Math.min(bounds[1], Math.max(bounds[0], value))
    }
  }
  const strings: (keyof StyleState)[] = [
    'fontFamily', 'textColor', 'strokeColor', 'glowColor', 'highlightColor', 'bgFrom', 'bgTo', 'effectId',
    'textBgColor', 'shadowColor'
  ]
  for (const key of strings) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0 && value.length <= 500) {
      ;(out as unknown as Record<string, unknown>)[key] = value
    }
  }
  if (source.bgImage === null || (typeof source.bgImage === 'string' && source.bgImage.length <= 32768)) out.bgImage = source.bgImage
  if (source.aspect === '9:16' || source.aspect === '16:9' || source.aspect === '1:1') out.aspect = source.aspect
  if (source.textAlign === 'left' || source.textAlign === 'center' || source.textAlign === 'right') out.textAlign = source.textAlign
  if (source.textOrientation === 'horizontal' || source.textOrientation === 'vertical') out.textOrientation = source.textOrientation
  if (source.bgType === 'solid' || source.bgType === 'gradient' || source.bgType === 'image') out.bgType = source.bgType
  if (typeof source.showMeta === 'boolean') out.showMeta = source.showMeta
  if (typeof source.italic === 'boolean') out.italic = source.italic
  return out
}

function normalizeLinePatch(patch: Partial<LineTextOverride>): Partial<LineTextOverride> {
  const out: Record<string, unknown> = {}
  const source = patch as Record<string, unknown>
  const numeric: Record<string, readonly [number, number]> = {
    rotate: [-360, 360], fontSize: [8, 600], fontWeight: [100, 900], textAlpha: [0, 1],
    letterSpacing: [-50, 200], wordSpacing: [-50, 400], lineSpacing: [0.1, 10], strokeWidth: [0, 100],
    strokeAlpha: [0, 1], textBgAlpha: [0, 1], halo: [0, 200], shadowAlpha: [0, 1],
    shadowBlur: [0, 200], shadowOffset: [-500, 500]
  }
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      out[key] = undefined
      continue
    }
    const bounds = numeric[key]
    if (bounds && typeof value === 'number' && Number.isFinite(value)) {
      out[key] = Math.min(bounds[1], Math.max(bounds[0], value))
    } else if (key === 'italic' && typeof value === 'boolean') out[key] = value
    else if (key === 'textAlign' && (value === 'left' || value === 'center' || value === 'right')) out[key] = value
    else if (key === 'textOrientation' && (value === 'horizontal' || value === 'vertical')) out[key] = value
    else if (['fontFamily', 'textColor', 'strokeColor', 'textBgColor', 'glowColor', 'shadowColor'].includes(key) && typeof value === 'string' && value.length <= 500) out[key] = value
  }
  return out as Partial<LineTextOverride>
}

/** 撤销/重做的文档快照（只含可编辑文档字段；播放/选区/历史本身不计入） */
interface DocSnapshot {
  lines: LrcLine[]
  clips: MediaClip[]
  style: StyleState
  meta: LrcMeta
  lrcName: string | null
  tracks: CaptionTrack[]
  images: ImageAsset[]
  projectDurationSec: number | null
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
  /** True when the editable document differs from the last successful save/open. */
  dirty: boolean
  markSaved(): void
  /** Optional duration used when infinite media/backgrounds have no natural end. */
  projectDurationSec: number | null
  setProjectDurationSec(seconds: number | null): void

  /** 撤销/重做历史栈（文档快照：lines/clips/style/meta/lrcName） */
  past: DocSnapshot[]
  future: DocSnapshot[]
  undo(): void
  redo(): void

  /** 界面语言（应用级偏好，不写入工程文件；持久化在 localStorage） */
  locale: Locale
  /** 更新界面语言状态（持久化与告知主进程由调用方负责） */
  setLocale(locale: Locale): void
  /** 可用语言（内置 + 已安装语言包），驱动语言选择器刷新 */
  languages: { id: string; name: string }[]
  setLanguages(list: { id: string; name: string }[]): void
  /** 已导入的插件文字/整行特效（仅 id/name，函数体在 effects 注册表里） */
  pluginEffects: { id: string; name: string }[]
  /** 登记新导入的插件特效（去重） */
  addPluginEffects(list: { id: string; name: string }[]): void
  /** 已导入的插件视频转场（仅 id/name，实现在 media 注册表里），驱动时间轴转场菜单刷新 */
  pluginVideoTransitions: { id: string; name: string }[]
  addPluginVideoTransitions(list: { id: string; name: string }[]): void

  /** 额外字幕组（多语言字幕）：主字幕组（id 0）仍用 meta/lines/lrcName 存储，这里只存 id≥1 的 */
  tracks: CaptionTrack[]
  /** 新增一个字幕组；默认竖直位置依次向下错开，避免与已有字幕组重叠 */
  addTrack(name?: string): CaptionTrack
  /** 删除字幕组（含该组全部行）；主字幕组（id 0）不可删除，调用无效果 */
  removeTrack(id: number): void
  renameTrack(id: number, name: string): void
  setTrackOffsetY(id: number, y: number): void
  setTrackVisible(id: number, visible: boolean): void
  /** 非破坏性地把一份歌词/字幕载入指定字幕组（id 0 = 主字幕组）；只替换该组自己的行，
   *  不影响其它字幕组、独立文字块、撤销历史——与 loadLrc（整份重置）是两个不同用途的动作 */
  loadLrcToTrack(id: number, text: string, name: string): void

  /** 图片库（当前只用作背景图候选）：与字幕组/媒体线段一样是独立资源，不随 loadLrc 清空 */
  images: ImageAsset[]
  /** 登记一张图片；按路径去重，已存在则直接返回原记录 */
  addImage(path: string, name: string): ImageAsset
  /** 从图片库移除；若正是当前背景图，一并清空 style.bgImage */
  removeImage(id: number): void

  loadLrc(text: string, name: string): void
  /** 按"每页时长阈值"重新分页（整句 ↔ 逐词）；只影响 trackId 指定的字幕组，重置该组行级特效/位置 */
  repaginate(trackId: number, combineWithinMs: number): void
  hydrate(data: {
    meta: LrcMeta
    lines: LrcLine[]
    style: StyleState
    lrcName: string | null
    tracks?: CaptionTrack[]
    images?: ImageAsset[]
    clips?: (Partial<MediaClip> & Pick<MediaClip, 'kind' | 'path' | 'name' | 'start' | 'sourceDuration'>)[]
    projectDurationSec?: number | null
  }): void
  /** 加入媒体线段；缺省字段（trim/speed/layer/变换等）自动补默认值 */
  addClip(clip: Parameters<typeof withClipDefaults>[0]): MediaClip
  removeClip(id: number): void
  /** 媒体线段左右挪动：从拖拽起始快照平移 deltaMs */
  moveClipFrom(original: MediaClip, deltaMs: number): void
  setClipStart(id: number, startMs: number): void
  setClipLoop(id: number, loop: LoopSpec): void
  setClipSpeed(id: number, speed: number): void
  setClipLayer(id: number, layer: number): void
  setClipVolume(id: number, volume: number): void
  replaceClipMedia(id: number, path: string, sourcePath: string, sourceDuration: number): void
  /** 设置音轨淡入/淡出时长 ms（钳到线段时间轴占用时长内） */
  setClipFade(id: number, patch: { in?: number; out?: number }): void
  /** 设置视频进/退场转场（null = 清除） */
  setClipTransition(id: number, which: 'in' | 'out', trans: VideoTransition | null): void
  /** 视频画面变换：从拖拽起始快照平移 / 直接设缩放 */
  setClipTransformFrom(original: { id: number; tx: number; ty: number }, dtx: number, dty: number): void
  setClipScale(id: number, scale: number): void
  setClipRotate(id: number, deg: number): void
  /** 在 tMs 处切开线段；切点在线段外则不动。返回是否切了 */
  splitClip(id: number, tMs: number): boolean
  setSelectedClip(id: number | null): void
  /** 在 startMs 处加一行字幕 / 一块独立文字；trackId 缺省 = 主字幕组（0），仅 kind='lyric' 时有意义 */
  addLineAt(startMs: number, kind: 'lyric' | 'text', text?: string, trackId?: number): LrcLine
  removeLines(ids: number[]): void
  updateLineText(id: number, text: string): void
  patchStyle(patch: Partial<StyleState>): void
  /** 设置全局 In / Out 时长；后设置的一侧优先，另一侧按最短 segment 自动缩短 */
  setGlobalEffectDuration(which: 'in' | 'out', durationMs: number): void
  setCurrentTime(t: number): void
  setPlaying(p: boolean): void
  setExporting(e: boolean): void

  setSelection(ids: number[]): void
  toggleSelected(id: number): void
  selectAll(): void
  selectAllCaptions(): void
  clearSelection(): void
  /** 给选中行设置进场特效；null = 恢复跟随全局默认 */
  setLineEffect(ids: number[], effectId: string | null): void
  /** 给选中行设置退场特效；null = 默认淡出 */
  setLineEffectOut(ids: number[], effectOutId: string | null): void
  /** 给选中行设置 In / Out 时长覆盖；null = 跟随全局 */
  setLineEffectDuration(ids: number[], which: 'in' | 'out', durationMs: number | null): void
  /** 给选中行叠加文字属性覆盖（字体/字号/颜色…）；patch 中值为 undefined 的键表示清除该项覆盖 */
  patchLineOver(ids: number[], patch: Partial<LineTextOverride>): void
  /** 清除选中行的全部文字覆盖（恢复跟随全局样式） */
  clearLineOver(ids: number[]): void
  /** 设置独立文字块的层序（时间轴堆叠与绘制 z 序） */
  setLineLayer(id: number, layer: number): void
  /** 在 tMs 处把字幕/文字行切成两段（两段保留相同文本）；tMs 在区间外则不动 */
  splitLineAt(id: number, tMs: number): void
  /** 复制字幕/文字行：放到原行之后；文字块进新的文字层 */
  duplicateLine(id: number): void
  /** 复制媒体线段：放到同类新层、紧接原线段之后 */
  duplicateClip(id: number): void
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

/** 无限循环邻居的结束当作很远，视作占满其后（用于不重叠夹取） */
const NO_OVERLAP_FAR_MS = 1e12

/**
 * 视频线段同层不重叠时的目标起点：非视频/无限循环线段不受限（原样返回）。
 * 用线段「当前所在层」判定邻居（拖动中可能已换层）。
 */
function videoNoOverlapStart(clips: MediaClip[], clip: MediaClip, desiredStart: number): number {
  if (clip.kind !== 'video' || clip.loop === 'infinite') return desiredStart
  const layer = clips.find((c) => c.id === clip.id)?.layer ?? clip.layer
  const len = clipEnd(clip, 0) - clip.start
  const neighbors = clips
    .filter((c) => c.kind === 'video' && c.id !== clip.id && c.layer === layer)
    .map((c) => [c.start, clipEnd(c, NO_OVERLAP_FAR_MS)] as [number, number])
  return clampStartNoOverlap(neighbors, clip.start, len, desiredStart)
}

let nextClipId = 1

/** 合并替换若干行（按 id），并保持排序 */
function mergeLines(lines: LrcLine[], replaced: LrcLine[]): LrcLine[] {
  const byId = new Map(replaced.map((l) => [l.id, l]))
  return sortLines(lines.map((l) => byId.get(l.id) ?? l))
}

/** 全局最大行 id（跨全部字幕组 + 独立文字块），用于铸造新的全局唯一 id */
function maxLineId(lines: LrcLine[]): number {
  return lines.reduce((m, l) => Math.max(m, l.id), -1)
}

/** 主字幕组（id 0）用顶层 meta/lines/lrcName 存储，这里把它和额外字幕组拼成统一列表，
 *  供 UI/headless 一视同仁地遍历"全部字幕组" */
export function allCaptionTracks(s: { meta: LrcMeta; lrcName: string | null; tracks: CaptionTrack[] }): CaptionTrack[] {
  return [{ id: 0, name: '', lrcName: s.lrcName, meta: s.meta, offsetY: 0, visible: true }, ...s.tracks]
}

export const useProject = create<ProjectState>((set, get) => ({
  meta: { offset: 0 },
  lines: [],
  lrcName: null,
  tracks: [],
  images: [],
  clips: [],
  style: {
    aspect: '9:16',
    fontFamily: 'Microsoft YaHei',
    fontWeight: 700,
    fontSize: 88,
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
    highlightColor: '#ffd400',
    bgType: 'gradient',
    bgFrom: '#0f0c29',
    bgTo: '#24243e',
    bgAngle: 160,
    bgImage: null,
    bgImageScale: 1,
    bgImageX: 0,
    bgImageY: 0,
    bgImageRotate: 0,
    effectId: 'pop',
    effectInDurationMs: 480,
    effectOutDurationMs: 320,
    intensity: 1,
    riseHistory: 3,
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
  dirty: false,
  markSaved() {
    cleanSignature = docSignature(get())
    set({ dirty: false })
  },
  projectDurationSec: null,
  setProjectDurationSec(seconds) {
    const n = seconds == null ? null : Number(seconds)
    set({ projectDurationSec: n != null && Number.isFinite(n) && n > 0 ? Math.min(24 * 60 * 60, n) : null })
  },
  past: [],
  future: [],
  undo() {
    const { past } = get()
    if (past.length === 0) return
    const prev = past[past.length - 1]
    historySuspend = true
    invalidateLayoutCache()
    set({ ...prev, past: past.slice(0, -1), future: [snapshotDoc(get()), ...get().future], selectedIds: [], selectedClipId: null })
    set({ dirty: docSignature(get()) !== cleanSignature })
    historySuspend = false
  },
  redo() {
    const { future } = get()
    if (future.length === 0) return
    const next = future[0]
    historySuspend = true
    invalidateLayoutCache()
    set({ ...next, future: future.slice(1), past: [...get().past, snapshotDoc(get())], selectedIds: [], selectedClipId: null })
    set({ dirty: docSignature(get()) !== cleanSignature })
    historySuspend = false
  },
  locale: initialLocale,
  setLocale(locale) {
    set({ locale })
  },
  languages: [
    { id: 'zh', name: '中文' },
    { id: 'en', name: 'English' }
  ],
  setLanguages(list) {
    set({ languages: list })
  },
  pluginEffects: [],
  pluginVideoTransitions: [],

  addPluginEffects(list) {
    const seen = new Set(get().pluginEffects.map((e) => e.id))
    const merged = [...get().pluginEffects, ...list.filter((e) => !seen.has(e.id))]
    set({ pluginEffects: merged })
  },

  addPluginVideoTransitions(list) {
    const seen = new Set(get().pluginVideoTransitions.map((e) => e.id))
    const merged = [...get().pluginVideoTransitions, ...list.filter((e) => !seen.has(e.id))]
    set({ pluginVideoTransitions: merged })
  },

  addTrack(name = '') {
    const st = get()
    const id = Math.max(0, ...st.tracks.map((t) => t.id)) + 1
    const track: CaptionTrack = {
      id,
      name,
      lrcName: null,
      meta: { offset: 0 },
      // 依次向下错开，避免与已有字幕组（含主字幕组，始终 offsetY 0）重叠
      offsetY: Math.round((st.tracks.length + 1) * 2.4 * st.style.fontSize),
      visible: true
    }
    set({ tracks: [...st.tracks, track] })
    return track
  },

  removeTrack(id) {
    if (id === 0) return // 主字幕组不可删除
    const st = get()
    const removedIds = new Set(st.lines.filter((l) => l.kind !== 'text' && (l.trackId ?? 0) === id).map((l) => l.id))
    invalidateLayoutCache()
    set({
      tracks: st.tracks.filter((t) => t.id !== id),
      lines: st.lines.filter((l) => !removedIds.has(l.id)),
      selectedIds: st.selectedIds.filter((sid) => !removedIds.has(sid))
    })
  },

  renameTrack(id, name) {
    if (id === 0) return
    set({ tracks: get().tracks.map((t) => (t.id === id ? { ...t, name } : t)) })
  },

  setTrackOffsetY(id, y) {
    if (id === 0) return
    set({ tracks: get().tracks.map((t) => (t.id === id ? { ...t, offsetY: Math.round(y) } : t)) })
  },

  setTrackVisible(id, visible) {
    if (id === 0) return
    set({ tracks: get().tracks.map((t) => (t.id === id ? { ...t, visible } : t)) })
  },

  loadLrcToTrack(id, text, name) {
    const st = get()
    const parsed = parseCaptions(text, name)
    const base = maxLineId(st.lines)
    const stamped = parsed.lines.map((l, i) => ({
      ...l,
      id: base + 1 + i,
      ...(id ? { trackId: id } : {})
    }))
    const removedIds = new Set(st.lines.filter((l) => l.kind !== 'text' && (l.trackId ?? 0) === id).map((l) => l.id))
    const otherLines = st.lines.filter((l) => !removedIds.has(l.id))
    const selectedIds = st.selectedIds.filter((sid) => !removedIds.has(sid))
    invalidateLayoutCache()
    if (id === 0) {
      set({ meta: parsed.meta, lrcName: name, lines: sortLines([...otherLines, ...stamped]), selectedIds })
    } else {
      set({
        tracks: st.tracks.map((t) => (t.id === id ? { ...t, meta: parsed.meta, lrcName: name } : t)),
        lines: sortLines([...otherLines, ...stamped]),
        selectedIds
      })
    }
  },

  addImage(path, name) {
    const st = get()
    const existing = st.images.find((img) => img.path === path)
    if (existing) return existing
    const image: ImageAsset = { id: Math.max(0, ...st.images.map((img) => img.id)) + 1, path, name }
    set({ images: [...st.images, image] })
    return image
  },

  removeImage(id) {
    const st = get()
    const removed = st.images.find((img) => img.id === id)
    if (!removed) return
    set({
      images: st.images.filter((img) => img.id !== id),
      ...(removed.path === st.style.bgImage ? { style: { ...st.style, bgImage: null } } : {})
    })
  },

  loadLrc(text, name) {
    const parsed = parseCaptions(text, name)
    invalidateLayoutCache()
    historySuspend = true // 载入是全新文档，清空历史
    // 连额外字幕组一起清空：它们是上一份歌词的翻译/注音，跟着旧内容一起作废，
    // 避免留下指向新歌词、内容却对不上的空字幕组
    set({
      meta: parsed.meta,
      lines: parsed.lines,
      lrcName: name,
      tracks: [],
      currentTime: 0,
      selectedIds: [],
      past: [],
      future: [],
      dirty: true
    })
    historySuspend = false
  },

  repaginate(trackId, combineWithinMs) {
    const st = get()
    const lyric = st.lines.filter((l) => l.kind !== 'text' && (l.trackId ?? 0) === trackId)
    if (lyric.length === 0) return
    const others = st.lines.filter((l) => l.kind === 'text' || (l.trackId ?? 0) !== trackId)
    // 其它行 id 保留，重排的行 id 顺延其后，保证全局唯一
    const base = maxLineId(st.lines)
    const repaged = repaginateLines(lyric, combineWithinMs).map((l, i) => ({
      ...l,
      id: base + 1 + i,
      ...(trackId ? { trackId } : {})
    }))
    invalidateLayoutCache()
    set({ lines: sortLines([...repaged, ...others]), selectedIds: [], selectedClipId: null })
  },

  hydrate(data) {
    invalidateLayoutCache()
    // 兼容旧版工程文件：补齐行级字段默认值
    const lines = sortLines(
      data.lines.map((l) => ({
        ...l,
        effectId: l.effectId ?? null,
        effectInDurationMs: l.effectInDurationMs ?? null,
        effectOutDurationMs: l.effectOutDurationMs ?? null,
        dx: l.dx ?? 0,
        dy: l.dy ?? 0,
        layer: l.layer ?? 0
      }))
    )
    // 兼容无 tracks 字段的旧工程文件（视为只有主字幕组）；补齐字幕组字段默认值
    const tracks = (data.tracks ?? []).map((tr) => ({
      id: tr.id,
      name: tr.name ?? '',
      lrcName: tr.lrcName ?? null,
      meta: tr.meta ?? { offset: 0 },
      offsetY: tr.offsetY ?? 0,
      visible: tr.visible ?? true
    }))
    // 兼容无 images 字段的旧工程文件
    const images = (data.images ?? []).map((img) => ({ id: img.id, path: img.path, name: img.name }))
    const clips = (data.clips ?? []).map((clip) => ({ ...withClipDefaults(clip), id: nextClipId++ }))
    historySuspend = true // 打开工程是全新文档，清空历史
    set({
      meta: data.meta,
      lines,
      style: normalizeStyle(get().style, data.style),
      lrcName: data.lrcName,
      tracks,
      images,
      clips: sortClips(clips),
      projectDurationSec:
        typeof data.projectDurationSec === 'number' && Number.isFinite(data.projectDurationSec) && data.projectDurationSec > 0
          ? Math.min(24 * 60 * 60, data.projectDurationSec)
          : null,
      currentTime: 0,
      playing: false,
      selectedIds: [],
      selectedClipId: null,
      past: [],
      future: [],
      dirty: false
    })
    cleanSignature = docSignature(get())
    historySuspend = false
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
    const clips = get().clips
    const desired = Math.max(0, Math.round(original.start + deltaMs))
    const start = videoNoOverlapStart(clips, original, desired)
    set({ clips: sortClips(clips.map((c) => (c.id === original.id ? { ...original, start } : c))) })
  },

  setClipStart(id, startMs) {
    const clips = get().clips
    const clip = clips.find((c) => c.id === id)
    const desired = Math.max(0, Math.round(startMs))
    const start = clip ? videoNoOverlapStart(clips, clip, desired) : desired
    set({ clips: sortClips(clips.map((c) => (c.id === id ? { ...c, start } : c))) })
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
    const l = Math.min(MAX_LAYER, Math.max(0, Math.round(layer)))
    set({ clips: get().clips.map((c) => (c.id === id ? { ...c, layer: l } : c)) })
  },

  setClipVolume(id, volume) {
    const v = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1))
    set({ clips: get().clips.map((c) => (c.id === id ? { ...c, volume: v } : c)) })
  },

  replaceClipMedia(id, path, sourcePath, sourceDuration) {
    set({
      clips: get().clips.map((c) =>
        c.id === id
          ? { ...withClipDefaults({ ...c, path, sourcePath, sourceDuration, offline: false }), id: c.id }
          : c
      )
    })
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

  setClipRotate(id, deg) {
    const r = Math.max(-180, Math.min(180, Math.round(deg)))
    set({ clips: get().clips.map((c) => (c.id === id ? { ...c, rotate: r } : c)) })
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

  addLineAt(startMs, kind, text, trackId) {
    const st = get()
    const start = Math.max(0, Math.round(startMs))
    const end = start + (kind === 'text' ? 3000 : 2000)
    const content = text ?? (kind === 'text' ? '文字' : '新字幕')
    const bare: LrcLine = {
      id: maxLineId(st.lines) + 1,
      start,
      end,
      text: '',
      words: [],
      effectId: null,
      dx: 0,
      dy: 0,
      layer: 0,
      ...(kind === 'text' ? { kind: 'text' as const } : {}),
      ...(kind === 'lyric' && trackId ? { trackId } : {})
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
    set({ style: normalizeStyle(get().style, patch) })
  },

  setGlobalEffectDuration(which, durationMs) {
    const state = get()
    const positiveSegments = state.lines.map((line) => Math.max(0, line.end - line.start)).filter((ms) => ms > 0)
    const segmentMs = positiveSegments.length > 0 ? Math.min(...positiveSegments) : Infinity
    const value = Math.min(segmentMs, Math.max(0, Math.round(durationMs)))
    if (which === 'in') {
      set({ style: {
        ...state.style,
        effectInDurationMs: value,
        effectOutDurationMs: Math.min(state.style.effectOutDurationMs, Math.max(0, segmentMs - value))
      } })
    } else {
      set({ style: {
        ...state.style,
        effectOutDurationMs: value,
        effectInDurationMs: Math.min(state.style.effectInDurationMs, Math.max(0, segmentMs - value))
      } })
    }
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
  selectAllCaptions() {
    set({ selectedIds: get().lines.filter((l) => l.kind !== 'text').map((l) => l.id), selectedClipId: null })
  },
  clearSelection() {
    set({ selectedIds: [], selectedClipId: null })
  },

  setLineEffect(ids, effectId) {
    const idSet = new Set(ids)
    set({ lines: get().lines.map((l) => (idSet.has(l.id) ? { ...l, effectId } : l)) })
  },

  setLineEffectOut(ids, effectOutId) {
    const idSet = new Set(ids)
    set({ lines: get().lines.map((l) => (idSet.has(l.id) ? { ...l, effectOutId } : l)) })
  },

  setLineEffectDuration(ids, which, durationMs) {
    const idSet = new Set(ids)
    const state = get()
    if (durationMs == null) {
      const key = which === 'in' ? 'effectInDurationMs' : 'effectOutDurationMs'
      set({ lines: state.lines.map((line) => (idSet.has(line.id) ? { ...line, [key]: null } : line)) })
      return
    }
    const requested = Math.max(0, Math.round(durationMs))
    set({ lines: state.lines.map((line) => {
      if (!idSet.has(line.id)) return line
      const segmentMs = Math.max(0, line.end - line.start)
      const value = Math.min(segmentMs, requested)
      if (which === 'in') {
        const currentOut = line.effectOutDurationMs ?? state.style.effectOutDurationMs
        return {
          ...line,
          effectInDurationMs: value,
          effectOutDurationMs: Math.min(currentOut, Math.max(0, segmentMs - value))
        }
      }
      const currentIn = line.effectInDurationMs ?? state.style.effectInDurationMs
      return {
        ...line,
        effectInDurationMs: Math.min(currentIn, Math.max(0, segmentMs - value)),
        effectOutDurationMs: value
      }
    }) })
  },

  patchLineOver(ids, patch) {
    const idSet = new Set(ids)
    const normalized = normalizeLinePatch(patch)
    invalidateLayoutCache()
    set({
      lines: get().lines.map((l) => {
        if (!idSet.has(l.id)) return l
        const over: LineTextOverride = { ...l.over, ...normalized }
        for (const k of Object.keys(over) as (keyof LineTextOverride)[]) {
          if (over[k] === undefined) delete over[k]
        }
        return { ...l, over: Object.keys(over).length > 0 ? over : undefined }
      })
    })
  },

  clearLineOver(ids) {
    const idSet = new Set(ids)
    invalidateLayoutCache()
    set({ lines: get().lines.map((l) => (idSet.has(l.id) ? { ...l, over: undefined } : l)) })
  },

  setLineLayer(id, layer) {
    const l = Math.min(MAX_LAYER, Math.max(0, Math.round(layer)))
    set({ lines: get().lines.map((ln) => (ln.id === id ? { ...ln, layer: l } : ln)) })
  },

  splitLineAt(id, tMs) {
    const lines = get().lines
    const line = lines.find((l) => l.id === id)
    if (!line) return
    const t = Math.round(tMs)
    if (t <= line.start || t >= line.end) return // 切点在区间外
    const newId = maxLineId(lines) + 1
    const left = retimeLine(line, line.start, t)
    const right = { ...retimeLine(line, t, line.end), id: newId }
    invalidateLayoutCache()
    set({ lines: sortLines([...lines.filter((l) => l.id !== id), left, right]), selectedIds: [newId], selectedClipId: null })
  },

  duplicateLine(id) {
    const lines = get().lines
    const line = lines.find((l) => l.id === id)
    if (!line) return
    const newId = maxLineId(lines) + 1
    // 紧接原行之后：整体右移一个时长
    let dup = { ...shiftLine(line, line.end - line.start), id: newId }
    if (line.kind === 'text') {
      const maxLayer = lines.filter((l) => l.kind === 'text').reduce((m, l) => Math.max(m, l.layer ?? 0), 0)
      dup = { ...dup, layer: Math.min(MAX_LAYER, maxLayer + 1) }
    }
    invalidateLayoutCache()
    set({ lines: sortLines([...lines, dup]), selectedIds: [newId], selectedClipId: null })
  },

  duplicateClip(id) {
    const clip = get().clips.find((c) => c.id === id)
    if (!clip) return
    const maxLayer = get()
      .clips.filter((c) => c.kind === clip.kind)
      .reduce((m, c) => Math.max(m, c.layer), 0)
    const { id: _id, ...rest } = clip
    const dup = get().addClip({ ...rest, start: clipEnd(clip, 0), layer: Math.min(MAX_LAYER, maxLayer + 1) })
    get().setSelectedClip(dup.id)
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

/* ---- 撤销/重做：订阅文档字段变化，按时间窗口把连续拖动/滑杆合并为一次编辑 ---- */
let historySuspend = false
let cleanSignature = ''
let historyLastTime = 0
const HISTORY_CAP = 50
const HISTORY_COALESCE_MS = 500

function snapshotDoc(s: ProjectState): DocSnapshot {
  return {
    lines: s.lines,
    clips: s.clips,
    style: s.style,
    meta: s.meta,
    lrcName: s.lrcName,
    tracks: s.tracks,
    images: s.images,
    projectDurationSec: s.projectDurationSec
  }
}
function docSignature(s: ProjectState): string {
  return JSON.stringify(snapshotDoc(s))
}
function docChanged(a: ProjectState, b: ProjectState): boolean {
  return (
    a.lines !== b.lines ||
    a.clips !== b.clips ||
    a.style !== b.style ||
    a.meta !== b.meta ||
    a.lrcName !== b.lrcName ||
    a.tracks !== b.tracks ||
    a.images !== b.images ||
    a.projectDurationSec !== b.projectDurationSec
  )
}

useProject.subscribe((state, prev) => {
  if (historySuspend || !docChanged(state, prev)) return
  const now = Date.now()
  historySuspend = true
  // 新的编辑手势（与上次变更间隔够久，或栈为空）才新增一项；同一手势内的连续变更合并
  if (now - historyLastTime >= HISTORY_COALESCE_MS || state.past.length === 0) {
    useProject.setState({
      past: [...state.past, snapshotDoc(prev)].slice(-HISTORY_CAP),
      future: [],
      dirty: docSignature(state) !== cleanSignature
    })
  } else {
    useProject.setState({ future: [], dirty: docSignature(state) !== cleanSignature })
  }
  historyLastTime = now
  historySuspend = false
})

/** 项目总时长（秒）：歌词结尾与有限媒体线段结尾取较大者（无限循环线段不计入） */
export function getProjectDuration(s: { lines: LrcLine[]; clips: MediaClip[]; projectDurationSec?: number | null }): number {
  return Math.max(lyricsDuration(s.lines) / 1000, clipsDuration(s.clips.filter((clip) => !clip.offline)) / 1000, s.projectDurationSec ?? 0)
}

/** 把 store 样式转成渲染器需要的完整样式 */
export function toRenderStyle(style: StyleState): RenderStyle {
  const res = RESOLUTIONS[style.aspect] ?? RESOLUTIONS['9:16']
  return {
    width: res.width,
    height: res.height,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontSize: style.fontSize,
    textColor: style.textColor,
    letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing,
    lineSpacing: style.lineSpacing,
    textAlign: style.textAlign,
    textOrientation: style.textOrientation,
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
    strokeAlpha: style.strokeAlpha,
    glowColor: style.glowColor,
    highlightColor: style.highlightColor,
    bgType: style.bgType,
    bgFrom: style.bgFrom,
    bgTo: style.bgTo,
    bgAngle: style.bgAngle,
    bgImage: style.bgImage,
    bgImageScale: style.bgImageScale,
    bgImageX: style.bgImageX,
    bgImageY: style.bgImageY,
    bgImageRotate: style.bgImageRotate,
    effectId: style.effectId,
    effectInDurationMs: style.effectInDurationMs,
    effectOutDurationMs: style.effectOutDurationMs,
    intensity: style.intensity,
    riseHistory: style.riseHistory,
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
