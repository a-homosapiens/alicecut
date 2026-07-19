import type { EncodeSettings, VideoDims, VideoFrameMode } from '../electron/exporterCore'

const H264_BPP = { fast: 0.12, balanced: 0.18, quality: 0.26 } as const
const supportCache = new Map<string, Promise<boolean>>()

export function buildWebCodecsConfig(encode: EncodeSettings, dims: VideoDims): VideoEncoderConfig | null {
  if (encode.codec !== 'h264' || encode.hwAccel !== 'auto') return null
  const level = dims.width * dims.height * dims.fps > 1920 * 1080 * 30 ? '2a' : '28'
  return {
    codec: `avc1.6400${level}`,
    width: dims.width,
    height: dims.height,
    bitrate: Math.round(dims.width * dims.height * dims.fps * H264_BPP[encode.speed]),
    bitrateMode: 'variable',
    framerate: dims.fps,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'quality',
    alpha: 'discard',
    avc: { format: 'annexb' }
  }
}

export function shouldTryWebCodecsExport(encode: EncodeSettings, videoFrameMode: VideoFrameMode): boolean {
  return encode.codec === 'h264' && encode.hwAccel === 'auto' && videoFrameMode === 'fast'
}

export async function canUseWebCodecsExport(
  encode: EncodeSettings,
  videoFrameMode: VideoFrameMode,
  dims: VideoDims
): Promise<VideoEncoderConfig | null> {
  if (!shouldTryWebCodecsExport(encode, videoFrameMode) || typeof VideoEncoder === 'undefined') return null
  const config = buildWebCodecsConfig(encode, dims)
  if (!config) return null
  const key = JSON.stringify(config)
  let supported = supportCache.get(key)
  if (!supported) {
    supported = VideoEncoder.isConfigSupported(config)
      .then((result) => result.supported === true)
      .catch(() => false)
    supportCache.set(key, supported)
  }
  return await supported ? config : null
}

export class WebCodecsFrameSink {
  private encoder: VideoEncoder | null = null
  private failure: Error | null = null
  private pendingWrites = new Set<Promise<void>>()

  constructor(
    private readonly config: VideoEncoderConfig,
    private readonly fps: number
  ) {}

  async start(options: Parameters<typeof window.desktop.exportStart>[0]): Promise<void> {
    await window.desktop.exportStart({ ...options, videoInput: 'h264-annexb' })
    try {
      this.encoder = new VideoEncoder({
        output: (chunk) => {
          const bytes = new Uint8Array(chunk.byteLength)
          chunk.copyTo(bytes)
          const write = window.desktop.exportFrame(bytes)
          this.pendingWrites.add(write)
          write
            .catch((err: unknown) => {
              this.failure = err instanceof Error ? err : new Error(String(err))
              this.encoder?.dispatchEvent(new Event('dequeue'))
            })
            .finally(() => this.pendingWrites.delete(write))
        },
        error: (err) => {
          this.failure = err
          this.encoder?.dispatchEvent(new Event('dequeue'))
        }
      })
      this.encoder.configure(this.config)
    } catch (err) {
      await window.desktop.exportCancel().catch(() => {})
      throw err
    }
  }

  private throwIfFailed(): void {
    if (this.failure) throw this.failure
  }

  async submit(canvas: HTMLCanvasElement, frameIndex: number): Promise<void> {
    const encoder = this.encoder
    if (!encoder) throw new Error('WebCodecs encoder is not started')
    this.throwIfFailed()
    while (encoder.encodeQueueSize > 4) {
      await new Promise<void>((resolve) => encoder.addEventListener('dequeue', () => resolve(), { once: true }))
      this.throwIfFailed()
    }
    if (this.pendingWrites.size > 8) {
      await Promise.race(this.pendingWrites)
      this.throwIfFailed()
    }
    const frameDuration = Math.round(1_000_000 / this.fps)
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round((frameIndex * 1_000_000) / this.fps),
      duration: frameDuration
    })
    try {
      encoder.encode(frame, { keyFrame: frameIndex % (this.fps * 2) === 0 })
    } finally {
      frame.close()
    }
  }

  async finish(): Promise<{ code: number; log: string }> {
    const encoder = this.encoder
    if (!encoder) throw new Error('WebCodecs encoder is not started')
    await encoder.flush()
    this.throwIfFailed()
    await Promise.all(this.pendingWrites)
    this.throwIfFailed()
    encoder.close()
    this.encoder = null
    return window.desktop.exportEnd()
  }

  async cancel(): Promise<void> {
    if (this.encoder && this.encoder.state !== 'closed') this.encoder.close()
    this.encoder = null
    await window.desktop.exportCancel()
  }
}
