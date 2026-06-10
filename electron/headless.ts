import { app, ipcMain } from 'electron'
import { readFile, mkdir } from 'fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'path'
import { readLrcText } from './lrcFile'

/**
 * 无头导出模式（pipeline 用）：
 *   dynamic-caption --export job.json
 * job.json 里 lrc/audio/out 的相对路径相对于 job 文件所在目录解析。
 */
export interface ExportJobFile {
  lrc: string
  audio?: string | null
  out: string
  fps?: number
  /** 覆盖默认样式（StyleState 的子集，如 aspect/effectId/fontFamily/fontSize…） */
  style?: Record<string, unknown>
  /** 行级特效："3" 或 "0-7"（按歌词行序号）→ 特效 id */
  lineEffects?: Record<string, string>
}

/** 准备好、可直接发给渲染进程的任务载荷 */
export interface HeadlessJobPayload {
  lrcText: string
  lrcName: string
  audioPath: string | null
  audioData: ArrayBuffer | null
  outPath: string
  fps: number
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

  let audioPath: string | null = null
  let audioData: ArrayBuffer | null = null
  if (job.audio) {
    audioPath = rel(job.audio)
    const buf = await readFile(audioPath) // 文件缺失直接抛错退出
    audioData = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }

  const outPath = rel(job.out)
  await mkdir(dirname(outPath), { recursive: true })

  const fps = Math.min(60, Math.max(10, Math.round(job.fps ?? 30)))

  return {
    lrcText,
    lrcName: basename(lrcPath),
    audioPath,
    audioData,
    outPath,
    fps,
    style: job.style ?? {},
    lineEffects: job.lineEffects ?? {}
  }
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
