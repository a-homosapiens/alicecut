import { app, ipcMain } from 'electron'
import { access, readFile, mkdir } from 'fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'path'
import { readLrcText } from './lrcFile'

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
}

/**
 * 无头导出模式（pipeline 用）：
 *   dynamic-caption --export job.json
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
  out: string
  fps?: number
  /** 成片总时长（秒）；缺省 = max(歌词结尾, 有限媒体线段结尾) */
  duration?: number
  /** 覆盖默认样式（StyleState 的子集，如 aspect/effectId/fontFamily/fontSize…） */
  style?: Record<string, unknown>
  /** 行级特效："3" 或 "0-7"（按歌词行序号）→ 特效 id */
  lineEffects?: Record<string, string>
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
}

/** 准备好、可直接发给渲染进程的任务载荷 */
export interface HeadlessJobPayload {
  lrcText: string
  lrcName: string
  clips: HeadlessClip[]
  texts: JobTextSpec[]
  outPath: string
  fps: number
  durationSec: number | null
  style: Record<string, unknown>
  lineEffects: Record<string, string>
}

export function parseExportArg(argv: string[]): string | null {
  const i = argv.indexOf('--export')
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null
}

export async function prepareJob(jobPath: string): Promise<HeadlessJobPayload> {
  const jobAbs = resolve(jobPath)
  const jobDir = dirname(jobAbs)
  // 容忍 Windows 工具写出的 UTF-8 BOM
  const jobText = (await readFile(jobAbs, 'utf-8')).replace(/^﻿/, '')
  const job = JSON.parse(jobText) as ExportJobFile
  const rel = (p: string): string => (isAbsolute(p) ? p : resolve(jobDir, p))

  if (!job.lrc) throw new Error('job.lrc 缺失：必须指定歌词文件路径')
  if (!job.out) throw new Error('job.out 缺失：必须指定输出 mp4 路径')

  const lrcPath = rel(job.lrc)
  const lrcText = await readLrcText(lrcPath)

  const clips: HeadlessClip[] = [
    ...(await normalizeClips('video', job.video, rel)),
    ...(await normalizeClips('audio', job.audio, rel))
  ]

  const outPath = rel(job.out)
  await mkdir(dirname(outPath), { recursive: true })

  const fps = Math.min(60, Math.max(10, Math.round(job.fps ?? 30)))
  const durationSec = typeof job.duration === 'number' && job.duration > 0 ? job.duration : null

  const texts = (job.texts ?? []).map((t) => {
    if (!t.text || typeof t.start !== 'number' || typeof t.end !== 'number' || t.end <= t.start) {
      throw new Error(`texts 条目无效（需要 text 与 start < end 秒数）: ${JSON.stringify(t)}`)
    }
    return t
  })

  return {
    lrcText,
    lrcName: basename(lrcPath),
    clips,
    texts,
    outPath,
    fps,
    durationSec,
    style: job.style ?? {},
    lineEffects: job.lineEffects ?? {}
  }
}

/** 把 job 里的 audio/video 字段（字符串/对象/数组）归一成 HeadlessClip 列表 */
async function normalizeClips(
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
      scale: obj.scale && obj.scale > 0 ? obj.scale : 1
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
      console.log(`[export] done: ${payload.outPath}`)
    } else {
      console.error(`[export] failed (code ${r.code})\n${r.log}`)
    }
    // 给 stdout/ffmpeg 进程一点收尾时间
    setTimeout(() => app.exit(r.code === 0 ? 0 : 1), 80)
  })
}
