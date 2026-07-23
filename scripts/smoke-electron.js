const { access, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { spawn } = require('node:child_process')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')

function runProcess(executable, args, options, timeoutMs = 30000) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, options)
    let output = ''
    child.stdout?.on('data', (chunk) => { output += chunk })
    child.stderr?.on('data', (chunk) => { output += chunk })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectRun(new Error(`Process timed out.\n${output}`))
    }, timeoutMs)
    child.on('error', rejectRun)
    child.on('close', (code) => {
      clearTimeout(timer)
      code === 0 ? resolveRun(output) : rejectRun(new Error(`Process exited with ${code}.\n${output}`))
    })
  })
}

async function run() {
  const root = resolve(__dirname, '..')
  const executableIndex = process.argv.indexOf('--executable')
  const packagedExecutable = executableIndex >= 0 ? process.argv[executableIndex + 1] : null
  const scratch = await mkdtemp(join(tmpdir(), 'alicecut-smoke-'))
  try {
    const lrcPath = join(scratch, 'smoke.lrc')
    const sourceVideoPath = join(scratch, 'unsupported-import.avi')
    const jobPath = join(scratch, 'job.json')
    const outputPath = join(scratch, 'smoke.alicecut.json')
    await writeFile(lrcPath, '[00:00.00]Smoke test caption\n', 'utf8')
    const ffmpeg = packagedExecutable
      ? join(dirname(packagedExecutable), 'resources', 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
      : require('ffmpeg-static')
    await runProcess(ffmpeg, [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', 'testsrc=size=64x64:rate=10',
      '-t', '0.5',
      '-c:v', 'mpeg4',
      sourceVideoPath
    ], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    await writeFile(jobPath, JSON.stringify({ lrc: lrcPath, video: sourceVideoPath }), 'utf8')

    const electron = packagedExecutable || require('electron')
    const profile = join(scratch, 'electron-profile')
    await runProcess(electron, [
        ...(packagedExecutable ? [] : [root]),
        '--disable-gpu',
        `--user-data-dir=${profile}`,
        '--save-project',
        jobPath
      ], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }, 60000)

    const project = JSON.parse(await readFile(outputPath, 'utf8'))
    if (
      project.version !== 6 ||
      !Array.isArray(project.lines) ||
      project.lines.length !== 1 ||
      !Array.isArray(project.clips) ||
      project.clips.length !== 1 ||
      project.clips[0].sourcePath !== sourceVideoPath ||
      project.clips[0].relativeSourcePath !== 'unsupported-import.avi' ||
      project.clips[0].path === sourceVideoPath ||
      !project.clips[0].path.toLowerCase().endsWith('.mp4')
    ) {
      throw new Error(`Electron smoke test produced an invalid project file: ${JSON.stringify(project)}`)
    }
    await access(project.clips[0].path)
    process.stdout.write('Electron smoke test passed.\n')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
