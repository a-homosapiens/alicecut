import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { LrcLine, LrcWord } from './types'
import { parseSrt, parseVtt, parseCaptions, paginateWords, repaginateLines, serializeSrt } from './subtitles'

const word = (text: string, start: number, end: number): LrcWord => ({ text, start, end, chars: [] })
const line = (id: number, start: number, end: number, text: string, words: LrcWord[] = []): LrcLine => ({
  id,
  start,
  end,
  text,
  words,
  effectId: null,
  dx: 0,
  dy: 0
})

const SRT = `1
00:00:01,000 --> 00:00:03,000
第一句字幕

2
00:00:03,000 --> 00:00:05,500
<i>第二句</i>带标签

3
00:00:06,000 --> 00:00:08,000
最后一句`

const VTT = `WEBVTT

NOTE 这是一段注释，应被跳过

00:00:02.000 --> 00:00:04.000 align:start position:10%
你好世界

00:05.000 --> 00:07.000
逐词<00:05.500>高亮<00:06.200>测试`

describe('parseSrt', () => {
  it('解析全部 cue', () => {
    const r = parseSrt(SRT)
    expect(r.lines).toHaveLength(3)
    expect(r.lines[0].text).toBe('第一句字幕')
    expect(r.lines[2].text).toBe('最后一句')
  })

  it('使用显式起止时间', () => {
    const r = parseSrt(SRT)
    expect(r.lines[0].start).toBe(1000)
    expect(r.lines[0].end).toBe(3000)
  })

  it('显式结束时间优先于下一行起点（保留空白间隔）', () => {
    const r = parseSrt(SRT)
    // cue2 自身在 5500 结束，cue3 在 6000 才开始，中间 500ms 空白
    expect(r.lines[1].end).toBe(5500)
    expect(r.lines[2].start).toBe(6000)
  })

  it('去除富文本标签', () => {
    const r = parseSrt(SRT)
    expect(r.lines[1].text).toBe('第二句带标签')
    expect(r.lines[1].text).not.toContain('<')
  })

  it('合并多行 cue 文本', () => {
    const r = parseSrt('1\n00:00:01,000 --> 00:00:02,000\n你好\n世界')
    expect(r.lines[0].text).toBe('你好世界')
  })
})

describe('parseVtt', () => {
  it('跳过 WEBVTT 头与 NOTE 块', () => {
    const r = parseVtt(VTT)
    expect(r.lines).toHaveLength(2)
    expect(r.lines[0].text).toBe('你好世界')
  })

  it('点号毫秒 + 可省时位 + 忽略 cue 设置', () => {
    const r = parseVtt(VTT)
    expect(r.lines[0].start).toBe(2000)
    expect(r.lines[0].end).toBe(4000)
    expect(r.lines[1].start).toBe(5000)
    expect(r.lines[1].end).toBe(7000)
  })

  it('行内逐词时间标签生成精确逐词高亮', () => {
    const r = parseVtt(VTT)
    const words = r.lines[1].words
    expect(words.map((w) => w.text)).toEqual(['逐词', '高亮', '测试'])
    expect(words.map((w) => w.start)).toEqual([5000, 5500, 6200])
  })
})

describe('parseCaptions 按扩展名分发', () => {
  it('.srt → SRT 解析', () => {
    expect(parseCaptions(SRT, 'song.srt').lines).toHaveLength(3)
  })
  it('.vtt → VTT 解析', () => {
    expect(parseCaptions(VTT, 'song.vtt').lines).toHaveLength(2)
  })
  it('.lrc → LRC 解析', () => {
    const r = parseCaptions('[00:01.00]测试', 'song.lrc')
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].start).toBe(1000)
  })
})

describe('paginateWords / repaginateLines（自动分页）', () => {
  const lines = [
    line(0, 0, 1000, 'ab', [word('a', 0, 400), word('b', 400, 800)]),
    line(1, 2000, 3000, 'cd', [word('c', 2000, 2400), word('d', 2400, 2800)])
  ]

  it('大阈值合并为整句（每页多词）', () => {
    const pages = paginateWords(lines.flatMap((l) => l.words), 1000)
    expect(pages.map((p) => p.map((w) => w.text).join(''))).toEqual(['ab', 'cd'])
  })

  it('小阈值趋向逐词', () => {
    const out = repaginateLines(lines, 100)
    expect(out.map((l) => l.text)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('页结束时间取下一页起点（无缝切页），末页取末词结束', () => {
    const out = repaginateLines(lines, 1000)
    expect(out).toHaveLength(2)
    expect(out[0].start).toBe(0)
    expect(out[0].end).toBe(2000) // 下一页起点
    expect(out[1].end).toBe(2800) // 末词结束
  })

  it('重新分配 id 并重置行级特效/位置', () => {
    const out = repaginateLines(lines, 100)
    expect(out.map((l) => l.id)).toEqual([0, 1, 2, 3])
    expect(out.every((l) => l.effectId === null && l.dx === 0 && l.dy === 0)).toBe(true)
  })
})

describe('serializeSrt（SRT 导出）', () => {
  const lines = [
    line(0, 1000, 3000, '第一句'),
    line(1, 3000, 5500, '第二句'),
    line(2, 6000, 8000, '') // 空文本（间奏）应跳过
  ]

  it('生成标准 SRT、跳过空行、序号从 1 起', () => {
    const srt = serializeSrt(lines)
    expect(srt).toContain('1\n00:00:01,000 --> 00:00:03,000\n第一句')
    expect(srt).toContain('2\n00:00:03,000 --> 00:00:05,500\n第二句')
    expect(srt).not.toContain('3\n') // 空行被跳过
  })

  it('与 parseSrt 往返一致（时间与文本）', () => {
    const round = parseSrt(serializeSrt(lines))
    expect(round.lines).toHaveLength(2)
    expect(round.lines.map((l) => [l.start, l.end])).toEqual([
      [1000, 3000],
      [3000, 5500]
    ])
    expect(round.lines.map((l) => l.text)).toEqual(['第一句', '第二句'])
  })
})

describe('真实样例文件（存在时校验）', () => {
  const dir = join(process.cwd(), 'samples')
  for (const [file, parse] of [
    ['死水 (Vocals).srt', parseSrt],
    ['死水 (Vocals).vtt', parseVtt]
  ] as const) {
    const path = join(dir, file)
    it.skipIf(!existsSync(path))(`解析 ${file}`, () => {
      const r = parse(readFileSync(path, 'utf8'))
      expect(r.lines.length).toBeGreaterThan(0)
      expect(r.lines[0].start).toBe(23920)
      expect(r.lines[0].end).toBe(28700)
      // 行按时间单调，且每行 end > start
      for (let i = 0; i < r.lines.length; i++) {
        expect(r.lines[i].end).toBeGreaterThan(r.lines[i].start)
        if (i > 0) expect(r.lines[i].start).toBeGreaterThanOrEqual(r.lines[i - 1].start)
      }
    })
  }
})
