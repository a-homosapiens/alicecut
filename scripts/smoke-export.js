/**
 * 导出管线冒烟测试：用与 electron/exporter.ts 相同的 ffmpeg 参数
 * 喂 60 帧纯色渐变 RGBA，验证能产出可用的 mp4。
 * 运行：node scripts/smoke-export.js
 */
const { spawn } = require('child_process')
const { once } = require('events')
const ffmpegPath = require('ffmpeg-static')

const W = 1080
const H = 1920
const FPS = 30
const FRAMES = 60
const OUT = require('path').join(require('os').tmpdir(), 'alicecut-smoke.mp4')

async function main() {
  const args = [
    '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', OUT
  ]
  const proc = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
  let log = ''
  proc.stderr.on('data', (d) => (log = (log + d).slice(-2000)))

  const frame = Buffer.alloc(W * H * 4)
  for (let n = 0; n < FRAMES; n++) {
    const r = Math.round((n / FRAMES) * 255)
    for (let i = 0; i < frame.length; i += 4) {
      frame[i] = r
      frame[i + 1] = 40
      frame[i + 2] = 120
      frame[i + 3] = 255
    }
    if (!proc.stdin.write(frame)) await once(proc.stdin, 'drain')
  }
  proc.stdin.end()
  const [code] = await once(proc, 'close')
  if (code !== 0) {
    console.error('FFmpeg failed:', code, '\n', log)
    process.exit(1)
  }
  const size = require('fs').statSync(OUT).size
  console.log(`OK: ${OUT} (${size} bytes)`)
}

main()
