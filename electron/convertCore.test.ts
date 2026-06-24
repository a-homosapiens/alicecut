import { describe, expect, it } from 'vitest'
import { parseProbe, decideConversion, convertArgs, parseProgress, planEviction } from './convertCore'

const STDERR = `
  Duration: 00:01:23.45, start: 0.000000, bitrate: 5000 kb/s
  Stream #0:0(und): Video: prores (apch / 0x68637061), yuv422p10le, 1920x1080
  Stream #0:1(und): Audio: pcm_s16le, 48000 Hz, stereo
`

describe('parseProbe', () => {
  it('取视频编码与时长', () => {
    const r = parseProbe(STDERR)
    expect(r.codec).toBe('prores')
    expect(r.durationMs).toBe((1 * 60 + 23.45) * 1000)
  })
  it('取 h264', () => {
    expect(parseProbe('Stream #0:0: Video: h264 (High), yuv420p').codec).toBe('h264')
  })
  it('无视频流 → null', () => {
    expect(parseProbe('Stream #0:0: Audio: aac').codec).toBeNull()
  })
})

describe('decideConversion', () => {
  it('可播容器+编码 → passthrough', () => {
    expect(decideConversion('.mp4', 'h264')).toBe('passthrough')
    expect(decideConversion('.webm', 'vp9')).toBe('passthrough')
    expect(decideConversion('.mov', 'h264')).toBe('passthrough')
  })
  it('容器不可播但 h264 → remux', () => {
    expect(decideConversion('.mkv', 'h264')).toBe('remux')
    expect(decideConversion('.avi', 'h264')).toBe('remux')
  })
  it('编码不可播 → transcode', () => {
    expect(decideConversion('.mov', 'prores')).toBe('transcode')
    expect(decideConversion('.mp4', 'hevc')).toBe('transcode')
    expect(decideConversion('.avi', 'mpeg4')).toBe('transcode')
    expect(decideConversion('.mkv', 'vp9')).toBe('transcode') // 容器+编码都需处理，简单转码
    expect(decideConversion('.x', null)).toBe('transcode')
  })
})

describe('convertArgs', () => {
  it('remux 复制视频流、转 aac、faststart', () => {
    const a = convertArgs('in.mkv', 'out.mp4', 'remux')
    expect(a).toContain('copy')
    expect(a).not.toContain('libx264')
    expect(a).toContain('+faststart')
    expect(a[a.length - 1]).toBe('out.mp4')
  })
  it('transcode 用 libx264 + yuv420p', () => {
    const a = convertArgs('in.mov', 'out.mp4', 'transcode')
    expect(a).toContain('libx264')
    expect(a).toContain('yuv420p')
  })
})

describe('planEviction（缓存 LRU 清理）', () => {
  const E = (path: string, size: number, mtimeMs: number): { path: string; size: number; mtimeMs: number } => ({
    path,
    size,
    mtimeMs
  })

  it('未超容 → 不删', () => {
    expect(planEviction([E('a', 100, 3), E('b', 100, 2)], 1000)).toEqual([])
  })

  it('超容 → 删最旧（保留最新）', () => {
    // 新→旧: c(3) b(2) a(1)，cap=250：c=100, +b=200, +a=300>250 → 删 a
    const del = planEviction([E('a', 100, 1), E('b', 100, 2), E('c', 100, 3)], 250)
    expect(del).toEqual(['a'])
  })

  it('单个最新文件超容也保留', () => {
    expect(planEviction([E('big', 5000, 9), E('old', 100, 1)], 1000)).toEqual(['old'])
    expect(planEviction([E('big', 5000, 9)], 1000)).toEqual([])
  })
})

describe('parseProgress', () => {
  it('由 time= 与总时长算比例', () => {
    expect(parseProgress('frame= 100 time=00:00:30.00 bitrate=', 60000)).toBeCloseTo(0.5, 5)
  })
  it('无总时长或无 time → null', () => {
    expect(parseProgress('time=00:00:30.00', 0)).toBeNull()
    expect(parseProgress('no time here', 60000)).toBeNull()
  })
})
