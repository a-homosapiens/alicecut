import { describe, expect, it } from 'vitest'
import { parseLrc } from './lrc'
import { lyricsDuration, rebuildLineText, shiftLine, retimeLine } from './timing'
import { layoutLine } from './layout'

const STANDARD = `[ti:测试歌曲]
[ar:测试歌手]
[00:01.00]第一句歌词
[00:05.50]第二句 with English
[00:10.00]
[00:12.00]最后一句`

const MULTI_TAG = `[00:01.00][00:30.00]副歌重复句
[00:10.00]中间句`

const ENHANCED = `[00:01.00]<00:01.00>你<00:01.40>好<00:02.00>世界
[00:05.00]<00:05.00>下一行`

const OFFSET = `[offset:500]
[00:01.00]提前半秒`

describe('parseLrc 标准格式', () => {
  it('解析元数据', () => {
    const r = parseLrc(STANDARD)
    expect(r.meta.title).toBe('测试歌曲')
    expect(r.meta.artist).toBe('测试歌手')
  })

  it('解析行时间并按下一行推算结束时间', () => {
    const r = parseLrc(STANDARD)
    expect(r.lines).toHaveLength(4)
    expect(r.lines[0].start).toBe(1000)
    expect(r.lines[0].end).toBe(5500)
    expect(r.lines[1].end).toBe(10000)
  })

  it('空内容行保留为清屏行', () => {
    const r = parseLrc(STANDARD)
    expect(r.lines[2].words).toHaveLength(0)
  })

  it('最后一行结束时间为估算值', () => {
    const r = parseLrc(STANDARD)
    const last = r.lines[3]
    expect(last.end).toBeGreaterThan(last.start)
    expect(last.end - last.start).toBeLessThanOrEqual(8000)
  })

  it('逐字时间在行区间内单调递增', () => {
    const r = parseLrc(STANDARD)
    const chars = r.lines[0].words.flatMap((w) => w.chars)
    expect(chars.length).toBeGreaterThan(0)
    let prev = r.lines[0].start - 1
    for (const c of chars) {
      expect(c.start).toBeGreaterThanOrEqual(prev)
      expect(c.start).toBeGreaterThanOrEqual(r.lines[0].start)
      expect(c.end).toBeLessThanOrEqual(r.lines[0].end)
      prev = c.start
    }
  })
})

describe('parseLrc 一行多时间戳', () => {
  it('展开为多行并排序', () => {
    const r = parseLrc(MULTI_TAG)
    expect(r.lines.map((l) => l.start)).toEqual([1000, 10000, 30000])
    expect(r.lines[0].text).toBe('副歌重复句')
    expect(r.lines[2].text).toBe('副歌重复句')
  })
})

describe('parseLrc 增强型（逐字标签）', () => {
  it('使用精确逐字时间', () => {
    const r = parseLrc(ENHANCED)
    const words = r.lines[0].words
    expect(words.map((w) => w.text)).toEqual(['你', '好', '世界'])
    expect(words[0].start).toBe(1000)
    expect(words[1].start).toBe(1400)
    expect(words[2].start).toBe(2000)
    // 段结束 = 下一段开始
    expect(words[0].end).toBe(1400)
  })

  it('行文本为去标签后的纯文本', () => {
    const r = parseLrc(ENHANCED)
    expect(r.lines[0].text).toBe('你好世界')
  })
})

describe('offset 标签', () => {
  it('正 offset 让歌词提前', () => {
    const r = parseLrc(OFFSET)
    expect(r.lines[0].start).toBe(500)
  })
})

describe('timing 辅助', () => {
  it('lyricsDuration = 最后行结束 + 尾巴', () => {
    const r = parseLrc(STANDARD)
    expect(lyricsDuration(r.lines)).toBe(r.lines[3].end + 2000)
  })

  it('rebuildLineText 保留原时间区间', () => {
    const r = parseLrc(STANDARD)
    const rebuilt = rebuildLineText(r.lines[0], '改过的词')
    expect(rebuilt.start).toBe(r.lines[0].start)
    expect(rebuilt.end).toBe(r.lines[0].end)
    expect(rebuilt.text).toBe('改过的词')
    const chars = rebuilt.words.flatMap((w) => w.chars)
    expect(chars.every((c) => c.start >= rebuilt.start && c.end <= rebuilt.end)).toBe(true)
  })
})

describe('线段时间编辑', () => {
  it('shiftLine 整体平移，逐字相对时间不变', () => {
    const r = parseLrc(STANDARD)
    const moved = shiftLine(r.lines[0], 1500)
    expect(moved.start).toBe(r.lines[0].start + 1500)
    expect(moved.end).toBe(r.lines[0].end + 1500)
    const before = r.lines[0].words.flatMap((w) => w.chars).map((c) => c.start - r.lines[0].start)
    const after = moved.words.flatMap((w) => w.chars).map((c) => c.start - moved.start)
    expect(after).toEqual(before)
  })

  it('shiftLine 不允许移到 0 之前', () => {
    const r = parseLrc(STANDARD)
    const moved = shiftLine(r.lines[0], -99999)
    expect(moved.start).toBe(0)
    expect(moved.end - moved.start).toBe(r.lines[0].end - r.lines[0].start)
  })

  it('retimeLine 重设起止，逐字时间按比例落在新区间内', () => {
    const r = parseLrc(STANDARD)
    const line = r.lines[0]
    const re = retimeLine(line, 2000, 4000)
    expect(re.start).toBe(2000)
    expect(re.end).toBe(4000)
    for (const c of re.words.flatMap((w) => w.chars)) {
      expect(c.start).toBeGreaterThanOrEqual(2000)
      expect(c.end).toBeLessThanOrEqual(4000)
    }
  })

  it('retimeLine 保证最小 100ms 时长', () => {
    const r = parseLrc(STANDARD)
    const re = retimeLine(r.lines[0], 5000, 5000)
    expect(re.end - re.start).toBeGreaterThanOrEqual(100)
  })

  it('解析出的行带行级特效与位置默认值', () => {
    const r = parseLrc(STANDARD)
    expect(r.lines[0].effectId).toBeNull()
    expect(r.lines[0].dx).toBe(0)
    expect(r.lines[0].dy).toBe(0)
  })
})

describe('layoutLine', () => {
  const measure = (text: string, fontSize: number): number => [...text].length * fontSize

  it('center：所有字符水平居中且不越界', () => {
    const r = parseLrc(STANDARD)
    const placed = layoutLine(r.lines[0], {
      width: 1080,
      height: 1920,
      fontSize: 88,
      variant: 'center',
      measure
    })
    expect(placed.length).toBe([...r.lines[0].text].length)
    for (const p of placed) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(1080)
    }
    // 整体垂直居中附近
    const ys = placed.map((p) => p.y)
    const mid = (Math.min(...ys) + Math.max(...ys)) / 2
    expect(Math.abs(mid - 960)).toBeLessThan(200)
  })

  it('staggered：确定性（两次布局结果一致）', () => {
    const r = parseLrc(STANDARD)
    const opts = { width: 1080, height: 1920, fontSize: 88, variant: 'staggered' as const, measure }
    const a = layoutLine(r.lines[1], opts)
    const b = layoutLine(r.lines[1], opts)
    expect(a).toEqual(b)
  })

  it('长行自动换行为多行', () => {
    const r = parseLrc('[00:01.00]这是一句非常非常非常非常非常非常长的歌词需要换行')
    const placed = layoutLine(r.lines[0], {
      width: 1080,
      height: 1920,
      fontSize: 100,
      variant: 'center',
      measure
    })
    const ys = new Set(placed.map((p) => p.y))
    expect(ys.size).toBeGreaterThan(1)
  })
})
