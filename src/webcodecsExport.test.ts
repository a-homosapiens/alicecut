import { describe, expect, it } from 'vitest'
import { buildWebCodecsConfig, shouldTryWebCodecsExport } from './webcodecsExport'
import type { EncodeSettings } from '../electron/exporterCore'

const dims = { width: 1080, height: 1920, fps: 30 }
const encode = (patch: Partial<EncodeSettings> = {}): EncodeSettings => ({
  container: 'mp4',
  codec: 'h264',
  speed: 'balanced',
  hwAccel: 'auto',
  ...patch
})

describe('buildWebCodecsConfig', () => {
  it('produces hardware-preferred Annex B H.264 at a quality-tier bitrate', () => {
    expect(buildWebCodecsConfig(encode(), dims)).toMatchObject({
      codec: 'avc1.640028',
      width: 1080,
      height: 1920,
      bitrate: Math.round(1080 * 1920 * 30 * 0.18),
      hardwareAcceleration: 'prefer-hardware',
      avc: { format: 'annexb' }
    })
  })

  it('uses level 4.2 for 1080p60', () => {
    expect(buildWebCodecsConfig(encode(), { ...dims, fps: 60 })?.codec).toBe('avc1.64002a')
  })

  it('leaves software, HEVC, and ProRes on the ffmpeg fallback', () => {
    expect(buildWebCodecsConfig(encode({ hwAccel: 'software' }), dims)).toBeNull()
    expect(buildWebCodecsConfig(encode({ codec: 'hevc' }), dims)).toBeNull()
    expect(buildWebCodecsConfig(encode({ codec: 'prores' }), dims)).toBeNull()
  })
})

describe('shouldTryWebCodecsExport', () => {
  it('only selects fast H.264 hardware exports', () => {
    expect(shouldTryWebCodecsExport(encode(), 'fast')).toBe(true)
    expect(shouldTryWebCodecsExport(encode(), 'exact')).toBe(false)
    expect(shouldTryWebCodecsExport(encode({ hwAccel: 'software' }), 'fast')).toBe(false)
    expect(shouldTryWebCodecsExport(encode({ codec: 'hevc' }), 'fast')).toBe(false)
    expect(shouldTryWebCodecsExport(encode({ codec: 'prores' }), 'fast')).toBe(false)
  })
})
