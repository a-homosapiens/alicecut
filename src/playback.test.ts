import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  state: {} as {
    currentTime: number
    playing: boolean
    clips: unknown[]
    setPlaying(value: boolean): void
    setCurrentTime(value: number): void
  },
  syncMediaPlayback: vi.fn(),
  pauseAllMedia: vi.fn()
}))

vi.mock('./store/project', () => ({
  useProject: { getState: () => mocked.state },
  getProjectDuration: () => 10
}))

vi.mock('./mediaPool', () => ({
  syncMediaPlayback: mocked.syncMediaPlayback,
  pauseAllMedia: mocked.pauseAllMedia
}))

import { play } from './playback'

describe('playback', () => {
  beforeEach(() => {
    mocked.syncMediaPlayback.mockClear()
    mocked.pauseAllMedia.mockClear()
    mocked.state = {
      currentTime: 1.25,
      playing: false,
      clips: [{ id: 7, kind: 'audio' }],
      setPlaying(value) {
        this.playing = value
      },
      setCurrentTime(value) {
        this.currentTime = value
      }
    }
  })

  it('starts media synchronously from the user playback action', () => {
    play()

    expect(mocked.state.playing).toBe(true)
    expect(mocked.syncMediaPlayback).toHaveBeenCalledOnce()
    expect(mocked.syncMediaPlayback).toHaveBeenCalledWith(mocked.state.clips, 1250, true, 10_000)
  })
})
