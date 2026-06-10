import type { LrcChar, LrcLine, LrcWord, RawEntry } from './types'

/** 最后一行 / 兜底的行时长估算（ms） */
const MIN_LINE_MS = 2000
const MAX_LAST_LINE_MS = 8000
const PER_CHAR_MS = 350
/** 逐字进场占行时长的比例上限：出完字后留时间阅读 */
const FILL_RATIO = 0.65
/** 逐字进场窗口绝对上限（ms），避免超长间奏把字拖得太慢 */
const MAX_FILL_MS = 4000

/** 占时长权重：字母/数字/汉字 = 1，标点和空白只占一点点 */
function charWeight(ch: string): number {
  return /[\p{L}\p{N}]/u.test(ch) ? 1 : 0.2
}

/** 把字符串按词切开（中文逐字、西文按词），用于动画单元分组 */
export function segmentWords(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter('zh', { granularity: 'word' })
    const out: string[] = []
    for (const s of seg.segment(text)) {
      // 中日韩词组再拆成单字，逐字动画更有「蹦字」感
      if (/^[぀-ヿ㐀-鿿豈-﫿]+$/u.test(s.segment) && s.segment.length > 2) {
        out.push(...s.segment)
      } else {
        out.push(s.segment)
      }
    }
    return out
  }
  // 兜底：汉字逐字，其余按空格
  return text.split(/(\s+)/).flatMap((part) => {
    if (/^\s+$/.test(part)) return [part]
    return part.split(/([㐀-鿿豈-﫿])/u).filter((s) => s.length > 0)
  })
}

/** 在 [start, end) 内按权重给一串字符插值出现时间 */
function distributeChars(text: string, start: number, end: number): LrcChar[] {
  const chars = [...text]
  const weights = chars.map(charWeight)
  const total = weights.reduce((a, b) => a + b, 0)
  if (total === 0) {
    return chars.map((c) => ({ text: c, start, end }))
  }
  const span = Math.max(0, end - start)
  const result: LrcChar[] = []
  let acc = 0
  for (let i = 0; i < chars.length; i++) {
    const s = start + (acc / total) * span
    acc += weights[i]
    const e = start + (acc / total) * span
    result.push({ text: chars[i], start: Math.round(s), end: Math.round(e) })
  }
  return result
}

/** 标准 LRC：把整行时长按词→字插值 */
function buildWordsByInterpolation(content: string, start: number, end: number): LrcWord[] {
  const tokens = segmentWords(content)
  const fillEnd = start + Math.min((end - start) * FILL_RATIO, MAX_FILL_MS)
  const weights = tokens.map((t) => [...t].reduce((a, c) => a + charWeight(c), 0))
  const total = weights.reduce((a, b) => a + b, 0)
  const words: LrcWord[] = []
  let acc = 0
  for (let i = 0; i < tokens.length; i++) {
    if (/^\s+$/.test(tokens[i])) {
      acc += weights[i]
      continue
    }
    const ws = total > 0 ? start + (acc / total) * (fillEnd - start) : start
    acc += weights[i]
    const we = total > 0 ? start + (acc / total) * (fillEnd - start) : fillEnd
    words.push({
      text: tokens[i],
      start: Math.round(ws),
      end: Math.round(we),
      chars: distributeChars(tokens[i], Math.round(ws), Math.round(we))
    })
  }
  return words
}

/** 增强型 LRC：分段时间精确，段内字符均分 */
function buildWordsFromSegments(
  segments: { time: number; text: string }[],
  lineEnd: number
): LrcWord[] {
  const words: LrcWord[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const text = seg.text.trim()
    if (text.length === 0) continue
    const segEnd = i + 1 < segments.length ? segments[i + 1].time : Math.min(seg.time + 1000, lineEnd)
    words.push({
      text,
      start: seg.time,
      end: segEnd,
      chars: distributeChars(text, seg.time, segEnd)
    })
  }
  return words
}

/** 由排好序的原始条目生成最终歌词行（计算行结束时间 + 逐字时间） */
export function buildLines(entries: RawEntry[]): LrcLine[] {
  return entries.map((entry, i) => {
    const start = entry.time
    let end: number
    if (i + 1 < entries.length) {
      end = entries[i + 1].time
    } else {
      const estimate = Math.max(MIN_LINE_MS, [...entry.content].length * PER_CHAR_MS)
      end = start + Math.min(estimate, MAX_LAST_LINE_MS)
    }
    if (end <= start) end = start + MIN_LINE_MS

    const words = entry.segments
      ? buildWordsFromSegments(entry.segments, end)
      : buildWordsByInterpolation(entry.content, start, end)

    return {
      id: i,
      start,
      end,
      text: words.map((w) => w.text).join(''),
      words,
      effectId: null,
      dx: 0,
      dy: 0
    }
  })
}

/** 整体平移一行的时间（线段左右挪动）：行与逐字时间一起移 */
export function shiftLine(line: LrcLine, deltaMs: number): LrcLine {
  const d = Math.max(deltaMs, -line.start) // 不允许移到 0 之前
  if (d === 0) return line
  return {
    ...line,
    start: line.start + d,
    end: line.end + d,
    words: line.words.map((w) => ({
      ...w,
      start: w.start + d,
      end: w.end + d,
      chars: w.chars.map((c) => ({ ...c, start: c.start + d, end: c.end + d }))
    }))
  }
}

/** 修改一行的起止时间（线段边缘微调）：逐字时间按比例重映射到新区间 */
export function retimeLine(line: LrcLine, newStart: number, newEnd: number): LrcLine {
  const start = Math.max(0, Math.round(newStart))
  const end = Math.max(start + 100, Math.round(newEnd))
  const oldSpan = Math.max(1, line.end - line.start)
  const map = (t: number): number => Math.round(start + ((t - line.start) / oldSpan) * (end - start))
  return {
    ...line,
    start,
    end,
    words: line.words.map((w) => ({
      ...w,
      start: map(w.start),
      end: map(w.end),
      chars: w.chars.map((c) => ({ ...c, start: map(c.start), end: map(c.end) }))
    }))
  }
}

/** 用户编辑歌词文本后，在原有时间区间内重建逐字时间 */
export function rebuildLineText(line: LrcLine, newText: string): LrcLine {
  return {
    ...line,
    text: newText.trim(),
    words: buildWordsByInterpolation(newText.trim(), line.start, line.end)
  }
}

/** 项目总时长（ms）：最后一行结束 + 收尾停留 */
export function lyricsDuration(lines: LrcLine[], tailMs = 2000): number {
  if (lines.length === 0) return 0
  return lines[lines.length - 1].end + tailMs
}
