import { describe, expect, it } from 'vitest'
import {
  outExtension,
  hwCandidates,
  softwareEncoderName,
  buildStaticOverlayGraph,
  buildVideoInputArgs,
  buildVideoArgs,
  type EncodeSettings,
  type ResolvedEncoder
} from './exporterCore'

const DIMS = { width: 1080, height: 1920, fps: 30 }

const settings = (patch: Partial<EncodeSettings> = {}): EncodeSettings => ({
  container: 'mp4',
  codec: 'h264',
  speed: 'balanced',
  hwAccel: 'software',
  ...patch
})

const sw = (codec: 'h264' | 'hevc'): ResolvedEncoder => ({
  name: softwareEncoderName(codec),
  isHardware: false
})

describe('buildStaticOverlayGraph', () => {
  it('loops one PNG and reserves input indexes 0/1 for overlay/background', () => {
    expect(buildStaticOverlayGraph('C:\\tmp\\background.png', 30)).toEqual({
      inputArgs: ['-loop', '1', '-framerate', '30', '-i', 'C:\\tmp\\background.png'],
      audioInputOffset: 2,
      filter: '[1:v]format=rgba[bg];[bg][0:v]overlay=0:0:shortest=1:format=auto[vout]',
      videoMap: '[vout]'
    })
  })
})

describe('buildVideoInputArgs', () => {
  it('describes complete RGBA frames for the fallback path', () => {
    expect(buildVideoInputArgs('rawvideo', DIMS)).toEqual([
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '1080x1920', '-r', '30', '-i', 'pipe:0'
    ])
  })

  it('describes an Annex B H.264 stream for WebCodecs muxing', () => {
    expect(buildVideoInputArgs('h264-annexb', DIMS)).toEqual([
      '-f', 'h264', '-framerate', '30', '-i', 'pipe:0'
    ])
  })
})

describe('buildVideoArgs（默认必须与今天的实际输出字节级一致）', () => {
  it('balanced + h264 + software 完全复现现有行为', () => {
    expect(buildVideoArgs(settings(), sw('h264'), DIMS)).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p'
    ])
  })

  it('fast / quality 档位对应更快/更高画质的 preset+crf', () => {
    expect(buildVideoArgs(settings({ speed: 'fast' }), sw('h264'), DIMS)).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p'
    ])
    expect(buildVideoArgs(settings({ speed: 'quality' }), sw('h264'), DIMS)).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '16',
      '-pix_fmt',
      'yuv420p'
    ])
  })

  it('hevc 软件编码走 libx265，CRF 按 x264+5 换算', () => {
    expect(buildVideoArgs(settings({ codec: 'hevc' }), sw('hevc'), DIMS)).toEqual([
      '-c:v',
      'libx265',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p'
    ])
  })
})

describe('buildVideoArgs（硬件编码器）', () => {
  it('nvenc 必须带 -b:v 0（否则默认码率上限仍会限制 -cq 画质）', () => {
    const args = buildVideoArgs(settings({ hwAccel: 'auto' }), { name: 'h264_nvenc', isHardware: true }, DIMS)
    expect(args).toEqual(['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-b:v', '0', '-pix_fmt', 'yuv420p'])
  })

  it('qsv 用 -global_quality（已在开发机上跑通真实编码）', () => {
    const args = buildVideoArgs(settings({ hwAccel: 'auto' }), { name: 'h264_qsv', isHardware: true }, DIMS)
    expect(args).toEqual(['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '23', '-pix_fmt', 'yuv420p'])
  })

  it('amf 的 -quality/-rc 必须传符号名，h264/hevc 两个 codec 下字符串完全相同', () => {
    const h264Args = buildVideoArgs(settings({ hwAccel: 'auto' }), { name: 'h264_amf', isHardware: true }, DIMS)
    const hevcArgs = buildVideoArgs(settings({ codec: 'hevc', hwAccel: 'auto' }), { name: 'hevc_amf', isHardware: true }, DIMS)
    expect(h264Args).toEqual(['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'qvbr', '-qvbr_quality_level', '24', '-pix_fmt', 'yuv420p'])
    expect(hevcArgs).toEqual(['-c:v', 'hevc_amf', '-quality', 'balanced', '-rc', 'qvbr', '-qvbr_quality_level', '24', '-pix_fmt', 'yuv420p'])
    // 两条命令里 -quality/-rc 的值字符串必须一致（不能悄悄变成数字），即使底层整数含义不同
    expect(h264Args.slice(h264Args.indexOf('-quality'), h264Args.indexOf('-quality') + 2)).toEqual(
      hevcArgs.slice(hevcArgs.indexOf('-quality'), hevcArgs.indexOf('-quality') + 2)
    )
  })

  it('videotoolbox 用分辨率×帧率×bpp 估算码率，hevc 档位低于 h264（效率更高)', () => {
    const h264Args = buildVideoArgs(settings({ hwAccel: 'auto' }), { name: 'h264_videotoolbox', isHardware: true }, DIMS)
    const hevcArgs = buildVideoArgs(settings({ codec: 'hevc', hwAccel: 'auto' }), { name: 'hevc_videotoolbox', isHardware: true }, DIMS)
    expect(h264Args[0]).toBe('-c:v')
    expect(h264Args[2]).toBe('-b:v')
    const h264Bitrate = Number(h264Args[3])
    const hevcBitrate = Number(hevcArgs[3])
    expect(h264Bitrate).toBe(Math.round(1080 * 1920 * 30 * 0.1))
    expect(hevcBitrate).toBeLessThan(h264Bitrate)
  })

  it('未知硬件编码器名抛错，而不是悄悄拼出错误参数', () => {
    expect(() => buildVideoArgs(settings({ hwAccel: 'auto' }), { name: 'h264_mystery', isHardware: true }, DIMS)).toThrow()
  })
})

describe('buildVideoArgs（ProRes）', () => {
  it('三档映射到 lt/standard/hq，pix_fmt 是 yuv422p10le 不是 yuv420p', () => {
    const fast = buildVideoArgs(settings({ codec: 'prores', speed: 'fast' }), { name: 'prores_ks', isHardware: false }, DIMS)
    const balanced = buildVideoArgs(settings({ codec: 'prores' }), { name: 'prores_ks', isHardware: false }, DIMS)
    const quality = buildVideoArgs(settings({ codec: 'prores', speed: 'quality' }), { name: 'prores_ks', isHardware: false }, DIMS)
    expect(fast).toEqual(['-c:v', 'prores_ks', '-profile:v', '1', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'])
    expect(balanced).toEqual(['-c:v', 'prores_ks', '-profile:v', '2', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'])
    expect(quality).toEqual(['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'])
  })
})

describe('outExtension', () => {
  it('非 ProRes 沿用用户选择的容器', () => {
    expect(outExtension(settings({ container: 'mp4' }))).toBe('mp4')
    expect(outExtension(settings({ container: 'mov' }))).toBe('mov')
    expect(outExtension(settings({ codec: 'hevc', container: 'mp4' }))).toBe('mp4')
  })

  it('ProRes 无论选了什么容器都强制 .mov', () => {
    expect(outExtension(settings({ codec: 'prores', container: 'mp4' }))).toBe('mov')
    expect(outExtension(settings({ codec: 'prores', container: 'mov' }))).toBe('mov')
  })
})

describe('hwCandidates', () => {
  it('macOS 只有 videotoolbox 一条候选', () => {
    expect(hwCandidates('darwin', 'h264')).toEqual(['h264_videotoolbox'])
    expect(hwCandidates('darwin', 'hevc')).toEqual(['hevc_videotoolbox'])
  })

  it('Windows 是 nvenc → qsv → amf，不含 _mf', () => {
    const list = hwCandidates('win32', 'h264')
    expect(list).toEqual(['h264_nvenc', 'h264_qsv', 'h264_amf'])
    expect(list.some((n) => n.includes('_mf'))).toBe(false)
  })

  it('其它平台（Linux 等）本轮没有硬件候选', () => {
    expect(hwCandidates('linux', 'h264')).toEqual([])
  })
})
