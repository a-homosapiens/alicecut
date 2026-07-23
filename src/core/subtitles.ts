import type { LrcLine, LrcWord, ParsedLrc, RawEntry } from './types'
import { buildLines } from './timing'
import { parseLrc } from './lrc'

/**
 * 通用字幕导入：SRT / WebVTT。
 * 解析成与 LRC 相同的中间产物 RawEntry[]，复用 buildLines 生成歌词行，
 * 因此所有特效/排版/导出对字幕一视同仁。字幕自带显式结束时间（含空白间隔），
 * 通过 RawEntry.end 透传，比 LRC 的"下一行起点"更精确。
 */

/** 行内逐词时间标签 <HH:MM:SS.mmm> / <MM:SS.mmm>（WebVTT），用于逐词高亮 */
const VTT_INLINE_TS = /<((?:\d+:)?\d{1,2}:\d{1,2}[.,]\d{1,3})>/g

/** 解析一个时间码：HH:MM:SS,mmm（SRT）/ HH:MM:SS.mmm / MM:SS.mmm（VTT，时位可省）。失败返回 null */
function parseTimecode(raw: string): number | null {
  const m = raw.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/)
  if (!m) return null
  const h = m[1] ? Number(m[1]) : 0
  const min = Number(m[2])
  const sec = Number(m[3])
  // 不足 3 位的小数按右侧补零当毫秒（"5"→500，"50"→500，"500"→500）
  const ms = Number(m[4].padEnd(3, '0'))
  return h * 3600000 + min * 60000 + sec * 1000 + ms
}

/** 去掉富文本/样式标签与常见 HTML 实体（<i> <b> <font> <c> <v> {…} 等） */
function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
}

/**
 * 解析 WebVTT 行内逐词时间标签为分段（与增强型 LRC 的 segments 等价）。
 * 形如 `词A<00:00:01.500>词B<00:00:02.000>词C`：首个标签前的文本用 cue 起始时间。
 * 无行内标签时返回 null（退化为按整行时长插值）。
 */
function parseVttSegments(content: string, cueStart: number): { time: number; text: string }[] | null {
  VTT_INLINE_TS.lastIndex = 0
  if (!VTT_INLINE_TS.test(content)) return null
  VTT_INLINE_TS.lastIndex = 0
  const segments: { time: number; text: string }[] = []
  let lastTime = cueStart
  let lastEnd = 0
  let match: RegExpExecArray | null
  while ((match = VTT_INLINE_TS.exec(content)) !== null) {
    const text = stripTags(content.slice(lastEnd, match.index))
    if (text.trim().length > 0) segments.push({ time: lastTime, text })
    lastTime = parseTimecode(match[1]) ?? lastTime
    lastEnd = match.index + match[0].length
  }
  const tail = stripTags(content.slice(lastEnd))
  if (tail.trim().length > 0) segments.push({ time: lastTime, text: tail })
  return segments.length > 0 ? segments : null
}

/** 拆成"以空行分隔"的块，统一换行、去 BOM */
function splitBlocks(text: string): string[][] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n[ \t]*\r?\n/)
    .map((b) => b.split(/\r?\n/))
    .filter((lines) => lines.some((l) => l.trim().length > 0))
}

/** 由排序后的条目收尾：排序 + buildLines（meta 字幕格式不携带，留空） */
function finish(entries: RawEntry[]): ParsedLrc {
  entries.sort((a, b) => a.time - b.time)
  return { meta: { offset: 0 }, lines: buildLines(entries) }
}

/** 解析 SRT 字幕：块内含可选序号行、`HH:MM:SS,mmm --> HH:MM:SS,mmm` 时间行、文本行 */
export function parseSrt(text: string): ParsedLrc {
  const entries: RawEntry[] = []
  for (const lines of splitBlocks(text)) {
    const arrowIdx = lines.findIndex((l) => l.includes('-->'))
    if (arrowIdx === -1) continue
    const [startRaw, endRaw] = lines[arrowIdx].split('-->')
    const start = parseTimecode(startRaw)
    if (start == null) continue
    const end = parseTimecode((endRaw ?? '').trim().split(/\s+/)[0] ?? '')
    const content = stripTags(lines.slice(arrowIdx + 1).join(' ')).replace(/\s+/g, ' ').trim()
    if (content.length === 0) continue
    entries.push({ time: start, end: end ?? undefined, content, segments: null })
  }
  return finish(entries)
}

/**
 * 解析 WebVTT 字幕：跳过 `WEBVTT` 头与 `NOTE`/`STYLE` 块（它们不含 `-->`），
 * 时间行用点号毫秒、时位可省，结束时间后的 cue 设置（align/position…）忽略。
 * 文本支持行内逐词时间标签 → 逐词高亮。
 */
export function parseVtt(text: string): ParsedLrc {
  const entries: RawEntry[] = []
  for (const lines of splitBlocks(text)) {
    const arrowIdx = lines.findIndex((l) => l.includes('-->'))
    if (arrowIdx === -1) continue
    const [startRaw, endRaw] = lines[arrowIdx].split('-->')
    const start = parseTimecode(startRaw)
    if (start == null) continue
    const end = parseTimecode((endRaw ?? '').trim().split(/\s+/)[0] ?? '')
    const rawContent = lines.slice(arrowIdx + 1).join(' ')
    const segments = parseVttSegments(rawContent, start)
    const content = segments
      ? segments.map((s) => s.text).join('')
      : stripTags(rawContent).replace(/\s+/g, ' ').trim()
    if (content.length === 0) continue
    entries.push({ time: start, end: end ?? undefined, content, segments })
  }
  return finish(entries)
}

/** 按文件扩展名分发：.srt / .vtt 走字幕解析，其余（.lrc/.txt）走 LRC 解析 */
export function parseCaptions(text: string, name: string): ParsedLrc {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (ext === 'srt') return parseSrt(text)
  if (ext === 'vtt') return parseVtt(text)
  return parseLrc(text)
}

/* ---------------------------------------------------------------------------
 * 自动分页（仿 @remotion/captions 的 createTikTokStyleCaptions）
 * 把逐词流按"每页时长不超过 combineWithinMs"重组成页：阈值越大每页词越多
 * （趋向整句），越小越接近逐词。仅按词边界切页，保留各词原始绝对时间。
 * ------------------------------------------------------------------------- */

/** 把逐词数组按页时长阈值分组；每组为一页的词 */
export function paginateWords(words: LrcWord[], combineWithinMs: number): LrcWord[][] {
  const pages: LrcWord[][] = []
  let current: LrcWord[] = []
  let pageStart = 0
  for (const w of words) {
    if (current.length > 0 && w.start - pageStart > combineWithinMs) {
      pages.push(current)
      current = []
    }
    if (current.length === 0) pageStart = w.start
    current.push(w)
  }
  if (current.length > 0) pages.push(current)
  return pages
}

/**
 * 对歌词行重新分页：展平所有词→按阈值重组为新行。
 * 页结束时间取下一页起点（无缝切页，与 Remotion 的 TikTokPage 一致），
 * 末页取最后一词结束。词对象（含逐字时间）原样保留，故所有特效照常工作。
 * 传入的应为纯歌词行（不含独立文字块）；行级特效/位置因边界改变而重置。
 */
export function repaginateLines(lyricLines: LrcLine[], combineWithinMs: number): LrcLine[] {
  const words = lyricLines.flatMap((line, lineIndex) => line.words.map((word, wordIndex) => {
    if (lineIndex === 0 || wordIndex !== 0 || word.leading) return word
    const previous = lyricLines[lineIndex - 1].text.trimEnd()
    const needsSpace = /[\p{L}\p{N}]$/u.test(previous) && /^[\p{L}\p{N}]/u.test(word.text)
    return needsSpace ? { ...word, leading: ' ' } : word
  }))
  const pages = paginateWords(words, combineWithinMs)
  return pages.map((pw, i) => {
    const start = pw[0].start
    let end = i + 1 < pages.length ? pages[i + 1][0].start : pw[pw.length - 1].end
    if (end <= start) end = start + 100
    return {
      id: i,
      start,
      end,
      text: pw.map((w) => `${w.leading ?? ''}${w.text}`).join('').trim(),
      words: pw,
      effectId: null,
      dx: 0,
      dy: 0
    }
  })
}

/* ---------------------------------------------------------------------------
 * SRT 导出（仿 @remotion/captions 的 serializeSrt）
 * ------------------------------------------------------------------------- */

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

/** ms → `HH:MM:SS,mmm`（SRT 时间码） */
function msToSrtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms))
  return `${pad(Math.floor(t / 3600000), 2)}:${pad(Math.floor((t % 3600000) / 60000), 2)}:${pad(
    Math.floor((t % 60000) / 1000),
    2
  )},${pad(t % 1000, 3)}`
}

/** 把歌词行序列化为 SRT 文本（跳过空文本行，按时间排序、序号从 1 起） */
export function serializeSrt(lines: LrcLine[]): string {
  const cues = lines
    .filter((l) => l.text.trim().length > 0)
    .sort((a, b) => a.start - b.start)
  if (cues.length === 0) return ''
  return (
    cues
      .map((l, i) => `${i + 1}\n${msToSrtTime(l.start)} --> ${msToSrtTime(l.end)}\n${l.text}`)
      .join('\n\n') + '\n'
  )
}
