import { app, ipcMain, type WebContents } from 'electron'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { mkdirSync, existsSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import ffmpegPath from 'ffmpeg-static'
import { parseProbe, decideConversion, convertArgs, parseProgress } from './convertCore'

/**
 * 导入归一化：把 Chromium <video> 不能直接播放的视频（mkv/avi/ProRes/HEVC…）
 * 用内置 ffmpeg 转成 H.264 MP4（能复制流就快速重封装，否则转码），缓存到 userData/converted。
 * 缓存键含源文件大小与修改时间——同一文件再次导入直接命中缓存；工程保存引用的是缓存路径。
 */

function cacheDir(): string {
  const d = join(app.getPath('userData'), 'converted')
  try {
    mkdirSync(d, { recursive: true })
  } catch {
    /* 已存在或无权限 */
  }
  return d
}

function probe(path: string): Promise<{ codec: string | null; durationMs: number }> {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve({ codec: null, durationMs: 0 })
    const p = spawn(ffmpegPath as string, ['-hide_banner', '-i', path], { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d: Buffer) => {
      err += d.toString()
    })
    p.on('close', () => resolve(parseProbe(err)))
    p.on('error', () => resolve({ codec: null, durationMs: 0 }))
  })
}

export interface EnsureResult {
  path: string
  converted: boolean
}

async function ensurePlayable(srcPath: string, wc: WebContents): Promise<EnsureResult> {
  if (!ffmpegPath) return { path: srcPath, converted: false }
  const { codec, durationMs } = await probe(srcPath)
  const action = decideConversion(extname(srcPath), codec)
  if (action === 'passthrough') return { path: srcPath, converted: false }

  // 缓存：源路径 + 大小 + mtime → 命中则跳过转换
  let key = srcPath
  try {
    const s = statSync(srcPath)
    key += `|${s.size}|${s.mtimeMs}`
  } catch {
    /* 无法 stat：仅用路径 */
  }
  const out = join(cacheDir(), `${createHash('sha1').update(key).digest('hex').slice(0, 16)}.mp4`)
  if (existsSync(out)) return { path: out, converted: true }

  const name = basename(srcPath)
  wc.send('media:convertProgress', { name, frac: 0 })
  await new Promise<void>((resolve, reject) => {
    const p = spawn(ffmpegPath as string, convertArgs(srcPath, out, action), { windowsHide: true })
    p.stderr.on('data', (d: Buffer) => {
      const frac = parseProgress(d.toString(), durationMs)
      if (frac != null) wc.send('media:convertProgress', { name, frac })
    })
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`视频转换失败 (code ${code})`))))
    p.on('error', reject)
  })
  return { path: out, converted: true }
}

export function registerConvertHandlers(): void {
  ipcMain.handle('media:ensurePlayable', (e, path: string) => ensurePlayable(path, e.sender))
}
