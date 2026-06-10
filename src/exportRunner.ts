import type { LrcLine, LrcMeta } from './core/types'
import { renderFrame, type RenderStyle } from './core/render'

export interface RunExportOptions {
  lines: LrcLine[]
  meta: LrcMeta
  style: RenderStyle
  fps: number
  durationSec: number
  audioPath: string | null
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
 */
export async function runExport(o: RunExportOptions): Promise<RunExportResult> {
  const canvas = document.createElement('canvas')
  canvas.width = o.style.width
  canvas.height = o.style.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建画布')

  const totalFrames = Math.max(1, Math.ceil(o.durationSec * o.fps))
  await window.desktop.exportStart({
    width: o.style.width,
    height: o.style.height,
    fps: o.fps,
    audioPath: o.audioPath,
    outPath: o.outPath
  })

  try {
    for (let n = 0; n < totalFrames; n++) {
      if (o.isCancelled?.()) {
        await window.desktop.exportCancel()
        return { code: -1, log: '', cancelled: true }
      }
      renderFrame(ctx, o.lines, o.meta, o.style, (n * 1000) / o.fps)
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
