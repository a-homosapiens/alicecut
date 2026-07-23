import { describe, expect, it } from 'vitest'
import { ffmpegPathCandidates, resolveFfmpegExecutable } from './ffmpegPathCore'

describe('packaged ffmpeg path resolution', () => {
  it('prefers the spawnable app.asar.unpacked path on Windows', () => {
    const imported = String.raw`C:\Program Files\AliceCut\resources\app.asar\node_modules\ffmpeg-static\ffmpeg.exe`
    const unpacked = String.raw`C:\Program Files\AliceCut\resources\app.asar.unpacked\node_modules\ffmpeg-static\ffmpeg.exe`
    const candidates = ffmpegPathCandidates(
      imported,
      String.raw`C:\Program Files\AliceCut\resources`,
      'win32'
    )

    expect(candidates[0]).toBe(unpacked)
    expect(resolveFfmpegExecutable(imported, String.raw`C:\Program Files\AliceCut\resources`, 'win32',
      (path) => path === unpacked
    )).toBe(unpacked)
  })

  it('retains the dependency path used during development', () => {
    const imported = String.raw`D:\projects\alice-cut\node_modules\ffmpeg-static\ffmpeg.exe`

    expect(resolveFfmpegExecutable(imported, String.raw`D:\electron\resources`, 'win32',
      (path) => path === imported
    )).toBe(imported)
  })

  it('constructs the unpacked path when the imported value is missing', () => {
    const expected = '/opt/AliceCut/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'

    expect(resolveFfmpegExecutable(null, '/opt/AliceCut/resources', 'linux',
      (path) => path === expected
    )).toBe(expected)
  })

  it('returns null when no executable exists', () => {
    expect(resolveFfmpegExecutable(null, '/missing/resources', 'linux', () => false)).toBeNull()
  })
})
