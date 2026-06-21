import type { LrcLine, LrcMeta } from './core/types'
import { renderFrame, type RenderStyle } from './core/render'
import { clipSourceTime, type MediaClip } from './core/media'
import {
  drawBackgroundImage,
  drawVideoBackdrop,
  loadBgImage,
  pauseAllMedia,
  seekClipExact,
  getMediaEl
} from './mediaPool'

export interface RunExportOptions {
  lines: LrcLine[]
  meta: LrcMeta
  style: RenderStyle
  /** 媒体线段：video 逐帧绘入画面，audio 交给 ffmpeg 混音 */
  clips: MediaClip[]
  fps: number
  durationSec: number
  outPath: string
  onProgress?: (frac: number) => void
  isCancelled?: () => boolean
}

export interface RunExportResult {
  code: number
  log: string
  cancelled: boolean
}

/**
 * 逐帧渲染 → ffmpeg 编码的共享导出循环。
 * GUI 导出弹窗和无头（--export）模式都走这里，保证产出一致。
 * 背景视频每帧精确 seek 到源时间再绘制，循环/偏移与预览一致。
 */
export async function runExport(o: RunExportOptions): Promise<RunExportResult> {
  const canvas = document.createElement('canvas')
  canvas.width = o.style.width
  canvas.height = o.style.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建画布')

  const videoClips = o.clips.filter((c) => c.kind === 'video')
  const audioClips = o.clips
    .filter((c) => c.kind === 'audio')
    .map((c) => ({
      path: c.path,
      startMs: c.start,
      sourceInMs: c.sourceIn,
      sourceOutMs: c.sourceOut,
      speed: c.speed,
      loop: c.loop,
      fadeInMs: c.fadeInMs,
      fadeOutMs: c.fadeOutMs
    }))

  // 导出期间预览不在播放，确保元素都停住，只按帧 seek
  pauseAllMedia()

  // 背景图片：先解码，保证首帧就能画出
  if (o.style.bgType === 'image' && o.style.bgImage) await loadBgImage(o.style.bgImage)

  const durationMs = o.durationSec * 1000
  const totalFrames = Math.max(1, Math.ceil(o.durationSec * o.fps))
  await window.desktop.exportStart({
    width: o.style.width,
    height: o.style.height,
    fps: o.fps,
    audioClips,
    durationSec: o.durationSec,
    outPath: o.outPath
  })

  try {
    for (let n = 0; n < totalFrames; n++) {
      if (o.isCancelled?.()) {
        await window.desktop.exportCancel()
        return { code: -1, log: '', cancelled: true }
      }
      const tMs = (n * 1000) / o.fps
      // 所有可见视频线段先精确就位，再整帧绘制
      for (const clip of videoClips) {
        const srcT = clipSourceTime(clip, tMs, durationMs)
        if (srcT !== null) {
          getMediaEl(clip)
          await seekClipExact(clip, srcT / 1000)
        }
      }
      renderFrame(ctx, o.lines, o.meta, o.style, tMs, (c) => {
        if (o.style.bgType === 'image' && o.style.bgImage) {
          drawBackgroundImage(c, o.style.bgImage, o.style.width, o.style.height)
        }
        drawVideoBackdrop(c, videoClips, tMs, durationMs, o.style.width, o.style.height)
      })
      const img = ctx.getImageData(0, 0, o.style.width, o.style.height)
      await window.desktop.exportFrame(new Uint8Array(img.data.buffer))
      if (n % 5 === 0 || n === totalFrames - 1) o.onProgress?.((n + 1) / totalFrames)
    }
  } catch (err) {
    await window.desktop.exportCancel().catch(() => {})
    throw err
  }

  const { code, log } = await window.desktop.exportEnd()
  return { code, log, cancelled: false }
}
