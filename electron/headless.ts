import { app, ipcMain } from 'electron'
import { readFileSync } from 'fs'
import { access, readFile, mkdir, writeFile } from 'fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'path'
import { readLrcText } from './lrcFile'
import {
  outExtension,
  type Container,
  type Codec,
  type Speed,
  type HwAccel,
  type EncodeSettings,
  type VideoFrameMode
} from './exporterCore'
import type { VideoTransition } from '../src/core/media'
import type { LineTextOverride } from '../src/core/types'

/** 转场写法：对象 { type, dur(秒) } 或简写字符串 "type:dur"（如 "fade:1"） */
type TransitionSpec = string | { type: string; dur: number }

/** 解析转场为 { type, durationMs }；类型合法性由渲染端 withClipDefaults 兜底校验 */
function parseTransition(spec: TransitionSpec | undefined): VideoTransition | null {
  if (!spec) return null
  let type = ''
  let durSec = NaN
  if (typeof spec === 'string') {
    const [t, d] = spec.split(':')
    type = (t ?? '').trim()
    durSec = Number(d)
  } else {
    type = String(spec.type ?? '')
    durSec = Number(spec.dur)
  }
  if (!type || !(durSec > 0)) return null
  return { type, durationMs: Math.round(durSec * 1000) }
}

/** job.json 里的媒体线段：字符串简写 = { path, start: 0, loop: 1 } */
export interface JobClipSpec {
  path: string
  /** 时间轴起点，秒 */
  start?: number
  /** 重复次数（≥1）或 'infinite'（循环到成片结束） */
  loop?: number | 'infinite'
  /** 源入点/出点（秒）：只取素材的这一段 */
  in?: number
  out?: number
  /** 播放速度倍率 0.25–4（音轨变速不变调） */
  speed?: number
  /** 视频层序：0 在最下，高层画面盖在低层上 */
  layer?: number
  /** 视频画面平移（画布像素）与缩放（cover 适配为 1.0） */
  x?: number
  y?: number
  scale?: number
  /** 音轨淡入/淡出时长（秒，0 = 无）；视频忽略 */
  fadeIn?: number
  fadeOut?: number
  /** 视频进/退场转场（音频忽略）；视频间转场 = 重叠两段 + 后段 transIn */
  transIn?: TransitionSpec
  transOut?: TransitionSpec
}

/** job.json 里的独立文字块 */
export interface JobTextSpec {
  text: string
  /** 起止，秒 */
  start: number
  end: number
  /** 特效 id（缺省跟随全局默认） */
  effect?: string
  /** 画面位置偏移（画布像素） */
  x?: number
  y?: number
  style?: LineTextOverride
}

/** job.json 里的额外字幕组（多语言字幕，与顶层 lrc 同时显示、不互相覆盖） */
export interface JobTrackSpec {
  /** 展示名，可省略 */
  name?: string
  /** 歌词/字幕文件路径（相对 job 文件所在目录，写法同顶层 lrc） */
  lrc: string
  /** 相对画面中心的纵向偏移（画布像素）；缺省沿用与手动新增字幕组相同的自动错开位置 */
  offsetY?: number
  visible?: boolean
  /** 键为该字幕组自己的行序号（"3"）或区间（"0-7"），与顶层 lineEffects 是各自独立的编号 */
  lineEffects?: Record<string, string>
  lineStyles?: Record<string, LineTextOverride>
}

/**
 * 无头导出模式（pipeline 用）：
 *   alicecut --export job.json
 * job.json 里 lrc/audio/video/out 的相对路径相对于 job 文件所在目录解析。
 */
export interface ExportJobFile {
  lrc: string
  /** 音轨：单个路径、单个对象或数组，均可带 start/loop */
  audio?: string | JobClipSpec | (string | JobClipSpec)[] | null
  /** 背景视频：同 audio 的写法 */
  video?: string | JobClipSpec | (string | JobClipSpec)[] | null
  /** 独立文字块（不参与歌词流，可选特效与字幕相同） */
  texts?: JobTextSpec[]
  /** 额外字幕组（多语言字幕）：与顶层 lrc（主字幕组）同时渲染，竖直错开不重叠 */
  tracks?: JobTrackSpec[]
  out?: string
  fps?: number
  /** 成片总时长（秒）；缺省 = max(歌词结尾, 有限媒体线段结尾) */
  duration?: number
  /** 输出容器，缺省 "mp4"；codec 为 "prores" 时强制视为 "mov"（out 路径必须以 .mov 结尾） */
  container?: Container
  /** 视频编码，缺省 "h264" */
  codec?: Codec
  /** 编码速度/画质档位，缺省 "balanced"（= 今天的固定行为，字节级一致） */
  speed?: Speed
  /** 硬件加速，缺省 "software"；"auto" 时探测失败会自动回退并在 stdout 打一行警告 */
  hwAccel?: HwAccel
  /** Keep Chromium GPU acceleration enabled for headless hardware/WebCodecs export. */
  gpu?: boolean
  /** 背景视频取景精度，缺省 "fast"（正向连续播放追帧，快很多）；"exact" 逐帧精确 seek，
   *  慢但同一次导出重跑字节级一致 */
  videoFrameMode?: VideoFrameMode
  /** 覆盖默认样式（StyleState 的子集，如 aspect/effectId/fontFamily/fontSize…） */
  style?: Record<string, unknown>
  /** 行级特效："3" 或 "0-7"（按歌词行序号）→ 特效 id */
  lineEffects?: Record<string, string>
  lineStyles?: Record<string, LineTextOverride>
}

/** 解析归一后的媒体线段（路径已绝对化、文件已确认存在） */
export interface HeadlessClip {
  kind: 'video' | 'audio'
  path: string
  name: string
  startMs: number
  loop: number | 'infinite'
  sourceInMs: number
  /** null = 到素材末尾（时长由渲染进程探测后回填） */
  sourceOutMs: number | null
  speed: number
  layer: number
  tx: number
  ty: number
  scale: number
  fadeInMs: number
  fadeOutMs: number
  transIn: VideoTransition | null
  transOut: VideoTransition | null
}

/** 解析归一后的额外字幕组（lrc 内容已读入，路径已绝对化） */
export interface HeadlessTrackSpec {
  name?: string
  lrcText: string
  lrcName: string
  offsetY?: number
  visible?: boolean
  lineEffects: Record<string, string>
  lineStyles: Record<string, LineTextOverride>
}

/** 准备好、可直接发给渲染进程的任务载荷 */
export interface HeadlessJobPayload {
  lrcText: string
  lrcName: string
  clips: HeadlessClip[]
  texts: JobTextSpec[]
  /** 额外字幕组，按 job.tracks 原顺序——渲染进程必须按此顺序依次处理，
   *  以保证铸造出的 trackId 与手动在 GUI 里逐个新增字幕组时一致 */
  tracks: HeadlessTrackSpec[]
  outPath: string
  fps: number
  durationSec: number | null
  style: Record<string, unknown>
  lineEffects: Record<string, string>
  lineStyles: Record<string, LineTextOverride>
  encode: EncodeSettings
  videoFrameMode: VideoFrameMode
  gpu: boolean
  /** Path to write .alicecut.json (null = don't save project) */
  projectOutPath: string | null
  /** Whether to also render video (false = project-only mode) */
  renderVideo: boolean
}

export function hasExportArg(argv: string[]): boolean {
  return argv.includes('--export')
}

export function parseExportArg(argv: string[]): string | null {
  const i = argv.indexOf('--export')
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}

export function hasSaveProjectArg(argv: string[]): boolean {
  return argv.includes('--save-project')
}

export function parseSaveProjectArg(argv: string[]): string | null {
  const i = argv.indexOf('--save-project')
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}

export function parseGpuPreference(jobText: string): boolean {
  try {
    return (JSON.parse(jobText.replace(/^﻿/, '')) as ExportJobFile).gpu === true
  } catch {
    return false
  }
}

export function jobRequestsGpu(jobPath: string | null): boolean {
  if (!jobPath) return false
  try {
    return parseGpuPreference(readFileSync(resolve(jobPath), 'utf8'))
  } catch {
    return false
  }
}

export async function prepareJob(jobPath: string): Promise<HeadlessJobPayload> {
  const jobAbs = resolve(jobPath)
  const jobDir = dirname(jobAbs)
  // 容忍 Windows 工具写出的 UTF-8 BOM
  const jobText = (await readFile(jobAbs, 'utf-8')).replace(/^﻿/, '')
  const job = JSON.parse(jobText) as ExportJobFile
  const rel = (p: string): string => (isAbsolute(p) ? p : resolve(jobDir, p))

  if (!job.lrc) throw new Error('job.lrc 缺失：必须指定歌词文件路径')

  const lrcPath = rel(job.lrc)
  const lrcText = await readLrcText(lrcPath)

  const clips: HeadlessClip[] = [
    ...(await normalizeClips('video', job.video, rel)),
    ...(await normalizeClips('audio', job.audio, rel))
  ]

  const outPath = job.out ? rel(job.out) : ''
  if (outPath) await mkdir(dirname(outPath), { recursive: true })

  const fps = Math.min(60, Math.max(10, Math.round(job.fps ?? 30)))
  const durationSec = typeof job.duration === 'number' && job.duration > 0 ? job.duration : null

  // 编码设置：缺省档位必须与今天的固定行为字节级一致（mp4/h264/balanced/software）。
  // 枚举值写错直接报错，而不是悄悄退回默认——批处理流水线里一个拼错的 codec 静默生效，
  // 可能很久都不会被发现
  const container = job.container ?? 'mp4'
  if (container !== 'mp4' && container !== 'mov') {
    throw new Error(`job.container 只能是 "mp4" 或 "mov"，收到: ${JSON.stringify(job.container)}`)
  }
  const codec = job.codec ?? 'h264'
  if (codec !== 'h264' && codec !== 'hevc' && codec !== 'prores') {
    throw new Error(`job.codec 只能是 "h264"/"hevc"/"prores"，收到: ${JSON.stringify(job.codec)}`)
  }
  const speed = job.speed ?? 'balanced'
  if (speed !== 'fast' && speed !== 'balanced' && speed !== 'quality') {
    throw new Error(`job.speed 只能是 "fast"/"balanced"/"quality"，收到: ${JSON.stringify(job.speed)}`)
  }
  const hwAccel = job.hwAccel ?? 'software'
  if (hwAccel !== 'auto' && hwAccel !== 'software') {
    throw new Error(`job.hwAccel 只能是 "auto"/"software"，收到: ${JSON.stringify(job.hwAccel)}`)
  }
  const encode: EncodeSettings = { container, codec, speed, hwAccel }

  if (job.gpu !== undefined && typeof job.gpu !== 'boolean') {
    throw new Error(`job.gpu 必须是 true/false，收到: ${JSON.stringify(job.gpu)}`)
  }

  const videoFrameMode = job.videoFrameMode ?? 'fast'
  if (videoFrameMode !== 'exact' && videoFrameMode !== 'fast') {
    throw new Error(`job.videoFrameMode 只能是 "exact"/"fast"，收到: ${JSON.stringify(job.videoFrameMode)}`)
  }

  // ProRes 只装在 .mov 容器：job.json 是自动化调用方明确写好的路径，静默改名可能弄坏下游流程，
  // 直接报错让调用方自己改（GUI 侧存盘对话框会自动带对扩展名，两边故意不对称）
  if (job.out && outExtension(encode) === 'mov' && !job.out.toLowerCase().endsWith('.mov')) {
    throw new Error(`codec 为 "prores" 时 job.out 必须以 .mov 结尾，收到: ${job.out}`)
  }

  const texts = (job.texts ?? []).map((t) => {
    if (!t.text || typeof t.start !== 'number' || typeof t.end !== 'number' || t.end <= t.start) {
      throw new Error(`texts 条目无效（需要 text 与 start < end 秒数）: ${JSON.stringify(t)}`)
    }
    return t
  })

  // 额外字幕组：逐个按 job.tracks 顺序读取（顺序会决定渲染进程里铸造 trackId 的顺序）
  const tracks: HeadlessTrackSpec[] = []
  for (const t of job.tracks ?? []) {
    if (!t.lrc) throw new Error('job.tracks 中的字幕组缺少 lrc 字段')
    const tPath = rel(t.lrc)
    const tText = await readLrcText(tPath)
    tracks.push({
      name: t.name,
      lrcText: tText,
      lrcName: basename(tPath),
      offsetY: t.offsetY,
      visible: t.visible,
      lineEffects: t.lineEffects ?? {},
      lineStyles: t.lineStyles ?? {}
    })
  }

  // 背景图片：把相对路径解析为绝对路径（相对 job 文件目录）
  const style = { ...(job.style ?? {}) }
  if (typeof style.bgImage === 'string') style.bgImage = rel(style.bgImage)

  return {
    lrcText,
    lrcName: basename(lrcPath),
    clips,
    texts,
    tracks,
    outPath,
    fps,
    durationSec,
    style,
    lineEffects: job.lineEffects ?? {},
    lineStyles: job.lineStyles ?? {},
    encode,
    videoFrameMode,
    gpu: job.gpu === true,
    projectOutPath: null,
    renderVideo: true
  }
}

/** 把 job 里的 audio/video 字段（字符串/对象/数组）归一成 HeadlessClip 列表；命令控制台经 IPC 直接复用 */
export async function normalizeClips(
  kind: 'video' | 'audio',
  spec: ExportJobFile['audio'],
  rel: (p: string) => string
): Promise<HeadlessClip[]> {
  if (!spec) return []
  const items = Array.isArray(spec) ? spec : [spec]
  const clips: HeadlessClip[] = []
  for (const item of items) {
    const obj: JobClipSpec = typeof item === 'string' ? { path: item } : item
    if (!obj.path) throw new Error(`job.${kind} 中的线段缺少 path 字段`)
    const path = rel(obj.path)
    await access(path).catch(() => {
      throw new Error(`job.${kind} 文件不存在: ${path}`)
    })
    const loop =
      obj.loop === 'infinite' ? ('infinite' as const) : Math.max(1, Math.round(Number(obj.loop ?? 1)) || 1)
    clips.push({
      kind,
      path,
      name: basename(path),
      startMs: Math.max(0, Math.round((obj.start ?? 0) * 1000)),
      loop,
      sourceInMs: Math.max(0, Math.round((obj.in ?? 0) * 1000)),
      sourceOutMs: obj.out !== undefined ? Math.round(obj.out * 1000) : null,
      speed: obj.speed ?? 1,
      layer: Math.max(0, Math.round(obj.layer ?? 0)),
      tx: Math.round(obj.x ?? 0),
      ty: Math.round(obj.y ?? 0),
      scale: obj.scale && obj.scale > 0 ? obj.scale : 1,
      fadeInMs: Math.max(0, Math.round((obj.fadeIn ?? 0) * 1000)),
      fadeOutMs: Math.max(0, Math.round((obj.fadeOut ?? 0) * 1000)),
      transIn: parseTransition(obj.transIn),
      transOut: parseTransition(obj.transOut)
    })
  }
  return clips
}

/**
 * 注册无头模式 IPC。GUI 模式也注册（payload 为 null），
 * 渲染进程启动时据此判断走 UI 还是无头导出。
 */
export function registerHeadlessHandlers(payload: HeadlessJobPayload | null): void {
  ipcMain.handle('headless:job', () => payload)

  // 无头模式直接写文件（不弹保存对话框）
  ipcMain.handle('file:saveProjectHeadless', async (_e, json: string, path: string) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, json, 'utf-8')
  })

  let lastPct = -1
  ipcMain.on('headless:progress', (_e, frac: number) => {
    const pct = Math.floor(frac * 100)
    if (pct > lastPct) {
      lastPct = pct
      console.log(`[export] ${pct}%`)
    }
  })

  ipcMain.on('headless:log', (_e, msg: string) => {
    console.log(`[export] ${msg}`)
  })

  ipcMain.handle('headless:done', (_e, r: { code: number; log: string }) => {
    if (!payload) return
    if (r.code === 0) {
      if (payload.renderVideo) console.log(`[export] done: ${payload.outPath}`)
      if (payload.projectOutPath) console.log(`[save-project] done: ${payload.projectOutPath}`)
    } else {
      console.error(`[export] failed (code ${r.code})\n${r.log}`)
    }
    // 给 stdout/ffmpeg 进程一点收尾时间
    setTimeout(() => app.exit(r.code === 0 ? 0 : 1), 80)
  })
}
