import { describe, expect, it } from 'vitest'
import { segmentClickTimeSec, visibleTimelineLayers } from './timeline'

describe('segmentClickTimeSec', () => {
  it('returns the exact timeline position clicked inside a segment', () => {
    expect(segmentClickTimeSec(10_000, 14_000, 320, 200, 60)).toBe(12)
  })

  it('clamps clicks to the segment boundaries', () => {
    expect(segmentClickTimeSec(10_000, 14_000, 150, 200, 60)).toBe(10)
    expect(segmentClickTimeSec(10_000, 14_000, 500, 200, 60)).toBe(14)
  })

  it('falls back to the segment start for an invalid zoom', () => {
    expect(segmentClickTimeSec(10_000, 14_000, 320, 200, 0)).toBe(10)
  })
})

describe('visibleTimelineLayers', () => {
  it('hides the extra empty layer while idle (lowest first)', () => {
    expect(visibleTimelineLayers([0, 1], false, 9)).toEqual([0, 1])
  })

  it('adds one drop layer below while dragging', () => {
    expect(visibleTimelineLayers([0, 1], true, 9)).toEqual([0, 1, 2])
  })

  it('does not add a layer beyond the layer limit', () => {
    expect(visibleTimelineLayers([9], true, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})
