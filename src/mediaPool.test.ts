import { afterEach, describe, expect, it, vi } from 'vitest'
import { mediaUrl, shouldSeekMediaFrame, syncMediaPlayback } from './mediaPool'
import type { MediaClip } from './core/media'

afterEach(() => {
  vi.unstubAllGlobals()
})

class FakeVideo {
  style: Record<string, string> = {}
  readyState = 2
  seeking = false
  paused = true
  playbackRate = 1
  defaultMuted = true
  muted = true
  volume = 1
  preload = ''
  loop = false
  crossOrigin: string | null = null
  playsInline = false
  src = ''
  seekAssignments = 0
  playCalls = 0
  private time = 0

  get currentTime(): number { return this.time }
  set currentTime(value: number) {
    this.seekAssignments++
    this.time = value
  }

  pause(): void { this.paused = true }
  play(): Promise<void> {
    this.playCalls++
    this.paused = false
    return Promise.resolve()
  }
  removeAttribute(): void {}
  load(): void {}
  remove(): void {}
}

function stubVideoElements(): FakeVideo[] {
  const videos: FakeVideo[] = []
  vi.stubGlobal('HTMLVideoElement', FakeVideo)
  vi.stubGlobal('document', {
    createElement: () => {
      const video = new FakeVideo()
      videos.push(video)
      return video
    },
    body: { appendChild: () => undefined }
  })
  return videos
}

describe('mediaUrl', () => {
  it('creates a standard hosted URL for Windows paths and Unicode filenames', () => {
    expect(mediaUrl('D:\\media\\拟古 (Add Vocal).mp3')).toBe(
      'media://local/D%3A/media/%E6%8B%9F%E5%8F%A4%20(Add%20Vocal).mp3'
    )
  })
})

describe('shouldSeekMediaFrame', () => {
  it('preserves the already decoded pre-roll frame at a video junction', () => {
    expect(shouldSeekMediaFrame(1, 1, 2, false, 0.05)).toBe(false)
    expect(shouldSeekMediaFrame(1.02, 1, 2, false, 0.05)).toBe(false)
  })

  it('seeks only when metadata is ready, no seek is active, and drift is material', () => {
    expect(shouldSeekMediaFrame(1.2, 1, 2, false, 0.05)).toBe(true)
    expect(shouldSeekMediaFrame(1.2, 1, 0, false, 0.05)).toBe(false)
    expect(shouldSeekMediaFrame(1.2, 1, 2, true, 0.05)).toBe(false)
  })
})

describe('video junction playback', () => {
  it('does not seek the incoming clip again when its pre-roll frame is already decoded', () => {
    const videos = stubVideoElements()

    const base: MediaClip = {
      id: 101,
      kind: 'video',
      path: 'a.mp4',
      name: 'a',
      start: 0,
      sourceDuration: 1000,
      sourceIn: 0,
      sourceOut: 1000,
      speed: 1,
      reverse: false,
      loop: 1,
      layer: 0,
      tx: 0,
      ty: 0,
      scale: 1,
      rotate: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      volume: 1,
      transIn: null,
      transOut: null
    }
    const incoming: MediaClip = {
      ...base,
      id: 102,
      path: 'b.mp4',
      name: 'b',
      start: 1000,
      sourceDuration: 2000,
      sourceIn: 1000,
      sourceOut: 2000,
      transIn: { type: 'fade', durationMs: 500 }
    }
    const clips = [base, incoming]

    syncMediaPlayback(clips, 500, true, 2000)
    expect(videos[1].currentTime).toBe(1)
    expect(videos[1].seekAssignments).toBe(1)

    syncMediaPlayback(clips, 1000, true, 2000)
    expect(videos[1].seekAssignments).toBe(1)

    syncMediaPlayback([], 0, false, 2000)
  })

  it('keeps a frozen clip paused on the same exact source frame while the project clock advances', () => {
    const videos = stubVideoElements()
    const frozen: MediaClip = {
      id: 201,
      kind: 'video',
      path: 'freeze.mp4',
      name: 'freeze',
      start: 1000,
      sourceDuration: 5000,
      sourceIn: 1234,
      sourceOut: 1235,
      speed: 1,
      reverse: false,
      freezeFrameMs: 1234.5,
      freezeDurationMs: 3000,
      loop: 1,
      layer: 0,
      tx: 0,
      ty: 0,
      scale: 1,
      rotate: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      volume: 1,
      transIn: null,
      transOut: null
    }

    syncMediaPlayback([frozen], 1000, true, 4000)
    expect(videos[0].currentTime).toBe(1.2345)
    expect(videos[0].seekAssignments).toBe(1)
    expect(videos[0].playCalls).toBe(0)
    expect(videos[0].paused).toBe(true)

    syncMediaPlayback([frozen], 2500, true, 4000)
    expect(videos[0].currentTime).toBe(1.2345)
    expect(videos[0].seekAssignments).toBe(1)
    expect(videos[0].playCalls).toBe(0)

    syncMediaPlayback([], 0, false, 4000)
  })
})
