import {
  clipSourceTime,
  clipGain,
  clipTransition,
  clipRenderSourceTime,
  junctionLeadMs,
  junctionInFxAt,
  type MediaClip,
  type VideoClipFx
} from './core/media'

/**
 * 媒体元素池：每个媒体线段对应一个 <video>/<audio> 元素，
 * 经 media:// 协议流式读取本地文件（支持 seek，不占内存）。
 * 预览播放与导出逐帧取景共用。
 */

/** 本地绝对路径 → media:// URL */
export function mediaUrl(path: string): string {
  // A privileged standard scheme needs a real host. The previous hostless
  // media:///D%3A/... form worked inconsistently: HTMLMediaElement accepted it,
  // while fetch() (used for waveforms) rejected it as an unsafe URL.
  return 'media://local/' + path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
}

/* ---- 背景图片：按路径缓存一个 HTMLImageElement，cover 铺满画布 ---- */
const bgImages = new Map<string, HTMLImageElement>()

function getBgImage(path: string): HTMLImageElement {
  let img = bgImages.get(path)
  if (!img) {
    img = new Image()
    // media://local is a different origin from the renderer. Request it in
    // CORS mode before assigning src so drawing it cannot taint export canvases.
    img.crossOrigin = 'anonymous'
    img.src = mediaUrl(path)
    bgImages.set(path, img)
  }
  return img
}

/** 导出前预解码背景图片，确保首帧就能画出 */
export async function loadBgImage(path: string): Promise<void> {
  const img = getBgImage(path)
  if (img.complete && img.naturalWidth > 0) return
  try {
    await img.decode()
  } catch {
    throw new Error(`背景图片无法解码: ${path}`)
  }
  if (img.naturalWidth === 0 || img.naturalHeight === 0) throw new Error(`背景图片无法解码: ${path}`)
}

/** 把背景图片按 cover 铺满画布（保持比例裁切居中），可叠加缩放/平移/旋转 */
export function drawBackgroundImage(
  ctx: CanvasRenderingContext2D,
  path: string,
  w: number,
  h: number,
  userScale = 1,
  offsetX = 0,
  offsetY = 0,
  rotate = 0
): void {
  const img = getBgImage(path)
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (iw === 0 || ih === 0) return
  // cover 基准 × 用户缩放，居中后再按用户偏移平移
  const scale = Math.max(w / iw, h / ih) * (userScale > 0 ? userScale : 1)
  const dw = iw * scale
  const dh = ih * scale
  const dx = (w - dw) / 2 + offsetX
  const dy = (h - dh) / 2 + offsetY
  if (rotate) {
    // 绕画面中心旋转（转出画面的角会露出兜底黑底，放大可补满）
    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.rotate((rotate * Math.PI) / 180)
    ctx.translate(-w / 2, -h / 2)
    ctx.drawImage(img, dx, dy, dw, dh)
    ctx.restore()
  } else {
    ctx.drawImage(img, dx, dy, dw, dh)
  }
}

const pool = new Map<number, HTMLVideoElement | HTMLAudioElement>()
// clip id → 最近一次真正 seeked 成功时的源时间(秒);seekClipExact 用它跳过连续请求同一源帧的重复 seek。
// 必须和 pool 一起在 disposeEl 里清理,否则长会话里条目会一直攒着
const lastSeekedSec = new Map<number, number>()

export function getMediaEl(clip: MediaClip): HTMLVideoElement | HTMLAudioElement {
  let el = pool.get(clip.id)
  if (!el) {
    if (clip.kind === 'video') {
      const v = document.createElement('video')
      // Must be set before src. Otherwise frames drawn from media://local make
      // the canvas origin-unsafe and WebCodecs rejects new VideoFrame(canvas).
      v.crossOrigin = 'anonymous'
      v.muted = true
      v.playsInline = true
      el = v
    } else {
      const audio = new Audio()
      audio.defaultMuted = false
      audio.muted = false
      audio.volume = 1
      el = audio
    }
    el.preload = 'auto'
    el.loop = true // 线段循环靠元素原生 loop + 激活窗口控制
    // 必须挂进文档且必须有布局盒：脱离 DOM 或 display:none 的 <audio> 在 Chromium 里都会被限速播放
    // （实测跌到不到一半速，声音卡顿/几乎没声）——两者都被排除出布局树，触发同一限速。
    // opacity:0 的 1x1 元素仍参与布局/绘制，不受影响；<video> 本身不受限速影响，但一并处理更稳妥。
    el.style.position = 'fixed'
    el.style.width = '1px'
    el.style.height = '1px'
    el.style.opacity = '0'
    el.style.pointerEvents = 'none'
    document.body.appendChild(el)
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
  el.remove()
  pool.delete(id)
  lastSeekedSec.delete(id)
  forwardMediaTime.delete(id)
  forwardLastTarget.delete(id)
}

/** 探测媒体文件时长（ms）；无法解码时 reject */
export function probeMediaDuration(path: string, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = kind === 'video' ? document.createElement('video') : new Audio()
    el.crossOrigin = 'anonymous'
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
    if (clip.offline) continue
    const el = getMediaEl(clip)
    // 音轨淡入淡出：每帧按时间轴位置设音量
    if (clip.kind === 'audio') el.volume = Math.min(1, (clip.volume ?? 1) * clipGain(clip, tMs, projectEndMs))
    const normalSrc = clipSourceTime(clip, tMs, projectEndMs)
    const lead = clip.kind === 'video' ? junctionLeadMs(clip, clips) : 0
    // junction 预卷窗口：本段还没到自己的时间，冻结在首帧（暂停并 seek 到 sourceIn），
    // 好让 drawVideoBackdrop 把它叠加在前一段之上做过渡
    const inLead = normalSrc === null && lead > 0 && tMs >= clip.start - lead && tMs < clip.start
    const srcT = inLead ? clip.sourceIn : normalSrc
    if (srcT === null || !playing || inLead) {
      if (!el.paused) el.pause()
      // 暂停态/预卷把画面停在目标源位置（拖动播放头时也实时跟随，半帧容差）；
      // seek 进行中不打断，seeked 后下一帧自然跟进最新位置
      if (srcT !== null && !el.seeking && Math.abs(el.currentTime - srcT / 1000) > 0.05) {
        el.currentTime = srcT / 1000
      }
      continue
    }
    if (el.playbackRate !== clip.speed) el.playbackRate = clip.speed
    if (el.paused) {
      if (clip.kind === 'audio') {
        el.defaultMuted = false
        el.muted = false
      }
      el.currentTime = srcT / 1000
      void el.play().catch((error: unknown) => {
        console.error(`Audio/video playback failed for ${clip.path}`, error)
      })
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

// 连续两帧请求的源时间落在这个范围内视为"同一源帧"，跳过重复 seek。
// 固定小 epsilon，不按 sourceFps 换算——该字段目前项目里任何地方都不存在（MediaClip/HeadlessClip/
// ExportJobFile 均未探测过源帧率），没有真实数据支撑按帧率去重；这里只捕获字面重复请求
// （画面暂停不前进，或输出帧率高于源帧率恰好整除的情况），常见的"源=30fps 输出=30fps 但两者不对齐"
// 场景本质上帧帧不同，这个 dedup 帮不上——那需要真正的源帧率数据，本轮不做。
const SEEK_DEDUP_EPS_SEC = 0.004 // 约半帧 @120fps，对更高帧率的源不安全但目前没有这类素材

/** 导出用：把视频元素精确 seek 到源时间（秒），等 seeked 完成 */
export async function seekClipExact(clip: MediaClip, srcSec: number): Promise<void> {
  const el = getMediaEl(clip)
  await ensureMetadata(el, clip.path)
  // readyState>=2 才说明当前帧已解码可绘制
  if (el.readyState >= 2 && Math.abs(el.currentTime - srcSec) < 0.0005) return Promise.resolve()
  // 上一次真正 seeked 成功的目标源时间足够接近：视为同一源帧，跳过重复 seek。
  // 只信任由 onSeeked 真正写入的缓存（见下方）——3 秒超时兜底路径不写入，
  // 否则一次超时会让后续所有请求同一 srcSec 的帧都误用那个未确认到位的画面，一帧坏图变成一片
  const last = lastSeekedSec.get(clip.id)
  if (el.readyState >= 2 && last !== undefined && Math.abs(last - srcSec) < SEEK_DEDUP_EPS_SEC) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`视频定位超时，导出已停止以避免损坏画面: ${clip.path}`))
    }, 3000)
    const onSeeked = (): void => {
      lastSeekedSec.set(clip.id, srcSec)
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

// 这台机器上验证过 requestVideoFrameCallback 可用(Electron 33 / Chromium 130+);
// 不支持的老环境整条退化为 seekClipExact 精确逐帧 seek(慢但一直能用)，探测一次即可
const RVFC_SUPPORTED =
  typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype

// clip id → 正向连续播放时最近一次 requestVideoFrameCallback 报告的源时间(秒)
const forwardMediaTime = new Map<number, number>()
// clip id → 上一帧请求的目标源时间(秒);下一帧目标比它小说明循环从头开始了，需要重新 seek 一次
const forwardLastTarget = new Map<number, number>()

// 正常情况下命中只需几毫秒（实测 98%+ 的等待 <10ms）；极少数帧会因为主线程一时繁忙
// （渲染/回读/系统负载波动）明显更久，但通常在几百毫秒到几秒内就能追上，而不是真的卡死——
// 实测过短的超时（如 250ms）反而会让更多本可等到的帧被迫改走一次主动 seek，
// 那次 seek 同样要竞争被占用的资源，总耗时不降反升。3 秒与 seekClipExact 自己的超时一致，
// 命中率高、发生频率低（实测千帧级导出里个位数），真出现"超时也等不到"才用当前帧兜底。
const RVFC_WAIT_TIMEOUT_MS = 3000

/**
 * 等视频元素正向播放到 targetSec 或之后，而不是每帧都精确 seek。
 * 只有超时兜底这一条路径需要显式 cancelVideoFrameCallback——调用方（waitForSourceTime）保证
 * 同一 clip 不会有两次调用重叠，正常命中路径不重新注册就没有悬挂的回调；但超时后若不取消，
 * 那个回调会在未来某帧真正到达时才触发，把已经过时的 mediaTime 写回缓存。
 */
function waitForFrameAtOrAfter(video: HTMLVideoElement, clipId: number, targetSec: number): Promise<void> {
  const cached = forwardMediaTime.get(clipId)
  if (cached !== undefined && cached >= targetSec) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let handle: number | null = null
    const timer = setTimeout(() => {
      if (handle !== null) video.cancelVideoFrameCallback(handle)
      reject(new Error('视频帧解码超时，导出已停止以避免重复或错误画面'))
    }, RVFC_WAIT_TIMEOUT_MS)
    const check = (_now: number, metadata: VideoFrameCallbackMetadata): void => {
      forwardMediaTime.set(clipId, metadata.mediaTime)
      if (metadata.mediaTime >= targetSec) {
        clearTimeout(timer)
        resolve()
        return
      }
      handle = video.requestVideoFrameCallback(check)
    }
    handle = video.requestVideoFrameCallback(check)
  })
}

/**
 * 导出用：让视频元素正向连续播放并等到 srcSec 就绪，替代逐帧精确 seek（seekClipExact）。
 * 只在"新可见"或"循环从头开始播放"时真正 seek 一次（重新定位+续播），此后每帧只是等
 * 正向播放追上目标时间——这是比逐帧 seek 快一个数量级的原因（实测 ~28x，见设计文档）。
 * 不支持 requestVideoFrameCallback 的环境整条退化为 seekClipExact。
 */
export async function waitForSourceTime(clip: MediaClip, srcSec: number): Promise<void> {
  if (!RVFC_SUPPORTED) return seekClipExact(clip, srcSec)
  const el = getMediaEl(clip)
  if (!(el instanceof HTMLVideoElement)) return seekClipExact(clip, srcSec)
  const video = el

  const lastTarget = forwardLastTarget.get(clip.id)
  const isNewOrWrapped = lastTarget === undefined || srcSec < lastTarget
  forwardLastTarget.set(clip.id, srcSec)

  if (isNewOrWrapped) {
    // 新可见或循环从头开始：重新定位到 srcSec 再续播，此后靠正向播放追帧，不必每帧 seek
    video.pause()
    await seekClipExact(clip, srcSec)
    if (video.playbackRate !== clip.speed) video.playbackRate = clip.speed
    await video.play().catch(() => {})
    forwardMediaTime.set(clip.id, srcSec) // 刚 seek 到位，视为已到达；下一帧起才需要真正等
    return
  }

  await waitForFrameAtOrAfter(video, clip.id, srcSec)
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
  if (clip.kind !== 'video' || clip.offline) return null
  const el = getMediaEl(clip)
  if (!(el instanceof HTMLVideoElement)) return null
  return clipRectFor(el, clip, w, h)
}

/** 把一帧视频画到画布：cover 适配为基准，再叠加该线段的平移/缩放/旋转变换 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  clip: MediaClip,
  w: number,
  h: number
): void {
  if (video.readyState < 2) return
  const r = clipRectFor(video, clip, w, h)
  if (!r) return
  const deg = clip.rotate ?? 0
  if (deg) {
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate((deg * Math.PI) / 180)
    ctx.translate(-cx, -cy)
    ctx.drawImage(video, r.x, r.y, r.w, r.h)
    ctx.restore()
  } else {
    ctx.drawImage(video, r.x, r.y, r.w, r.h)
  }
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
    .filter((c) => c.kind === 'video' && !c.offline)
    .sort((a, b) => a.layer - b.layer || a.start - b.start)
  for (const clip of videos) {
    const lead = junctionLeadMs(clip, clips)
    // junction 预卷窗口内本段也算可见（叠加在前一段之上）
    if (clipRenderSourceTime(clip, tMs, projectEndMs, lead) === null) continue
    const el = getMediaEl(clip)
    if (!(el instanceof HTMLVideoElement)) continue
    const inLead = lead > 0 && tMs < clip.start
    // 预卷窗口用 junction 入场姿态；否则正常转场（junction 段跳过自身进场，避免重复）
    const fx = inLead ? junctionInFxAt(clip, tMs, lead) : clipTransition(clip, tMs, projectEndMs, lead > 0)
    if (fx.alpha <= 0.004) continue
    // 无转场时走快路径，避免每帧 save/restore
    if (fx.alpha === 1 && fx.dxFrac === 0 && fx.dyFrac === 0 && fx.scale === 1 && !fx.wipe) {
      drawCover(ctx, el, clip, width, height)
      continue
    }
    ctx.save()
    ctx.globalAlpha = fx.alpha
    if (fx.dxFrac !== 0 || fx.dyFrac !== 0) ctx.translate(fx.dxFrac * width, fx.dyFrac * height)
    if (fx.scale !== 1) {
      ctx.translate(width / 2, height / 2)
      ctx.scale(fx.scale, fx.scale)
      ctx.translate(-width / 2, -height / 2)
    }
    if (fx.wipe) applyWipeClip(ctx, fx.wipe, width, height)
    drawCover(ctx, el, clip, width, height)
    ctx.restore()
  }
}

/** 擦除遮罩：从某侧裁出 reveal 比例的可见区域 */
function applyWipeClip(ctx: CanvasRenderingContext2D, wipe: NonNullable<VideoClipFx['wipe']>, w: number, h: number): void {
  const r = Math.max(0, Math.min(1, wipe.reveal))
  ctx.beginPath()
  if (wipe.dir === 'L') ctx.rect(0, 0, w * r, h)
  else if (wipe.dir === 'R') ctx.rect(w * (1 - r), 0, w * r, h)
  else if (wipe.dir === 'U') ctx.rect(0, 0, w, h * r)
  else ctx.rect(0, h * (1 - r), w, h * r)
  ctx.clip()
}
