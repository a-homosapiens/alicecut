import { clipSourceTime, type MediaClip } from './core/media'

/**
 * 媒体元素池：每个媒体线段对应一个 <video>/<audio> 元素，
 * 经 media:// 协议流式读取本地文件（支持 seek，不占内存）。
 * 预览播放与导出逐帧取景共用。
 */

/** 本地绝对路径 → media:// URL */
export function mediaUrl(path: string): string {
  return 'media:///' + path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
}

const pool = new Map<number, HTMLVideoElement | HTMLAudioElement>()

export function getMediaEl(clip: MediaClip): HTMLVideoElement | HTMLAudioElement {
  let el = pool.get(clip.id)
  if (!el) {
    if (clip.kind === 'video') {
      const v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      el = v
    } else {
      el = new Audio()
    }
    el.preload = 'auto'
    el.loop = true // 线段循环靠元素原生 loop + 激活窗口控制
    el.src = mediaUrl(clip.path)
    pool.set(clip.id, el)
  }
  return el
}

function disposeEl(id: number): void {
  const el = pool.get(id)
  if (!el) return
  el.pause()
  el.removeAttribute('src')
  el.load()
  pool.delete(id)
}

/** 探测媒体文件时长（ms）；无法解码时 reject */
export function probeMediaDuration(path: string, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = kind === 'video' ? document.createElement('video') : new Audio()
    el.preload = 'metadata'
    el.addEventListener(
      'loadedmetadata',
      () => resolve(isFinite(el.duration) ? Math.round(el.duration * 1000) : 0),
      { once: true }
    )
    el.addEventListener('error', () => reject(new Error(`媒体文件无法解码: ${path}`)), { once: true })
    el.src = mediaUrl(path)
  })
}

/** 播放时允许的最大漂移（秒），超出则回拉到时钟位置 */
const DRIFT_SEC = 0.3

/**
 * 每帧调用：把所有媒体元素同步到项目时间。
 * 播放中 → 激活窗口内的元素播放（漂移过大时回拉）；窗口外暂停。
 * 暂停中 → 全部暂停，并把画面 seek 到当前位置（视频轨拖动播放头所见即所得）。
 * 同时清理已被删除线段的元素。
 */
export function syncMediaPlayback(
  clips: MediaClip[],
  tMs: number,
  playing: boolean,
  projectEndMs: number
): void {
  const alive = new Set(clips.map((c) => c.id))
  for (const id of [...pool.keys()]) {
    if (!alive.has(id)) disposeEl(id)
  }

  for (const clip of clips) {
    const el = getMediaEl(clip)
    const srcT = clipSourceTime(clip, tMs, projectEndMs)
    if (srcT === null || !playing) {
      if (!el.paused) el.pause()
      // 暂停态把画面停在播放头位置：拖动播放头时也实时跟随（半帧容差）；
      // seek 进行中不打断，seeked 后下一帧自然跟进最新位置
      if (srcT !== null && !el.seeking && Math.abs(el.currentTime - srcT / 1000) > 0.05) {
        el.currentTime = srcT / 1000
      }
      continue
    }
    if (el.playbackRate !== clip.speed) el.playbackRate = clip.speed
    if (el.paused) {
      el.currentTime = srcT / 1000
      void el.play().catch(() => {})
    } else if (!el.seeking && Math.abs(el.currentTime - srcT / 1000) > DRIFT_SEC) {
      el.currentTime = srcT / 1000
    }
  }
}

export function pauseAllMedia(): void {
  for (const el of pool.values()) el.pause()
}

function ensureMetadata(el: HTMLMediaElement, path: string): Promise<void> {
  if (el.readyState >= 1) return Promise.resolve()
  return new Promise((resolve, reject) => {
    el.addEventListener('loadedmetadata', () => resolve(), { once: true })
    el.addEventListener('error', () => reject(new Error(`媒体文件无法解码: ${path}`)), { once: true })
  })
}

/** 导出用：把视频元素精确 seek 到源时间（秒），等 seeked 完成 */
export async function seekClipExact(clip: MediaClip, srcSec: number): Promise<void> {
  const el = getMediaEl(clip)
  await ensureMetadata(el, clip.path)
  // readyState>=2 才说明当前帧已解码可绘制
  if (el.readyState >= 2 && Math.abs(el.currentTime - srcSec) < 0.0005) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve() // 个别格式 seeked 不可靠时不卡死导出，用当前帧
    }, 3000)
    const onSeeked = (): void => {
      cleanup()
      resolve()
    }
    const onError = (): void => {
      cleanup()
      reject(new Error(`视频解码失败: ${clip.path}`))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      el.removeEventListener('seeked', onSeeked)
      el.removeEventListener('error', onError)
    }
    el.addEventListener('seeked', onSeeked, { once: true })
    el.addEventListener('error', onError, { once: true })
    el.currentTime = srcSec
  })
}

export interface ClipRect {
  x: number
  y: number
  w: number
  h: number
}

/** 视频在画布上的绘制矩形：cover 适配为基准，叠加该线段的缩放/平移 */
function clipRectFor(video: HTMLVideoElement, clip: MediaClip, w: number, h: number): ClipRect | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (vw === 0 || vh === 0) return null
  const fit = Math.max(w / vw, h / vh) * clip.scale
  const dw = vw * fit
  const dh = vh * fit
  return { x: (w - dw) / 2 + clip.tx, y: (h - dh) / 2 + clip.ty, w: dw, h: dh }
}

/** 选中标记用：某视频线段当前在画布上占的矩形；尺寸未就绪时返回 null */
export function getClipDrawRect(clip: MediaClip, w: number, h: number): ClipRect | null {
  if (clip.kind !== 'video') return null
  const el = getMediaEl(clip)
  if (!(el instanceof HTMLVideoElement)) return null
  return clipRectFor(el, clip, w, h)
}

/** 把一帧视频画到画布：cover 适配为基准，再叠加该线段的平移/缩放变换 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  clip: MediaClip,
  w: number,
  h: number
): void {
  if (video.readyState < 2) return
  const r = clipRectFor(video, clip, w, h)
  if (r) ctx.drawImage(video, r.x, r.y, r.w, r.h)
}

/** 画出 tMs 时刻所有可见的背景视频线段（低层在下、高层在上；同层后开始的在上） */
export function drawVideoBackdrop(
  ctx: CanvasRenderingContext2D,
  clips: MediaClip[],
  tMs: number,
  projectEndMs: number,
  width: number,
  height: number
): void {
  const videos = clips
    .filter((c) => c.kind === 'video')
    .sort((a, b) => a.layer - b.layer || a.start - b.start)
  for (const clip of videos) {
    if (clipSourceTime(clip, tMs, projectEndMs) === null) continue
    const el = getMediaEl(clip)
    if (el instanceof HTMLVideoElement) drawCover(ctx, el, clip, width, height)
  }
}
