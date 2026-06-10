import { ipcMain } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { once } from 'events'
import ffmpegPath from 'ffmpeg-static'

export interface ExportOptions {
  width: number
  height: number
  fps: number
  audioPath: string | null
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
  if (o.audioPath) args.push('-i', o.audioPath)
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p')
  if (o.audioPath) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest')
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
