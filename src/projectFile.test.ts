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

  it('preserves a boolean reverse flag and rejects invalid values', () => {
    const base = {
      version: 6,
      meta: { offset: 0 },
      style: {},
      lines: [],
      clips: [{ kind: 'video', path: 'v.mp4', name: 'v', start: 0, sourceDuration: 1000, reverse: true }]
    }
    expect(parseProjectData(base).clips[0].reverse).toBe(true)
    expect(() => parseProjectData({
      ...base,
      clips: [{ ...base.clips[0], reverse: 'yes' }]
    })).toThrow(/reverse must be a boolean/)
  })

  it('round-trips frozen-frame timing and rejects malformed timing values', () => {
    const base = {
      version: 6,
      meta: { offset: 0 },
      style: {},
      lines: [],
      clips: [{
        kind: 'video', path: 'v.mp4', name: 'freeze', start: 1000, sourceDuration: 5000,
        freezeFrameMs: 1234.5, freezeDurationMs: 3000
      }]
    }
    expect(parseProjectData(base).clips[0]).toMatchObject({
      freezeFrameMs: 1234.5,
      freezeDurationMs: 3000
    })
    expect(() => parseProjectData({
      ...base,
      clips: [{ ...base.clips[0], freezeDurationMs: 'three seconds' }]
    })).toThrow(/freezeDurationMs must be a finite number/)
    expect(() => parseProjectData({
      ...base,
      clips: [{ ...base.clips[0], freezeDurationMs: undefined }]
    })).toThrow(/requires both freezeFrameMs and freezeDurationMs/)
    expect(() => parseProjectData({
      ...base,
      clips: [{ ...base.clips[0], freezeDurationMs: -1 }]
    })).toThrow(/invalid frozen-frame timing/)
  })

  it('preserves multiline caption text and its explicit layout break', () => {
    const parsed = parseProjectData({
      version: 6,
      meta: { offset: 0 },
      style: {},
      lines: [{
        id: 0,
        start: 0,
        end: 2000,
        text: 'First line\nSecond line',
        words: [
          { text: 'First line', start: 0, end: 900, chars: [] },
          { text: 'Second line', leading: '\n', start: 900, end: 1800, chars: [] }
        ],
        effectId: null,
        dx: 0,
        dy: 0
      }],
      clips: []
    })
    expect(parsed.lines[0].text).toBe('First line\nSecond line')
    expect(parsed.lines[0].words[1].leading).toBe('\n')
  })

  it('rejects an invalid per-line effect duration priority', () => {
    expect(() => parseProjectData({
      version: 6,
      meta: { offset: 0 },
      style: {},
      lines: [{
        id: 0,
        start: 0,
        end: 1000,
        text: 'Caption',
        words: [],
        effectDurationPriority: 'middle'
      }],
      clips: []
    })).toThrow(/effect duration priority/)
  })
})
