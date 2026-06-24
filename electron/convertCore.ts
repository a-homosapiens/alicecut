/**
 * 导入归一化的纯逻辑（无 electron 依赖，便于单测）。
 * 输入视频由 Chromium <video> 解码（预览与导出都画 <video> 帧），因此能否使用取决于
 * Chromium 支持的容器/编码；不支持的（mkv/avi/ProRes/HEVC…）在导入时用 ffmpeg 归一化为 H.264 MP4。
 */

/** Chromium <video> 可直接播放的容器（按扩展名） */
const PLAYABLE_CONTAINERS = new Set(['mp4', 'm4v', 'mov', 'webm', 'ogv', 'ogg'])
/** Chromium 可解码的视频编码 */
const PLAYABLE_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora'])

export type ConvertAction = 'passthrough' | 'remux' | 'transcode'

/** 解析 `ffmpeg -i` 的 stderr：取视频编码与总时长(ms) */
export function parseProbe(stderr: string): { codec: string | null; durationMs: number } {
  const codecM = stderr.match(/Stream #\d+:\d+.*?: Video:\s*([a-z0-9_]+)/i)
  const codec = codecM ? codecM[1].toLowerCase() : null
  const durM = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const durationMs = durM ? (Number(durM[1]) * 3600 + Number(durM[2]) * 60 + Number(durM[3])) * 1000 : 0
  return { codec, durationMs }
}

/** 由扩展名 + 编码决定处理方式 */
export function decideConversion(ext: string, codec: string | null): ConvertAction {
  const e = ext.replace(/^\./, '').toLowerCase()
  const containerOk = PLAYABLE_CONTAINERS.has(e)
  const codecOk = codec != null && PLAYABLE_CODECS.has(codec)
  if (containerOk && codecOk) return 'passthrough'
  if (codec === 'h264') return 'remux' // 编码可播但容器不行 → 快速重封装（无损）
  return 'transcode' // 编码不可播（prores/hevc/mpeg4/vp9…）→ 转码 H.264
}

/** 生成 ffmpeg 转换参数（输出始终 .mp4） */
export function convertArgs(input: string, outPath: string, action: ConvertAction): string[] {
  const base = ['-y', '-hide_banner', '-i', input]
  const tail = ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath]
  if (action === 'remux') return [...base, '-c:v', 'copy', ...tail]
  return [...base, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', ...tail]
}

/**
 * 缓存超容时挑选要删除的文件（LRU）：按 mtime 新→旧保留，累计超过 capBytes 后的旧文件删除。
 * 永远保留最新的一个（哪怕它单个就超容，因为那是刚转换、正要用的）。
 */
export function planEviction(
  entries: { path: string; size: number; mtimeMs: number }[],
  capBytes: number
): string[] {
  const sorted = [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs)
  const del: string[] = []
  let total = 0
  for (let i = 0; i < sorted.length; i++) {
    total += sorted[i].size
    if (i > 0 && total > capBytes) del.push(sorted[i].path)
  }
  return del
}

/** 从 ffmpeg stderr 的 time= 推算进度 0..1（无总时长返回 null） */
export function parseProgress(text: string, durationMs: number): number | null {
  if (durationMs <= 0) return null
  const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return null
  const ms = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000
  return Math.max(0, Math.min(1, ms / durationMs))
}
