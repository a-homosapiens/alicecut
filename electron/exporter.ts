import { ipcMain } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { once } from 'events'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import ffmpegPath from 'ffmpeg-static'
import {
  buildStaticOverlayGraph,
  buildVideoInputArgs,
  buildVideoArgs,
  hwCandidates,
  softwareEncoderName,
  type EncodeSettings,
  type ResolvedEncoder,
  type VideoInputKind
} from './exporterCore'

/** 导出用音轨线段（含修剪/变速/循环），与渲染进程的 MediaClip 字段对应 */
export interface ExportAudioClip {
  path: string
  startMs: number
  sourceInMs: number
  sourceOutMs: number
  speed: number
  loop: number | 'infinite'
  /** 淡入/淡出时长 ms（0 = 无） */
  fadeInMs: number
  fadeOutMs: number
}

export interface ExportOptions {
  width: number
  height: number
  fps: number
  audioClips: ExportAudioClip[]
  /** 成片总时长（秒），音轨按此截断（无限循环靠它收尾） */
  durationSec: number
  outPath: string
  encode: EncodeSettings
  videoInput?: VideoInputKind
  /** Present when stdin contains transparent text frames instead of complete frames. */
  staticBackgroundPng?: Uint8Array
}

let proc: ChildProcessWithoutNullStreams | null = null
let procClose: Promise<number> | null = null
let stderrTail = ''
let exportTempDir: string | null = null
let frameWriteChain: Promise<void> = Promise.resolve()
// export:start 里探测硬件编码器要 await，这段时间窗口 `if (proc) throw` 保护不到——
// 加一把同步锁，在任何 await 之前立刻生效
let starting = false

/**
 * 用极小的测试源探测某个硬件编码器名字在这台机器上能不能真的初始化成功。
 * 用 speed:'balanced' 档位的真实参数（而非裸 -c:v 名字）去探测，这样连"编码器名字存在
 * 但这一档具体参数有误"（比如 AMF/VideoToolbox 的猜测参数出错）也能在探测阶段就发现，
 * 不会等真正导出时才失败。只认 code===0——ffmpeg 失败退出码并不统一是 1
 * （同一台机器上观察到 127、171 两种不同失败原因的退出码）。
 */
function probeEncoder(codec: 'h264' | 'hevc', name: string): Promise<boolean> {
  if (!ffmpegPath) return Promise.resolve(false)
  let videoArgs: string[]
  try {
    videoArgs = buildVideoArgs(
      { container: 'mp4', codec, speed: 'balanced', hwAccel: 'auto' },
      { name, isHardware: true },
      { width: 64, height: 64, fps: 30 }
    )
  } catch {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=size=64x64:duration=0.1',
      ...videoArgs,
      '-f',
      'null',
      '-'
    ]
    const p = spawn(ffmpegPath as string, args, { windowsHide: true })
    p.on('close', (code) => resolve(code === 0))
    p.on('error', () => resolve(false))
  })
}

// 每个 codec 探测一次就够（同一硬件对 fast/balanced/quality 三档只是参数值不同，
// 探测阶段只需确认这套参数"名字"能被接受），按 app 运行期缓存——负例（回退到软件）也缓存，
// 否则每次没装硬件的机器每次导出都要重新跑一遍失败的探测
const encoderCache = new Map<'h264' | 'hevc', ResolvedEncoder>()

async function resolveEncoder(codec: 'h264' | 'hevc', hwAccel: EncodeSettings['hwAccel']): Promise<ResolvedEncoder> {
  const software: ResolvedEncoder = { name: softwareEncoderName(codec), isHardware: false }
  if (hwAccel === 'software') return software
  const cached = encoderCache.get(codec)
  if (cached) return cached
  for (const name of hwCandidates(process.platform, codec)) {
    if (await probeEncoder(codec, name)) {
      const resolved: ResolvedEncoder = { name, isHardware: true }
      encoderCache.set(codec, resolved)
      return resolved
    }
  }
  // 只走主进程 console：这段代码从不在渲染进程跑，headless CLI 和 GUI 开发模式的终端都能看到，
  // 不需要像 headless:log 那样另开一条 IPC 桥接渲染进程到 stdout
  console.warn(`[export] 未探测到可用的硬件编码器（${codec}），已回退到软件编码 ${software.name}`)
  encoderCache.set(codec, software)
  return software
}

async function resolveEncoderForSettings(encode: EncodeSettings): Promise<ResolvedEncoder> {
  if (encode.codec === 'prores') return { name: 'prores_ks', isHardware: false }
  return resolveEncoder(encode.codec, encode.hwAccel)
}

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
 * → afade 淡入/淡出（作用于循环后的整段，st 为流内时间）→ adelay 平移到时间轴起点。
 */
function audioClipFilter(
  clip: ExportAudioClip,
  inputIdx: number,
  label: string,
  durationSec: number
): string {
  const segSec = (clip.sourceOutMs - clip.sourceInMs) / 1000 / clip.speed
  const steps: string[] = [
    `atrim=start=${(clip.sourceInMs / 1000).toFixed(3)}:end=${(clip.sourceOutMs / 1000).toFixed(3)}`,
    'asetpts=PTS-STARTPTS',
    ...atempoChain(clip.speed),
    `aresample=${AUDIO_RATE}`
  ]
  if (clip.loop === 'infinite' || clip.loop > 1) {
    const size = Math.ceil(segSec * AUDIO_RATE)
    const loops = clip.loop === 'infinite' ? -1 : clip.loop - 1
    steps.push(`aloop=loop=${loops}:size=${size}`)
  }
  // 淡入：从流首（= 线段起点）开始；淡出：到线段在时间轴上的可听结束处
  // （无限循环按项目结束折算，否则为循环后总长）
  const placedSec = clip.loop === 'infinite' ? Math.max(0, durationSec - clip.startMs / 1000) : segSec * clip.loop
  if (clip.fadeInMs > 0) {
    steps.push(`afade=t=in:st=0:d=${(clip.fadeInMs / 1000).toFixed(3)}`)
  }
  if (clip.fadeOutMs > 0 && placedSec > 0) {
    const d = Math.min(clip.fadeOutMs / 1000, placedSec)
    steps.push(`afade=t=out:st=${Math.max(0, placedSec - d).toFixed(3)}:d=${d.toFixed(3)}`)
  }
  steps.push(`adelay=${Math.max(0, Math.round(clip.startMs))}:all=1`)
  return `[${inputIdx}:a]${steps.join(',')}${label}`
}

function buildArgs(o: ExportOptions, resolved: ResolvedEncoder | null, staticBackgroundPath?: string): string[] {
  const videoInput = o.videoInput ?? 'rawvideo'
  const args = [
    '-y',
    ...buildVideoInputArgs(videoInput, { width: o.width, height: o.height, fps: o.fps })
  ]
  const overlayGraph = staticBackgroundPath ? buildStaticOverlayGraph(staticBackgroundPath, o.fps) : null
  if (overlayGraph) args.push(...overlayGraph.inputArgs)
  for (const clip of o.audioClips) {
    args.push('-i', clip.path)
  }
  if (videoInput === 'h264-annexb') {
    args.push('-c:v', 'copy')
  } else {
    if (!resolved) throw new Error('Raw video export requires a resolved encoder')
    args.push(...buildVideoArgs(o.encode, resolved, { width: o.width, height: o.height, fps: o.fps }))
  }
  const filterParts: string[] = overlayGraph ? [overlayGraph.filter] : []
  let audioMap: string | null = null
  if (o.audioClips.length > 0) {
    const inputOffset = overlayGraph?.audioInputOffset ?? 1
    filterParts.push(
      ...o.audioClips.map((clip, i) => audioClipFilter(clip, inputOffset + i, `[a${i}]`, o.durationSec))
    )
    audioMap = '[a0]'
    if (o.audioClips.length > 1) {
      const inputs = o.audioClips.map((_c, i) => `[a${i}]`).join('')
      filterParts.push(`${inputs}amix=inputs=${o.audioClips.length}:duration=longest:normalize=0[aout]`)
      audioMap = '[aout]'
    }
  }
  if (filterParts.length > 0) {
    args.push('-filter_complex', filterParts.join(';'), '-map', overlayGraph?.videoMap ?? '0:v')
  }
  if (audioMap) {
    args.push('-map', audioMap)
    args.push('-c:a', 'aac', '-b:a', '192k')
  }
  // 成片时长以画面为准：超出的音轨（含无限循环）在此截断
  args.push('-t', o.durationSec.toFixed(3))
  // faststart 是容器级选项（把 moov atom 提前），.mp4/.mov 都是 ISO-BMFF 家族，两种容器都适用，
  // 不需要按 container 分支
  args.push('-movflags', '+faststart', o.outPath)
  return args
}

async function removeExportTempDir(): Promise<void> {
  const dir = exportTempDir
  exportTempDir = null
  if (dir) await rm(dir, { recursive: true, force: true })
}

async function writeStaticBackground(png: Uint8Array): Promise<string> {
  if (png.byteLength < 8) throw new Error('Static export background PNG is empty')
  const dir = await mkdtemp(join(tmpdir(), 'alicecut-export-'))
  exportTempDir = dir
  const path = join(dir, 'background.png')
  await writeFile(path, png)
  return path
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

  ipcMain.handle('export:start', async (_e, opts: ExportOptions) => {
    if (proc || starting) throw new Error('已有导出任务在进行中')
    if (!ffmpegPath) throw new Error('未找到 ffmpeg 可执行文件')
    starting = true // 下面探测硬件编码器要 await；这把锁在此立刻生效，防止并发 export:start 都通过上面的检查
    try {
      const videoInput = opts.videoInput ?? 'rawvideo'
      if (videoInput !== 'rawvideo' && opts.staticBackgroundPng) {
        throw new Error('Encoded video input cannot use the static alpha-overlay graph')
      }
      const resolved = videoInput === 'rawvideo' ? await resolveEncoderForSettings(opts.encode) : null
      const staticBackgroundPath = videoInput === 'rawvideo' && opts.staticBackgroundPng
        ? await writeStaticBackground(opts.staticBackgroundPng)
        : undefined
      stderrTail = ''
      proc = spawn(ffmpegPath as string, buildArgs(opts, resolved, staticBackgroundPath), { windowsHide: true })
      procClose = new Promise((resolve) => proc?.once('close', (code) => resolve(code ?? -1)))
      frameWriteChain = Promise.resolve()
      proc.stderr.on('data', (d: Buffer) => {
        stderrTail = (stderrTail + d.toString()).slice(-4000)
      })
      proc.on('error', () => {
        /* 错误通过 export:end 的退出码上报 */
      })
    } catch (err) {
      await removeExportTempDir().catch(() => {})
      throw err
    } finally {
      starting = false
    }
  })

  // 背压：stdin 写满时等 drain 再返回，渲染进程 await 后才画下一帧
  ipcMain.handle('export:frame', async (_e, frame: Uint8Array, repeat = 1) => {
    if (!proc) throw new Error('导出未开始')
    const target = proc
    const buf = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)
    const copies = Math.max(1, Math.round(repeat))
    const write = frameWriteChain.then(async () => {
      if (proc !== target) throw new Error('导出任务已结束')
      for (let i = 0; i < copies; i++) {
        const ok = target.stdin.write(buf)
        if (!ok) await once(target.stdin, 'drain')
      }
    })
    frameWriteChain = write.catch(() => {})
    await write
  })

  ipcMain.handle('export:end', async () => {
    if (!proc) throw new Error('导出未开始')
    const p = proc
    const closed = procClose
    await frameWriteChain
    p.stdin.end()
    const code = closed ? await closed : -1
    proc = null
    procClose = null
    await removeExportTempDir().catch(() => {})
    return { code, log: stderrTail }
  })

  ipcMain.handle('export:cancel', async () => {
    if (proc) {
      const p = proc
      proc = null
      const closed = procClose ?? once(p, 'close').then(([code]) => Number(code ?? -1)).catch(() => -1)
      procClose = null
      p.kill('SIGKILL')
      await closed
    }
    await removeExportTempDir().catch(() => {})
  })
}
