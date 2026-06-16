import { ipcMain } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { once } from 'events'
import ffmpegPath from 'ffmpeg-static'

/** 导出用音轨线段（含修剪/变速/循环），与渲染进程的 MediaClip 字段对应 */
export interface ExportAudioClip {
  path: string
  startMs: number
  sourceInMs: number
  sourceOutMs: number
  speed: number
  loop: number | 'infinite'
}

export interface ExportOptions {
  width: number
  height: number
  fps: number
  audioClips: ExportAudioClip[]
  /** 成片总时长（秒），音轨按此截断（无限循环靠它收尾） */
  durationSec: number
  outPath: string
}

let proc: ChildProcessWithoutNullStreams | null = null
let stderrTail = ''

/** 变速 → atempo 链：atempo 单级限 [0.5, 2]，超出的分解成多级（0.25–4 至多两级） */
function atempoChain(speed: number): string[] {
  const chain: string[] = []
  let f = speed
  while (f > 2) {
    chain.push('atempo=2')
    f /= 2
  }
  while (f < 0.5) {
    chain.push('atempo=0.5')
    f /= 0.5
  }
  if (Math.abs(f - 1) > 1e-6) chain.push(`atempo=${f.toFixed(6)}`)
  return chain
}

const AUDIO_RATE = 48000

/**
 * 单条音轨的滤镜链：
 * atrim 取修剪区间 → atempo 变速 → aloop 循环（统一重采样到 48k 定采样数）
 * → adelay 平移到时间轴起点。
 */
function audioClipFilter(clip: ExportAudioClip, inputIdx: number, label: string): string {
  const steps: string[] = [
    `atrim=start=${(clip.sourceInMs / 1000).toFixed(3)}:end=${(clip.sourceOutMs / 1000).toFixed(3)}`,
    'asetpts=PTS-STARTPTS',
    ...atempoChain(clip.speed),
    `aresample=${AUDIO_RATE}`
  ]
  if (clip.loop === 'infinite' || clip.loop > 1) {
    const segSec = (clip.sourceOutMs - clip.sourceInMs) / 1000 / clip.speed
    const size = Math.ceil(segSec * AUDIO_RATE)
    const loops = clip.loop === 'infinite' ? -1 : clip.loop - 1
    steps.push(`aloop=loop=${loops}:size=${size}`)
  }
  steps.push(`adelay=${Math.max(0, Math.round(clip.startMs))}:all=1`)
  return `[${inputIdx}:a]${steps.join(',')}${label}`
}

function buildArgs(o: ExportOptions): string[] {
  const args = [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${o.width}x${o.height}`,
    '-r', String(o.fps),
    '-i', 'pipe:0'
  ]
  for (const clip of o.audioClips) {
    args.push('-i', clip.path)
  }
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p')
  if (o.audioClips.length > 0) {
    const parts = o.audioClips.map((clip, i) => audioClipFilter(clip, i + 1, `[a${i}]`))
    let filter = parts.join(';')
    let outLabel = '[a0]'
    if (o.audioClips.length > 1) {
      const inputs = o.audioClips.map((_c, i) => `[a${i}]`).join('')
      filter += `;${inputs}amix=inputs=${o.audioClips.length}:duration=longest:normalize=0[aout]`
      outLabel = '[aout]'
    }
    args.push('-filter_complex', filter, '-map', '0:v', '-map', outLabel)
    args.push('-c:a', 'aac', '-b:a', '192k')
  }
  // 成片时长以画面为准：超出的音轨（含无限循环）在此截断
  args.push('-t', o.durationSec.toFixed(3))
  args.push('-movflags', '+faststart', o.outPath)
  return args
}

/** 用 ffmpeg -i 探测文件是否含音频流（视频提取音频前校验） */
function probeHasAudio(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!ffmpegPath) {
      resolve(false)
      return
    }
    const p = spawn(ffmpegPath as string, ['-hide_banner', '-i', path], { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d: Buffer) => {
      err += d.toString()
    })
    p.on('close', () => resolve(/Stream #\d+:\d+.*Audio/.test(err)))
    p.on('error', () => resolve(false))
  })
}

export function registerExportHandlers(): void {
  ipcMain.handle('media:hasAudio', (_e, path: string) => probeHasAudio(path))

  ipcMain.handle('export:start', (_e, opts: ExportOptions) => {
    if (proc) throw new Error('已有导出任务在进行中')
    if (!ffmpegPath) throw new Error('未找到 ffmpeg 可执行文件')
    stderrTail = ''
    proc = spawn(ffmpegPath as string, buildArgs(opts), { windowsHide: true })
    proc.stderr.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000)
    })
    proc.on('error', () => {
      /* 错误通过 export:end 的退出码上报 */
    })
  })

  // 背压：stdin 写满时等 drain 再返回，渲染进程 await 后才画下一帧
  ipcMain.handle('export:frame', async (_e, frame: Uint8Array) => {
    if (!proc) throw new Error('导出未开始')
    const ok = proc.stdin.write(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength))
    if (!ok) await once(proc.stdin, 'drain')
  })

  ipcMain.handle('export:end', async () => {
    if (!proc) throw new Error('导出未开始')
    const p = proc
    p.stdin.end()
    const [code] = (await once(p, 'close')) as [number]
    proc = null
    return { code, log: stderrTail }
  })

  ipcMain.handle('export:cancel', () => {
    if (proc) {
      proc.kill('SIGKILL')
      proc = null
    }
  })
}
