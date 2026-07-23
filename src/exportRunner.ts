import type { LrcLine, LrcMeta } from './core/types'
import { renderFrame, renderFingerprint, type RenderStyle, type TrackPlacement } from './core/render'
import { clipSourceTime, clipRenderSourceTime, junctionLeadMs, type MediaClip } from './core/media'
import type { EncodeSettings, VideoFrameMode } from '../electron/exporterCore'
import { canUseWebCodecsExport, WebCodecsFrameSink } from './webcodecsExport'
import {
  drawBackgroundImage,
  drawVideoBackdrop,
  loadBgImage,
  pauseAllMedia,
  seekClipExact,
  waitForSourceTime,
  getMediaEl
} from './mediaPool'

export interface RunExportOptions {
  lines: LrcLine[]
  meta: LrcMeta
  style: RenderStyle
  /** 字幕组绘制位置（多语言字幕）；省略 = 单字幕组，全部按 offsetY 0 绘制 */
  tracks?: TrackPlacement[]
  /** 媒体线段：video 逐帧绘入画面，audio 交给 ffmpeg 混音 */
  clips: MediaClip[]
  fps: number
  durationSec: number
  outPath: string
  encode: EncodeSettings
  /** 背景视频取景精度：'fast'（默认，正向连续播放追帧）/ 'exact'（逐帧精确 seek，慢） */
  videoFrameMode: VideoFrameMode
  /** Whether this renderer session may use the GPU-resident WebCodecs path. */
  allowWebCodecs?: boolean
  onProgress?: (frac: number) => void
  onLog?: (message: string) => void
  isCancelled?: () => boolean
}

export interface RunExportResult {
  code: number
  log: string
  cancelled: boolean
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : null)
    }, 'image/png')
  })
}

/**
 * 逐帧渲染 → ffmpeg 编码的共享导出循环。
 * GUI 导出弹窗和无头（--export）模式都走这里，保证产出一致。
 * 背景视频每帧就位到源时间再绘制，循环/偏移与预览一致；
 * videoFrameMode 决定"就位"方式：'fast' 正向连续播放追帧（默认，快很多），
 * 'exact' 逐帧精确 seek（慢，但同一次导出重跑字节级一致）。
 */
export async function runExport(o: RunExportOptions): Promise<RunExportResult> {
  const dims = { width: o.style.width, height: o.style.height, fps: o.fps }
  const webCodecsConfig = o.allowWebCodecs === false
    ? null
    : await canUseWebCodecsExport(o.encode, o.videoFrameMode, dims)
  const canvas = document.createElement('canvas')
  canvas.width = o.style.width
  canvas.height = o.style.height
  const ctx = canvas.getContext('2d', webCodecsConfig ? undefined : { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建画布')

  const videoClips = o.clips.filter((c) => c.kind === 'video' && !c.offline)
  const audioClips = o.clips
    .filter((c) => c.kind === 'audio' && !c.offline)
    .map((c) => ({
      path: c.path,
      startMs: c.start,
      sourceInMs: c.sourceIn,
      sourceOutMs: c.sourceOut,
      speed: c.speed,
      loop: c.loop,
      fadeInMs: c.fadeInMs,
      fadeOutMs: c.fadeOutMs,
      volume: c.volume ?? 1
    }))

  // 导出期间预览不在播放，确保元素都停住，只按帧 seek
  pauseAllMedia()

  // 背景图片：先解码，保证首帧就能画出
  if (o.style.bgType === 'image' && o.style.bgImage) await loadBgImage(o.style.bgImage)

  const drawImageBackdrop = (c: CanvasRenderingContext2D): void => {
    if (o.style.bgType === 'image' && o.style.bgImage) {
      drawBackgroundImage(
        c,
        o.style.bgImage,
        o.style.width,
        o.style.height,
        o.style.bgImageScale,
        o.style.bgImageX,
        o.style.bgImageY,
        o.style.bgImageRotate
      )
    }
  }

  // 背景层（纯色/渐变/图片，不含视频）只取决于 style，与 tMs 无关，预先画一次全程复用。
  // 和是否存在视频线段无关——按帧用 videoVisible 判断能不能用它：视频线段本身可能只覆盖
  // 时间轴的一小段，之外的部分（比如 3 分钟里只有 10 秒插了视频）背景层完全一样能复用。
  const staticBackdrop = (() => {
    const bgCanvas = document.createElement('canvas')
    bgCanvas.width = o.style.width
    bgCanvas.height = o.style.height
    const bgCtx = bgCanvas.getContext('2d')
    if (!bgCtx) return null
    renderFrame(bgCtx, [], o.meta, o.style, 0, drawImageBackdrop, { tracks: o.tracks })
    return bgCanvas
  })()

  const durationMs = o.durationSec * 1000
  const totalFrames = Math.max(1, Math.ceil(o.durationSec * o.fps))
  // 相邻视频过渡（junction）的预卷时长按线段配置固定，逐帧不变，预先算好一份
  const leadByClipId = new Map<number, number>(videoClips.map((c) => [c.id, junctionLeadMs(c, videoClips)]))
  const clipLead = (c: MediaClip): number => leadByClipId.get(c.id) ?? 0
  // With no video clips, stdin can contain only the changing text layer. FFmpeg
  // loops this one PNG and composites the alpha frames before encoding.
  const staticBackgroundPng = !webCodecsConfig && videoClips.length === 0 && staticBackdrop
    ? await canvasToPng(staticBackdrop)
    : null
  const useStaticOverlay = staticBackgroundPng !== null
  const exportStartOptions = {
    width: o.style.width,
    height: o.style.height,
    fps: o.fps,
    audioClips,
    durationSec: o.durationSec,
    outPath: o.outPath,
    encode: o.encode
  }
  const webCodecsSink = webCodecsConfig ? new WebCodecsFrameSink(webCodecsConfig, o.fps) : null
  if (webCodecsSink) {
    await webCodecsSink.start(exportStartOptions)
    o.onLog?.(`导出路径: WebCodecs H.264 (${Math.round((webCodecsConfig?.bitrate ?? 0) / 1000)} kbps)`)
  } else {
    await window.desktop.exportStart({
      ...exportStartOptions,
      staticBackgroundPng: staticBackgroundPng ?? undefined
    })
    o.onLog?.(`导出路径: FFmpeg raw RGBA${useStaticOverlay ? ' + 静态背景合成' : ''}`)
  }

  // 相邻帧的 IPC 发送（渲染进程 → 主进程写入 ffmpeg stdin）与下一帧的渲染重叠，不再每帧串行等待。
  // 实测 ffmpeg 消费帧的速度远快于渲染+回读+IPC 产出帧的速度（encoder 几乎从不是瓶颈，
  // 见 docs/DESIGN.md §6），真正拖慢导出的是这条串行等待链路本身。IPC 消息按发送顺序到达、
  // 主进程按到达顺序同步 write() 进 ffmpeg stdin（写入本身不因背压 await 而错序），
  // 所以不需要等上一帧的 promise resolve 才能发下一帧；这里只留一个很浅的滑动窗口
  // 限制"领先"的帧数，避免长导出内存无限堆积。
  const MAX_INFLIGHT = 3
  const pending: Promise<void>[] = []
  const drainOne = async (): Promise<void> => {
    const p = pending.shift()
    if (p) await p
  }

  // 重复帧跳过：画面是 tMs 的纯确定性函数，无可见视频线段的帧先算指纹，
  // 与上一帧相同（无动画推进的静止段落）就直接重发上一帧的像素，跳过
  // seek/渲染/回读——歌词视频的静止停留占大头，收益显著且逐字节等价。
  let prevFp: string | null = null
  let prevBuf: Uint8Array | null = null
  let rawRunBuf: Uint8Array | null = null
  let rawRunLength = 0
  let renderedFrames = 0
  let duplicateFrames = 0
  let rawRuns = 0
  const startedAt = performance.now()

  const queueRawRun = async (): Promise<void> => {
    if (!rawRunBuf || rawRunLength === 0) return
    if (pending.length >= MAX_INFLIGHT) await drainOne()
    const sendP = window.desktop.exportFrame(rawRunBuf, rawRunLength)
    sendP.catch(() => {})
    pending.push(sendP)
    rawRuns++
    rawRunBuf = null
    rawRunLength = 0
  }

  try {
    for (let n = 0; n < totalFrames; n++) {
      if (o.isCancelled?.()) {
        if (webCodecsSink) await webCodecsSink.cancel()
        else await window.desktop.exportCancel()
        return { code: -1, log: '', cancelled: true }
      }
      const tMs = (n * 1000) / o.fps
      const videoVisible = videoClips.some((c) => clipRenderSourceTime(c, tMs, durationMs, clipLead(c)) !== null)
      const fp = videoVisible
        ? null
        : renderFingerprint(ctx, o.lines, o.meta, o.style, tMs, { tracks: o.tracks })

      const duplicate: boolean = fp !== null && fp === prevFp && (webCodecsSink !== null || prevBuf !== null)
      let buf: Uint8Array | null = duplicate ? prevBuf : null
      if (duplicate) {
        duplicateFrames++
      } else {
        // 所有可见视频线段先就位，再整帧绘制
        for (const clip of videoClips) {
          const lead = clipLead(clip)
          const srcT = clipRenderSourceTime(clip, tMs, durationMs, lead)
          if (srcT !== null) {
            getMediaEl(clip)
            // junction 预卷窗口冻结在首帧：始终精确 seek（不走正向追帧，避免帧被"播走"）
            const frozen = clipSourceTime(clip, tMs, durationMs) === null
            if (frozen || o.videoFrameMode === 'exact') {
              await seekClipExact(clip, srcT / 1000)
            } else {
              await waitForSourceTime(clip, srcT / 1000)
            }
          }
        }
        if (useStaticOverlay) {
          ctx.clearRect(0, 0, o.style.width, o.style.height)
          renderFrame(ctx, o.lines, o.meta, o.style, tMs, undefined, { skipBackground: true, tracks: o.tracks })
        } else if (staticBackdrop && !videoVisible) {
          ctx.drawImage(staticBackdrop, 0, 0)
          renderFrame(ctx, o.lines, o.meta, o.style, tMs, undefined, { skipBackground: true, tracks: o.tracks })
        } else {
          renderFrame(
            ctx,
            o.lines,
            o.meta,
            o.style,
            tMs,
            (c) => {
              drawImageBackdrop(c)
              drawVideoBackdrop(c, videoClips, tMs, durationMs, o.style.width, o.style.height)
            },
            { tracks: o.tracks }
          )
        }
        renderedFrames++
        if (!webCodecsSink) {
          const img = ctx.getImageData(0, 0, o.style.width, o.style.height)
          buf = new Uint8Array(img.data.buffer)
        }
      }
      prevFp = fp
      if (webCodecsSink) {
        await webCodecsSink.submit(canvas, n)
      } else {
        if (!buf) throw new Error('Raw export frame is missing')
        prevBuf = buf
        if (duplicate) {
          rawRunLength++
        } else {
          await queueRawRun()
          rawRunBuf = buf
          rawRunLength = 1
        }
      }
      if (n % 5 === 0 || n === totalFrames - 1) o.onProgress?.((n + 1) / totalFrames)
    }
    if (!webCodecsSink) {
      await queueRawRun()
      while (pending.length > 0) await drainOne()
    }
  } catch (err) {
    if (webCodecsSink) await webCodecsSink.cancel().catch(() => {})
    else await window.desktop.exportCancel().catch(() => {})
    throw err
  }

  let result: { code: number; log: string }
  try {
    result = webCodecsSink ? await webCodecsSink.finish() : await window.desktop.exportEnd()
  } catch (err) {
    if (webCodecsSink) await webCodecsSink.cancel().catch(() => {})
    else await window.desktop.exportCancel().catch(() => {})
    throw err
  }
  const { code, log } = result
  const elapsedMs = performance.now() - startedAt
  o.onLog?.(
    `导出性能: ${elapsedMs.toFixed(0)}ms · 渲染 ${renderedFrames}/${totalFrames} 帧` +
      ` · 重复 ${duplicateFrames} 帧` +
      (webCodecsSink ? ' · 压缩帧 IPC' : ` · raw IPC ${rawRuns} 次`)
  )
  return { code, log, cancelled: false }
}
