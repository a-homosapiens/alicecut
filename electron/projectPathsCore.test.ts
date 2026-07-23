import { describe, expect, it } from 'vitest'
import { addRelativeProjectPaths, resolveRelativeProjectPaths } from './projectPathsCore'

describe('portable project paths', () => {
  const project = String.raw`C:\work\Alice Project\edit.alicecut.json`
  const data = {
    version: 5,
    style: { bgImage: String.raw`C:\work\Alice Project\media\background.png` },
    images: [{ id: 1, path: String.raw`C:\work\Alice Project\media\background.png` }],
    clips: [{
      kind: 'video',
      path: String.raw`C:\work\Alice Project\media\video.mp4`,
      sourcePath: String.raw`C:\work\Alice Project\sources\video.mov`
    }]
  }

  it('writes v6 relative metadata while retaining absolute fallbacks', () => {
    const saved = addRelativeProjectPaths(data, project, 'win32') as typeof data & {
      style: { bgImage: string; bgImageRelativePath: string }
      images: Array<{ path: string; relativePath: string }>
      clips: Array<{ path: string; relativePath: string; sourcePath: string; relativeSourcePath: string }>
    }

    expect(saved.version).toBe(6)
    expect(saved.style.bgImage).toBe(data.style.bgImage)
    expect(saved.style.bgImageRelativePath).toBe('media/background.png')
    expect(saved.images[0].relativePath).toBe('media/background.png')
    expect(saved.clips[0].relativePath).toBe('media/video.mp4')
    expect(saved.clips[0].relativeSourcePath).toBe('sources/video.mov')
  })

  it('prefers files beside a moved project and falls back to old absolute paths', () => {
    const saved = addRelativeProjectPaths(data, project, 'win32')
    const movedProject = String.raw`E:\copied\edit.alicecut.json`
    const existing = new Set([
      String.raw`E:\copied\media\background.png`,
      String.raw`E:\copied\sources\video.mov`,
      data.clips[0].path
    ])
    const loaded = resolveRelativeProjectPaths(saved, movedProject, (path) => existing.has(path), 'win32') as typeof data

    expect(loaded.style.bgImage).toBe(String.raw`E:\copied\media\background.png`)
    expect(loaded.images[0].path).toBe(String.raw`E:\copied\media\background.png`)
    expect(loaded.clips[0].path).toBe(data.clips[0].path)
    expect(loaded.clips[0].sourcePath).toBe(String.raw`E:\copied\sources\video.mov`)
  })

  it('accepts a relative path directly in the legacy path field', () => {
    const loaded = resolveRelativeProjectPaths(
      { style: {}, images: [], clips: [{ path: 'media/audio.wav' }] },
      String.raw`D:\portable\project.alicecut.json`,
      () => false,
      'win32'
    ) as { clips: Array<{ path: string }> }

    expect(loaded.clips[0].path).toBe(String.raw`D:\portable\media\audio.wav`)
  })

  it('does not write a fake relative path across Windows drives', () => {
    const saved = addRelativeProjectPaths(
      { style: {}, images: [{ path: String.raw`D:\media\image.png` }], clips: [] },
      project,
      'win32'
    ) as { images: Array<{ relativePath?: string }> }

    expect(saved.images[0].relativePath).toBeUndefined()
  })
})
