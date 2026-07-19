/** Reproducible end-to-end export benchmark for the raw and WebCodecs paths. */
const { spawnSync } = require('child_process')
const { mkdtempSync, rmSync, writeFileSync, statSync } = require('fs')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const electronPath = require('electron')
const ffmpegPath = require('ffmpeg-static')

const ROOT = resolve(__dirname, '..')
const LRC = join(ROOT, 'samples', 'smoke.lrc')
const VIDEO = join(ROOT, 'samples', '13860910_1366_720_30fps.mp4')

function run(root, name, { gpu, video }) {
  const out = join(root, `${name}.mp4`)
  const jobPath = join(root, `${name}.json`)
  const job = {
    lrc: LRC,
    out,
    fps: 30,
    duration: 8,
    speed: 'balanced',
    hwAccel: gpu ? 'auto' : 'software',
    gpu,
    style: {
      aspect: '9:16',
      effectId: 'pop',
      bgType: 'gradient',
      bgFrom: '#102040',
      bgTo: '#406020',
      showMeta: true
    }
  }
  if (video) job.video = { path: VIDEO, out: 8 }
  writeFileSync(jobPath, JSON.stringify(job, null, 2))

  const started = process.hrtime.bigint()
  const result = spawnSync(electronPath, ['.', '--export', jobPath], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  })
  const seconds = Number(process.hrtime.bigint() - started) / 1e9
  if (result.status !== 0) throw new Error(`${name} failed:\n${result.stdout}\n${result.stderr}`)

  const probe = spawnSync(ffmpegPath, ['-v', 'error', '-i', out, '-f', 'null', '-'], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (probe.status !== 0) throw new Error(`${name} is not decodable:\n${probe.stderr}`)
  const mode = `${result.stdout}\n${result.stderr}`.match(/导出路径: ([^\r\n]+)/)?.[1] ?? 'unknown'
  return { name, seconds, bytes: statSync(out).size, mode }
}

function pct(before, after) {
  return ((1 - after / before) * 100).toFixed(1)
}

function main() {
  const root = mkdtempSync(join(tmpdir(), 'alicecut-benchmark-'))
  try {
    const results = [
      run(root, 'static-raw', { gpu: false, video: false }),
      run(root, 'static-gpu', { gpu: true, video: false }),
      run(root, 'video-raw', { gpu: false, video: true }),
      run(root, 'video-gpu', { gpu: true, video: true })
    ]
    console.table(results.map((r) => ({ ...r, seconds: r.seconds.toFixed(3) })))
    console.log(`Static speedup: ${pct(results[0].seconds, results[1].seconds)}%`)
    console.log(`Video speedup:  ${pct(results[2].seconds, results[3].seconds)}%`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

main()
