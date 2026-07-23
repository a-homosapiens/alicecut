import { describe, expect, it } from 'vitest'
import { parseProjectData, serializeProject } from './projectFile'

describe('serializeProject', () => {
  it('writes the v6 structure and removes runtime clip ids', () => {
    const state = {
      meta: { offset: 0 },
      lines: [{ id: 1, text: 'hi' }],
      style: { effectId: 'pop' },
      lrcName: 'a.lrc',
      tracks: [{ id: 1, name: 'English', lrcName: 'a.en.lrc', meta: { offset: 0 }, offsetY: 200, visible: true }],
      images: [{ id: 1, path: 'D:\\bg.jpg', name: 'bg.jpg' }],
      clips: [{ id: 9, kind: 'audio', path: 'x', name: 'x', start: 0 }]
    }
    // The fixture only needs fields consumed by serialization.
    const output = serializeProject(state as Parameters<typeof serializeProject>[0]) as Record<string, unknown> & {
      clips: Array<{ id?: number; path: string }>
    }
    expect(output.version).toBe(6)
    expect(output.lrcName).toBe('a.lrc')
    expect(output.lines).toBe(state.lines)
    expect(output.tracks).toBe(state.tracks)
    expect(output.images).toBe(state.images)
    expect(output.clips[0].id).toBeUndefined()
    expect(output.clips[0].path).toBe('x')
  })
})

describe('parseProjectData', () => {
  it('rejects unsupported versions and malformed nested caption data before hydration', () => {
    expect(() => parseProjectData({ version: 99, lines: [], style: {} })).toThrow(/Unsupported project version/)
    expect(() => parseProjectData({
      version: 5,
      meta: { offset: 0 },
      style: {},
      lines: [{ id: 0, start: 0, end: 1000, text: 'x', words: [{ text: 'x', start: 0, end: 1, chars: 'bad' }] }]
    })).toThrow(/Invalid word/)
  })
})
