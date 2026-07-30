import { describe, expect, it } from 'vitest'
import type { CaptionTrack, LrcLine } from './core/types'
import {
  buildCaptionExport,
  captionLinesForTrack,
  nonEmptyCaptionTracks,
  preferredCaptionTrackId
} from './captionExport'

const line = (id: number, start: number, end: number, text: string, trackId = 0, kind?: 'text'): LrcLine => ({
  id,
  start,
  end,
  text,
  words: [],
  effectId: null,
  dx: 0,
  dy: 0,
  ...(trackId ? { trackId } : {}),
  ...(kind ? { kind } : {})
})

const track = (id: number, name: string, lrcName: string | null = null, visible = true): CaptionTrack => ({
  id,
  name,
  lrcName,
  meta: { offset: 0 },
  offsetY: 0,
  visible
})

describe('caption track export', () => {
  it('offers only tracks containing nonempty captions', () => {
    const tracks = [track(0, ''), track(1, 'Translation'), track(2, 'Empty')]
    const lines = [line(1, 0, 1000, 'Primary'), line(2, 0, 1000, 'Translated', 1), line(3, 0, 1000, '', 2)]
    expect(nonEmptyCaptionTracks(lines, tracks).map((item) => item.id)).toEqual([0, 1])
  })

  it('prefers the track containing the currently selected caption', () => {
    const tracks = [track(0, ''), track(1, 'Translation')]
    const lines = [line(1, 0, 1000, 'Primary'), line(2, 0, 1000, 'Translated', 1)]
    expect(preferredCaptionTrackId(lines, tracks, [2])).toBe(1)
    expect(preferredCaptionTrackId(lines, tracks, [1, 2])).toBe(0)
  })

  it('exports only the chosen track from its current edited state', () => {
    const chosen = track(1, 'English revised', 'original-en.vtt', false)
    const lines = [
      line(1, 0, 900, 'Primary'),
      line(2, 1250, 2875, 'Edited text', 1),
      line(3, 3000, 4200, 'Watermark', 0, 'text')
    ]
    const result = buildCaptionExport(lines, chosen, 'subtitles')
    expect(captionLinesForTrack(lines, 1).map((item) => item.id)).toEqual([2])
    expect(result).toEqual({
      srt: '1\n00:00:01,250 --> 00:00:02,875\nEdited text\n',
      defaultName: 'English revised.srt',
      cueCount: 1
    })
  })

  it('uses the chosen track source name and sanitizes unsafe filename characters', () => {
    const result = buildCaptionExport([line(1, 0, 1000, 'Caption', 1)], track(1, '', 'French:final.vtt'), 'subtitles')
    expect(result?.defaultName).toBe('French_final.srt')
  })

  it('preserves user-inserted line breaks inside an exported cue', () => {
    const result = buildCaptionExport(
      [line(1, 1000, 2500, 'First line\nSecond line')],
      track(0, ''),
      'subtitles'
    )
    expect(result?.srt).toContain('\nFirst line\nSecond line\n')
  })
})
