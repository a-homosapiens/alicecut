import type { LrcMeta, ParsedLrc, RawEntry } from './types'
import { buildLines } from './timing'

/** 行首时间标签，支持 [mm:ss] [mm:ss.xx] [mm:ss.xxx] [mm:ss:xx]，一行可叠多个 */
const TIME_TAG = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/
/** 增强型 LRC 行内逐字标签 <mm:ss.xx> */
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g
const META_TAG = /^\[(ti|ar|al|by|re|ve|offset)\s*:(.*)\]$/i

function tagToMs(min: string, sec: string, frac: string | undefined): number {
  let ms = 0
  if (frac) {
    // 两位是百分秒，三位是毫秒
    ms = frac.length === 3 ? Number(frac) : Number(frac.padEnd(2, '0')) * 10
  }
  return Number(min) * 60000 + Number(sec) * 1000 + ms
}

function parseSegments(content: string): { time: number; text: string }[] | null {
  WORD_TAG.lastIndex = 0
  if (!WORD_TAG.test(content)) return null
  WORD_TAG.lastIndex = 0
  const segments: { time: number; text: string }[] = []
  let match: RegExpExecArray | null
  let lastTime: number | null = null
  let lastEnd = 0
  while ((match = WORD_TAG.exec(content)) !== null) {
    const text = content.slice(lastEnd, match.index)
    if (lastTime !== null && text.length > 0) segments.push({ time: lastTime, text })
    lastTime = tagToMs(match[1], match[2], match[3])
    lastEnd = match.index + match[0].length
  }
  const tail = content.slice(lastEnd)
  if (lastTime !== null && tail.length > 0) segments.push({ time: lastTime, text: tail })
  return segments.length > 0 ? segments : null
}

/**
 * 解析 LRC 文本（标准 / 增强型 / 一行多时间戳 / 元数据标签）。
 * 输出按时间排序、带逐字时间的歌词行。
 */
export function parseLrc(text: string): ParsedLrc {
  const meta: LrcMeta = { offset: 0 }
  const entries: RawEntry[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue

    const metaMatch = line.match(META_TAG)
    if (metaMatch) {
      const key = metaMatch[1].toLowerCase()
      const value = metaMatch[2].trim()
      if (key === 'ti') meta.title = value
      else if (key === 'ar') meta.artist = value
      else if (key === 'al') meta.album = value
      else if (key === 'offset') meta.offset = Number(value) || 0
      continue
    }

    const times: number[] = []
    let rest = line
    let m: RegExpMatchArray | null
    while ((m = rest.match(TIME_TAG)) !== null) {
      times.push(tagToMs(m[1], m[2], m[3]))
      rest = rest.slice(m[0].length)
    }
    if (times.length === 0) continue

    const content = rest.trim()
    const segments = parseSegments(content)
    const plainText = segments ? segments.map((s) => s.text).join('') : content
    for (const time of times) {
      entries.push({ time, content: plainText, segments })
    }
  }

  // offset 正值 = 歌词提前出现
  if (meta.offset !== 0) {
    for (const e of entries) {
      e.time = Math.max(0, e.time - meta.offset)
      if (e.segments) e.segments = e.segments.map((s) => ({ ...s, time: Math.max(0, s.time - meta.offset) }))
    }
  }

  entries.sort((a, b) => a.time - b.time)
  return { meta, lines: buildLines(entries) }
}
