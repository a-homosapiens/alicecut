import type { HeadlessJobPayload } from '../electron/headless'
import { useProject, toRenderStyle, type StyleState } from './store/project'
import { lyricsDuration } from './core/timing'
import { getEffect, EFFECTS } from './core/effects'
import { loadBuiltinFonts } from './fonts'
import { runExport } from './exportRunner'

/** 解析 "3" / "0-7" 这样的行区间键 */
function parseRange(key: string): [number, number] | null {
  const m = key.match(/^(\d+)(?:-(\d+))?$/)
  if (!m) return null
  const a = Number(m[1])
  const b = m[2] !== undefined ? Number(m[2]) : a
  return [Math.min(a, b), Math.max(a, b)]
}

async function probeAudioDuration(data: ArrayBuffer): Promise<number> {
  const url = URL.createObjectURL(new Blob([data]))
  try {
    return await new Promise<number>((resolve, reject) => {
      const audio = new Audio()
      audio.addEventListener(
        'loadedmetadata',
        () => resolve(isFinite(audio.duration) ? audio.duration : 0),
        { once: true }
      )
      audio.addEventListener('error', () => reject(new Error('音频文件无法解码')), { once: true })
      audio.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
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

    const state = useProject.getState()
    if (state.lines.length === 0) throw new Error('LRC 中没有带时间戳的歌词行')

    const durationSec = job.audioData
      ? await probeAudioDuration(job.audioData)
      : lyricsDuration(state.lines) / 1000

    const style = toRenderStyle(state.style)
    log(
      `${state.lines.length} 行歌词 · ${style.width}x${style.height}@${job.fps}fps · ` +
        `${Math.round(durationSec)}s · 默认特效 ${getEffect(state.style.effectId).name}` +
        (job.audioPath ? ' · 含音轨' : ' · 无音频')
    )

    const result = await runExport({
      lines: state.lines,
      meta: state.meta,
      style,
      fps: job.fps,
      durationSec,
      audioPath: job.audioPath,
      outPath: job.outPath,
      onProgress: window.desktop.headlessProgress
    })
    await window.desktop.headlessDone({ code: result.code, log: result.code === 0 ? '' : result.log })
  } catch (err) {
    await window.desktop.headlessDone({ code: 1, log: err instanceof Error ? err.message : String(err) })
  }
}
