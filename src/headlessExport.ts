import type { HeadlessJobPayload } from '../electron/headless'
import { useProject, toRenderStyle, getProjectDuration, type StyleState } from './store/project'
import { getEffect, EFFECTS } from './core/effects'
import { loadBuiltinFonts } from './fonts'
import { probeMediaDuration } from './mediaPool'
import { runExport } from './exportRunner'

/** 解析 "3" / "0-7" 这样的行区间键 */
function parseRange(key: string): [number, number] | null {
  const m = key.match(/^(\d+)(?:-(\d+))?$/)
  if (!m) return null
  const a = Number(m[1])
  const b = m[2] !== undefined ? Number(m[2]) : a
  return [Math.min(a, b), Math.max(a, b)]
}

/** 无头导出（--export job.json）：复用 store 的加载逻辑与 GUI 同一套导出循环 */
export async function runHeadlessJob(job: HeadlessJobPayload): Promise<void> {
  const log = window.desktop.headlessLog
  try {
    await loadBuiltinFonts()

    const st = useProject.getState()
    st.loadLrc(job.lrcText, job.lrcName)
    if (Object.keys(job.style).length > 0) st.patchStyle(job.style as Partial<StyleState>)

    // 行级特效
    const knownIds = new Set(EFFECTS.map((e) => e.id))
    for (const [key, fxId] of Object.entries(job.lineEffects)) {
      const range = parseRange(key)
      if (!range) {
        log(`警告：lineEffects 键 "${key}" 不是 "3" 或 "0-7" 格式，已忽略`)
        continue
      }
      if (!knownIds.has(fxId)) {
        log(`警告：未知特效 "${fxId}"，将回退为默认特效`)
      }
      const ids = useProject
        .getState()
        .lines.filter((l) => l.id >= range[0] && l.id <= range[1])
        .map((l) => l.id)
      useProject.getState().setLineEffect(ids, fxId)
    }

    // 媒体线段：探测时长后加入 store（与 GUI 同一数据通路）
    for (const c of job.clips) {
      const sourceDuration = await probeMediaDuration(c.path, c.kind)
      useProject.getState().addClip({
        kind: c.kind,
        path: c.path,
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
        scale: c.scale
      })
    }

    // 独立文字块
    for (const t of job.texts) {
      const line = useProject.getState().addLineAt(t.start * 1000, 'text', t.text)
      useProject.getState().retimeLineFrom(line, t.start * 1000, t.end * 1000)
      if (t.effect) {
        if (!knownIds.has(t.effect)) log(`警告：texts 特效 "${t.effect}" 未知，回退默认特效`)
        useProject.getState().setLineEffect([line.id], t.effect)
      }
      if (t.x || t.y) {
        useProject.getState().setLineOffsetsFrom([{ id: line.id, dx: 0, dy: 0 }], t.x ?? 0, t.y ?? 0)
      }
    }

    const state = useProject.getState()
    if (state.lines.length === 0) throw new Error('LRC 中没有带时间戳的歌词行')

    const durationSec = job.durationSec ?? getProjectDuration(state)
    if (durationSec <= 0) throw new Error('成片时长为 0：请检查歌词/媒体时间或指定 duration')

    const style = toRenderStyle(state.style)
    const videoCount = state.clips.filter((c) => c.kind === 'video').length
    const audioCount = state.clips.filter((c) => c.kind === 'audio').length
    log(
      `${state.lines.length} 行歌词 · ${style.width}x${style.height}@${job.fps}fps · ` +
        `${Math.round(durationSec)}s · 默认特效 ${getEffect(state.style.effectId).name}` +
        ` · ${videoCount} 段背景视频 · ${audioCount} 条音轨`
    )

    const result = await runExport({
      lines: state.lines,
      meta: state.meta,
      style,
      clips: state.clips,
      fps: job.fps,
      durationSec,
      outPath: job.outPath,
      onProgress: window.desktop.headlessProgress
    })
    await window.desktop.headlessDone({ code: result.code, log: result.code === 0 ? '' : result.log })
  } catch (err) {
    await window.desktop.headlessDone({ code: 1, log: err instanceof Error ? err.message : String(err) })
  }
}
