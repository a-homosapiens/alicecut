import type { HeadlessJobPayload } from '../electron/headless'
import { useProject, toRenderStyle, getProjectDuration, allCaptionTracks } from './store/project'
import { getEffect } from './core/effects'
import { loadBuiltinFonts } from './fonts'
import { runExport } from './exportRunner'
import { applyLineEffects, applyLineStyles, applyTrack, applyClips, applyTexts, applyStyle } from './projectCommand'

/** 无头导出（--export job.json）：复用 store 的加载逻辑与 GUI 同一套导出循环 */
export async function runHeadlessJob(job: HeadlessJobPayload): Promise<void> {
  const log = window.desktop.headlessLog
  try {
    await loadBuiltinFonts()

    const st = useProject.getState()
    st.loadLrc(job.lrcText, job.lrcName)
    if (Object.keys(job.style).length > 0) applyStyle(job.style)

    applyLineEffects(job.lineEffects, log)
    applyLineStyles(job.lineStyles, log)

    // 额外字幕组（多语言字幕）：必须按 job.tracks 原顺序依次处理——addTrack 铸造的
    // trackId 顺序需要和手动在 GUI 里逐个新增字幕组时一致，CLI 输出才能等价于手动操作
    for (const spec of job.tracks) applyTrack(spec, log)

    // 媒体线段：探测时长后加入 store（与 GUI 同一数据通路）
    await applyClips(job.clips)

    // 独立文字块
    applyTexts(job.texts, log)

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
        ` · ${videoCount} 段背景视频 · ${audioCount} 条音轨` +
        (state.tracks.length > 0 ? ` · ${state.tracks.length} 个额外字幕组` : '')
    )

    // Save GUI-compatible project file if requested
    if (job.projectOutPath) {
      const projectJson = JSON.stringify(
        {
          version: 4,
          meta: state.meta,
          lines: state.lines,
          style: state.style,
          lrcName: state.lrcName,
          tracks: state.tracks,
          images: state.images,
          clips: state.clips.map(({ id: _id, ...rest }) => rest)
        },
        null,
        2
      )
      await window.desktop.saveProjectHeadless(projectJson, job.projectOutPath)
      log(`项目已保存: ${job.projectOutPath}`)
    }

    // Skip video render if only saving project
    if (!job.renderVideo) {
      await window.desktop.headlessDone({ code: 0, log: '' })
      return
    }

    const result = await runExport({
      lines: state.lines,
      meta: state.meta,
      style,
      tracks: allCaptionTracks(state),
      clips: state.clips,
      fps: job.fps,
      durationSec,
      outPath: job.outPath,
      encode: job.encode,
      videoFrameMode: job.videoFrameMode,
      allowWebCodecs: job.gpu,
      onProgress: window.desktop.headlessProgress,
      onLog: log
    })
    await window.desktop.headlessDone({ code: result.code, log: result.code === 0 ? '' : result.log })
  } catch (err) {
    await window.desktop.headlessDone({ code: 1, log: err instanceof Error ? err.message : String(err) })
  }
}
