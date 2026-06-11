import { ipcMain } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { once } from 'events'
import ffmpegPath from 'ffmpeg-static'

/** 导出用音轨线段：路径 + 时间轴起点 + 循环（'infinite' = 循环到视频结束） */
export interface ExportAudioClip {
  path: string
  startMs: number
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

function buildArgs(o: ExportOptions): string[] {
  const args = [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${o.width}x${o.height}`,
    '-r', String(o.fps),
    '-i', 'pipe:0'
  ]
  // 每条音轨一个输入：-stream_loop 负责重复（-1 = 无限，靠输出端 -t 截断）
  for (const clip of o.audioClips) {
    const loops = clip.loop === 'infinite' ? -1 : Math.max(0, Math.round(clip.loop) - 1)
    args.push('-stream_loop', String(loops), '-i', clip.path)
  }
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p')
  if (o.audioClips.length > 0) {
    // adelay 把每条音轨平移到自己的起点，多条时 amix 混音
    const delayed = o.audioClips.map((clip, i) => {
      const d = Math.max(0, Math.round(clip.startMs))
      return `[${i + 1}:a]adelay=${d}:all=1[a${i}]`
    })
    let filter = delayed.join(';')
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

export function registerExportHandlers(): void {
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
