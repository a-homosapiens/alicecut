/**
 * 导出设置的纯逻辑/类型（无 electron 依赖，便于单测；渲染进程和主进程都会 import 这里的类型）。
 * 硬件编码器"是否真的存在于这台机器"由 exporter.ts 探测决定；这里只管：
 * 给定平台该按什么顺序尝试哪些编码器名字（hwCandidates），以及给定"已解析好的编码器"
 * 该拼出哪些 ffmpeg 参数（buildVideoArgs）——本文件不 spawn 任何进程。
 */

export type Container = 'mp4' | 'mov'
export type Codec = 'h264' | 'hevc' | 'prores'
export type Speed = 'fast' | 'balanced' | 'quality'
export type HwAccel = 'auto' | 'software'
export type VideoInputKind = 'rawvideo' | 'h264-annexb'

export interface EncodeSettings {
  container: Container
  codec: Codec
  speed: Speed
  hwAccel: HwAccel
}

/**
 * 背景视频取景精度：'fast' 用正向连续播放追帧（快一个数量级，见 exportRunner.ts /
 * mediaPool.ts 的 waitForSourceTime），代价是同一次导出重跑两遍时视频画面可能有
 * 亚帧级别的细微差异（不影响音频/文字/无背景视频的导出，那些依旧逐帧确定性）；
 * 'exact' 是原来的逐帧精确 seek，慢但每次重跑字节级一致。默认 'fast'。
 */
export type VideoFrameMode = 'exact' | 'fast'

export interface ResolvedEncoder {
  /** ffmpeg 编码器名，如 'libx264' / 'h264_qsv' / 'prores_ks' */
  name: string
  isHardware: boolean
}

const TIER: Record<Speed, 0 | 1 | 2> = { fast: 0, balanced: 1, quality: 2 }

// 软件 x264/x265：两者共用同一套 -preset 字符串空间（gyan.dev 6.1.1 build 的 -h encoder= 已确认）。
// x265 CRF = x264 CRF + 5，是社区通用的感知等效换算（x265 自身默认 CRF 就是 28，与此换算一致）。
const X264_PRESET = ['veryfast', 'medium', 'slow'] as const
const X264_CRF = [20, 18, 16] as const // balanced=18 是今天的实际默认值，必须保持字节级一致
const X265_PRESET = ['veryfast', 'medium', 'slow'] as const
const X265_CRF = [25, 23, 21] as const

// NVENC：-b:v 0 必须和 -cq 同时给，否则 nvenc 的默认码率上限仍会在 "cq 模式" 下限制画质
const NVENC_PRESET = ['p2', 'p4', 'p6'] as const
const NVENC_CQ = [29, 23, 19] as const

// QSV：这套组合在开发机上实测跑通过一次真实编码（非仅查表）
const QSV_PRESET = ['veryfast', 'medium', 'slower'] as const
const QSV_QUALITY = [28, 23, 18] as const

// AMF：-quality/-rc 的符号名在 h264_amf/hevc_amf 间通用，但底层整数值不同——
// 必须始终传符号名（'balanced'），不能传数字，否则两个 codec 分支会得到不同语义
const AMF_QUALITY = ['speed', 'balanced', 'quality'] as const
const AMF_QVBR = [32, 24, 18] as const

// VideoToolbox：本次会话没有 Mac 可验证，故意选码率控制（长期公认最稳妥）而非 -q:v
// （新版本才有，量表方向不确定）。bpp = 每像素比特数，hevc 效率更高故取 h264 的约 0.6 倍。
const VT_H264_BPP = [0.07, 0.1, 0.14] as const
const VT_HEVC_BPP = [0.042, 0.06, 0.084] as const

// ProRes：0=proxy 1=lt 2=standard 3=hq（-h encoder=prores_ks 已确认），三档不用最低的 proxy
const PRORES_PROFILE = [1, 2, 3] as const

/** ProRes 实际上只装在 .mov 里；其它编码沿用用户选择的容器 */
export function outExtension(encode: EncodeSettings): Container {
  return encode.codec === 'prores' ? 'mov' : encode.container
}

/**
 * 按平台给出硬件编码器候选（按优先级），probeEncoder 会依次试。
 * Windows 故意不含 *_mf：同一台机器上 h264_mf 探测成功但 hevc_mf 失败，
 * 说明 Media Foundation 在没有对应硬件 MFT 时会静默退化成软件 MFT——
 * ffmpeg 的成功/失败退出码分不清"真硬件"和"MF 自己的软件兜底"，不能作为硬件判据。
 * Linux 留空：vaapi 需要 -vaapi_device + hwupload 的完全不同滤镜链，不是简单换 -c:v，本轮不做。
 */
export function hwCandidates(platform: NodeJS.Platform, codec: 'h264' | 'hevc'): string[] {
  if (platform === 'darwin') return [`${codec}_videotoolbox`]
  if (platform === 'win32') return [`${codec}_nvenc`, `${codec}_qsv`, `${codec}_amf`]
  return []
}

export function softwareEncoderName(codec: 'h264' | 'hevc'): string {
  return codec === 'h264' ? 'libx264' : 'libx265'
}

/** 视频画面尺寸/帧率，VideoToolbox 的码率估算需要 */
export interface VideoDims {
  width: number
  height: number
  fps: number
}

export function buildVideoInputArgs(kind: VideoInputKind, dims: VideoDims): string[] {
  if (kind === 'h264-annexb') {
    return ['-f', 'h264', '-framerate', String(dims.fps), '-i', 'pipe:0']
  }
  return [
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${dims.width}x${dims.height}`,
    '-r', String(dims.fps),
    '-i', 'pipe:0'
  ]
}

export interface StaticOverlayGraph {
  /** Arguments inserted after the raw RGBA overlay input and before audio inputs. */
  inputArgs: string[]
  /** First ffmpeg input index available for audio clips. */
  audioInputOffset: number
  filter: string
  videoMap: string
}

/**
 * Build the ffmpeg side of the static-background export path. Input 0 is the
 * transparent RGBA animation stream; input 1 is a single PNG looped forever.
 */
export function buildStaticOverlayGraph(backgroundPath: string, fps: number): StaticOverlayGraph {
  return {
    inputArgs: ['-loop', '1', '-framerate', String(fps), '-i', backgroundPath],
    audioInputOffset: 2,
    filter: '[1:v]format=rgba[bg];[bg][0:v]overlay=0:0:shortest=1:format=auto[vout]',
    videoMap: '[vout]'
  }
}

/** 纯参数构建：编码器名字与是否硬件已由调用方（exporter.ts 的探测/回退逻辑）解析好 */
export function buildVideoArgs(encode: EncodeSettings, resolved: ResolvedEncoder, dims: VideoDims): string[] {
  const i = TIER[encode.speed]
  const compatibilityTag = encode.codec === 'hevc' ? ['-tag:v', 'hvc1'] : []

  if (encode.codec === 'prores') {
    return ['-c:v', 'prores_ks', '-profile:v', String(PRORES_PROFILE[i]), '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le']
  }

  const name = resolved.name
  if (!resolved.isHardware) {
    const preset = encode.codec === 'h264' ? X264_PRESET[i] : X265_PRESET[i]
    const crf = encode.codec === 'h264' ? X264_CRF[i] : X265_CRF[i]
    return ['-c:v', name, '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', ...compatibilityTag]
  }

  if (name.endsWith('_nvenc')) {
    return ['-c:v', name, '-preset', NVENC_PRESET[i], '-rc', 'vbr', '-cq', String(NVENC_CQ[i]), '-b:v', '0', '-pix_fmt', 'yuv420p', ...compatibilityTag]
  }
  if (name.endsWith('_qsv')) {
    return ['-c:v', name, '-preset', QSV_PRESET[i], '-global_quality', String(QSV_QUALITY[i]), '-pix_fmt', 'yuv420p', ...compatibilityTag]
  }
  if (name.endsWith('_amf')) {
    return ['-c:v', name, '-quality', AMF_QUALITY[i], '-rc', 'qvbr', '-qvbr_quality_level', String(AMF_QVBR[i]), '-pix_fmt', 'yuv420p', ...compatibilityTag]
  }
  if (name.endsWith('_videotoolbox')) {
    const bpp = (encode.codec === 'h264' ? VT_H264_BPP : VT_HEVC_BPP)[i]
    const bitrate = Math.max(500_000, Math.round(dims.width * dims.height * dims.fps * bpp))
    return ['-c:v', name, '-b:v', String(bitrate), '-pix_fmt', 'yuv420p', ...compatibilityTag]
  }

  throw new Error(`未知硬件编码器: ${name}`)
}
