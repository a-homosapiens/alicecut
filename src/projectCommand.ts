import type { CaptionTrack, LineTextOverride } from './core/types'
import type { EffectDurationSpec, HeadlessClip, HeadlessTrackSpec, JobTextSpec } from '../electron/headless'
import { useProject, type StyleState } from './store/project'
import { EFFECTS } from './core/effects'
import { probeMediaDuration } from './mediaPool'
import { parseCaptions } from './core/subtitles'

/**
 * 一份 job.json（headless CLI）与命令控制台共用的"把已解析好的数据应用到当前工程"层。
 * 两条路径唯一的区别是文件路径怎么变成这里需要的文本/数据——headless 由主进程预先读好，
 * 控制台按需经 IPC 读取——一旦拿到数据，落到 store 上的效果由这里的函数保证完全一致。
 */

export type CommandLog = (msg: string) => void
export type CaptionImportMode = 'replace' | 'add'

const KNOWN_EFFECT_IDS = new Set(EFFECTS.map((e) => e.id))

/**
 * Import from the global Lyrics command without resetting the project.
 * Returns the affected track id, or null when the file contains no captions.
 */
export function importCaptionFile(text: string, name: string, mode: CaptionImportMode): number | null {
  if (parseCaptions(text, name).lines.length === 0) return null
  const st = useProject.getState()
  if (mode === 'replace') {
    st.loadLrcToTrack(0, text, name)
    return 0
  }

  const trackName = name.replace(/\.[^.]+$/, '')
  const track = st.addTrack(trackName)
  useProject.getState().loadLrcToTrack(track.id, text, name)
  return track.id
}

/** 解析 "3" / "0-7" 这样的行区间键 */
function parseRange(key: string): [number, number] | null {
  const m = key.match(/^(\d+)(?:-(\d+))?$/)
  if (!m) return null
  const a = Number(m[1])
  const b = m[2] !== undefined ? Number(m[2]) : a
  return [Math.min(a, b), Math.max(a, b)]
}

/**
 * 按"该字幕组自己的行序号"（0-based，按 start 排序）解析区间键，返回对应行的全局 id。
 * 与顶层 lineEffects/lineStyles 用的全局 id 区间是两套独立编号——字幕组自己的 LRC 文件
 * 从第 0 行数起，不需要知道主字幕组占用了多少个 id。
 */
function trackLineIdsInRange(trackLines: { id: number }[], key: string): number[] {
  const range = parseRange(key)
  if (!range) return []
  const ids: number[] = []
  for (let i = Math.max(0, range[0]); i <= range[1] && i < trackLines.length; i++) {
    ids.push(trackLines[i].id)
  }
  return ids
}

/** 顶层 lineEffects：键为全局行 id 区间 */
export function applyLineEffects(lineEffects: Record<string, string>, log: CommandLog): void {
  for (const [key, fxId] of Object.entries(lineEffects)) {
    const range = parseRange(key)
    if (!range) {
      log(`警告：lineEffects 键 "${key}" 不是 "3" 或 "0-7" 格式，已忽略`)
      continue
    }
    if (!KNOWN_EFFECT_IDS.has(fxId)) {
      log(`警告：未知特效 "${fxId}"，将回退为默认特效`)
    }
    const ids = useProject
      .getState()
      .lines.filter((l) => l.id >= range[0] && l.id <= range[1])
      .map((l) => l.id)
    useProject.getState().setLineEffect(ids, fxId)
  }
}

/** Top-level lineEffectsOut: global line id/range → exit effect id. */
export function applyLineEffectsOut(lineEffectsOut: Record<string, string>, log: CommandLog): void {
  for (const [key, fxId] of Object.entries(lineEffectsOut)) {
    const range = parseRange(key)
    if (!range) {
      log(`警告：lineEffectsOut 键 "${key}" 不是 "3" 或 "0-7" 格式，已忽略`)
      continue
    }
    if (!KNOWN_EFFECT_IDS.has(fxId)) log(`警告：未知退场特效 "${fxId}"，将回退为默认特效`)
    const ids = useProject
      .getState()
      .lines.filter((line) => line.id >= range[0] && line.id <= range[1])
      .map((line) => line.id)
    useProject.getState().setLineEffectOut(ids, fxId)
  }
}

/** Per-line duration command. Apply Out first and In last so simultaneous input gives In priority. */
export function applyLineEffectDurations(
  specs: Record<string, EffectDurationSpec>,
  log: CommandLog
): void {
  for (const [key, spec] of Object.entries(specs)) {
    const range = parseRange(key)
    if (!range) {
      log(`警告：lineEffectDurations 键 "${key}" 不是 "3" 或 "0-7" 格式，已忽略`)
      continue
    }
    const ids = useProject.getState().lines
      .filter((line) => line.id >= range[0] && line.id <= range[1])
      .map((line) => line.id)
    if (typeof spec.out === 'number') useProject.getState().setLineEffectDuration(ids, 'out', spec.out * 1000)
    if (typeof spec.in === 'number') useProject.getState().setLineEffectDuration(ids, 'in', spec.in * 1000)
  }
}

/** 顶层 lineStyles：键为全局行 id 区间 */
export function applyLineStyles(lineStyles: Record<string, LineTextOverride>, log: CommandLog): void {
  for (const [key, styleOver] of Object.entries(lineStyles)) {
    const range = parseRange(key)
    if (!range) {
      log(`警告：lineStyles 键 "${key}" 不是 "3" 或 "0-7" 格式，已忽略`)
      continue
    }
    const ids = useProject
      .getState()
      .lines.filter((l) => l.id >= range[0] && l.id <= range[1])
      .map((l) => l.id)
    useProject.getState().patchLineOver(ids, styleOver)
  }
}

/**
 * 新增一个额外字幕组：addTrack → loadLrcToTrack → 该组自己的 lineEffects/lineStyles
 * （区间按该组自己的行序号，与顶层是两套独立编号）→ 可选 offsetY/visible。
 * 返回应用完毕后的最终字幕组记录（含 offsetY/visible 的最终值）。
 */
export function applyTrack(spec: HeadlessTrackSpec, log: CommandLog): CaptionTrack {
  const track = useProject.getState().addTrack(spec.name)
  useProject.getState().loadLrcToTrack(track.id, spec.lrcText, spec.lrcName)

  const trackLines = useProject
    .getState()
    .lines.filter((l) => l.kind !== 'text' && l.trackId === track.id)
    .sort((a, b) => a.start - b.start)
  const trackLabel = spec.name || `#${track.id}`

  for (const [key, fxId] of Object.entries(spec.lineEffects)) {
    const ids = trackLineIdsInRange(trackLines, key)
    if (ids.length === 0) {
      log(`警告：字幕组「${trackLabel}」的 lineEffects 键 "${key}" 无效或超出范围，已忽略`)
      continue
    }
    if (!KNOWN_EFFECT_IDS.has(fxId)) log(`警告：未知特效 "${fxId}"，将回退为默认特效`)
    useProject.getState().setLineEffect(ids, fxId)
  }

  for (const [key, fxId] of Object.entries(spec.lineEffectsOut ?? {})) {
    const ids = trackLineIdsInRange(trackLines, key)
    if (ids.length === 0) {
      log(`警告：字幕组「${trackLabel}」的 lineEffectsOut 键 "${key}" 无效或超出范围，已忽略`)
      continue
    }
    if (!KNOWN_EFFECT_IDS.has(fxId)) log(`警告：未知退场特效 "${fxId}"，将回退为默认特效`)
    useProject.getState().setLineEffectOut(ids, fxId)
  }

  for (const [key, durations] of Object.entries(spec.lineEffectDurations ?? {})) {
    const ids = trackLineIdsInRange(trackLines, key)
    if (ids.length === 0) {
      log(`警告：字幕组「${trackLabel}」的 lineEffectDurations 键 "${key}" 无效或超出范围，已忽略`)
      continue
    }
    if (typeof durations.out === 'number') useProject.getState().setLineEffectDuration(ids, 'out', durations.out * 1000)
    if (typeof durations.in === 'number') useProject.getState().setLineEffectDuration(ids, 'in', durations.in * 1000)
  }

  for (const [key, styleOver] of Object.entries(spec.lineStyles)) {
    const ids = trackLineIdsInRange(trackLines, key)
    if (ids.length === 0) {
      log(`警告：字幕组「${trackLabel}」的 lineStyles 键 "${key}" 无效或超出范围，已忽略`)
      continue
    }
    useProject.getState().patchLineOver(ids, styleOver)
  }

  // 缺省则沿用 addTrack 自己的错开位置/可见性——这是"命令输出 == 手动 GUI 操作"的前提
  if (spec.offsetY !== undefined) useProject.getState().setTrackOffsetY(track.id, spec.offsetY)
  if (spec.visible !== undefined) useProject.getState().setTrackVisible(track.id, spec.visible)

  return useProject.getState().tracks.find((t) => t.id === track.id)!
}

/** 媒体线段：探测时长后加入 store（与 GUI 同一数据通路） */
export async function applyClips(clips: HeadlessClip[]): Promise<void> {
  for (const c of clips) {
    const sourcePath = c.path
    const path = c.kind === 'video'
      ? (await window.desktop.ensurePlayable(sourcePath)).path
      : sourcePath
    const sourceDuration = await probeMediaDuration(path, c.kind)
    useProject.getState().addClip({
      kind: c.kind,
      path,
      sourcePath,
      name: c.name,
      start: c.startMs,
      sourceDuration,
      sourceIn: c.sourceInMs,
      sourceOut: Math.min(c.sourceOutMs ?? sourceDuration, sourceDuration),
      speed: c.speed,
      loop: c.loop,
      layer: c.layer,
      tx: c.tx,
      ty: c.ty,
      scale: c.scale,
      fadeInMs: c.fadeInMs,
      fadeOutMs: c.fadeOutMs,
      transIn: c.transIn,
      transOut: c.transOut
    })
  }
}

/** 独立文字块 */
export function applyTexts(texts: JobTextSpec[], log: CommandLog): void {
  for (const t of texts) {
    const line = useProject.getState().addLineAt(t.start * 1000, 'text', t.text)
    useProject.getState().retimeLineFrom(line, t.start * 1000, t.end * 1000)
    if (t.effect) {
      if (!KNOWN_EFFECT_IDS.has(t.effect)) log(`警告：texts 特效 "${t.effect}" 未知，回退默认特效`)
      useProject.getState().setLineEffect([line.id], t.effect)
    }
    if (t.effectOut) {
      if (!KNOWN_EFFECT_IDS.has(t.effectOut)) log(`警告：texts 退场特效 "${t.effectOut}" 未知，回退默认特效`)
      useProject.getState().setLineEffectOut([line.id], t.effectOut)
    }
    // Simultaneous command semantics: apply Out first, then In (In wins).
    if (typeof t.effectOutDuration === 'number') {
      useProject.getState().setLineEffectDuration([line.id], 'out', t.effectOutDuration * 1000)
    }
    if (typeof t.effectInDuration === 'number') {
      useProject.getState().setLineEffectDuration([line.id], 'in', t.effectInDuration * 1000)
    }
    if (t.x || t.y) {
      useProject.getState().setLineOffsetsFrom([{ id: line.id, dx: 0, dy: 0 }], t.x ?? 0, t.y ?? 0)
    }
    if (t.style) {
      useProject.getState().patchLineOver([line.id], t.style)
    }
  }
}

/** 样式覆盖；bgImage 顺带登记进图片库，避免出现绕开图片库直接改样式的第二条路径 */
export function applyStyle(patch: Record<string, unknown>): void {
  if (typeof patch.bgImage === 'string') {
    const p = patch.bgImage
    useProject.getState().addImage(p, p.split(/[\\/]/).pop() ?? p)
  }
  const { effectInDurationMs, effectOutDurationMs, ...rest } = patch
  useProject.getState().patchStyle(rest as Partial<StyleState>)
  // A single style command containing both durations gives In priority.
  if (typeof effectOutDurationMs === 'number') useProject.getState().setGlobalEffectDuration('out', effectOutDurationMs)
  if (typeof effectInDurationMs === 'number') useProject.getState().setGlobalEffectDuration('in', effectInDurationMs)
}

/**
 * 控制台专用：非破坏性地替换主字幕组（loadLrcToTrack(0, …)）。
 * headless 的顶层 lrc 仍走破坏性的 loadLrc（无头导出本就该从一份全新文档开始）；
 * 这个函数只给"输入一条命令改动正在打开的工程"这个场景用，两者不是一回事。
 */
export function applyPrimaryLrc(text: string, name: string): void {
  useProject.getState().loadLrcToTrack(0, text, name)
}
