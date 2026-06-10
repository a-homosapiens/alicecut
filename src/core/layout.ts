import type { LrcChar, LrcLine, LrcWord } from './types'
import { seededRand } from './easing'

export type LayoutVariant = 'center' | 'staggered'

export interface PlacedChar {
  char: LrcChar
  word: LrcWord
  /** 动画单元序号 = 词在行内的序号 */
  unitIndex: number
  charIndexInUnit: number
  globalCharIndex: number
  /** 字符中心点坐标（画布像素） */
  x: number
  y: number
  /** 该字符实际字号（错落布局会缩放） */
  fontSize: number
  /** 字符宽度（按实际字号测量） */
  w: number
  /** 布局自带的固定旋转（rad），错落构图用 */
  rotate: number
}

export interface LayoutOptions {
  width: number
  height: number
  fontSize: number
  variant: LayoutVariant
  /** 测量函数：给定文本与字号返回像素宽度（由渲染层注入，core 不碰 DOM） */
  measure: (text: string, fontSize: number) => number
}

interface RowItem {
  word: LrcWord
  unitIndex: number
  fontSize: number
  rotate: number
  charWidths: number[]
  width: number
}

/** 把词打包成行（不在词内断行；单词超宽时按字符强拆） */
function packRows(items: RowItem[], maxWidth: number, gap: number): RowItem[][] {
  const rows: RowItem[][] = []
  let row: RowItem[] = []
  let rowWidth = 0
  for (const item of items) {
    const need = row.length === 0 ? item.width : rowWidth + gap + item.width
    if (row.length > 0 && need > maxWidth) {
      rows.push(row)
      row = [item]
      rowWidth = item.width
    } else {
      row.push(item)
      rowWidth = need
    }
  }
  if (row.length > 0) rows.push(row)
  return rows
}

function makeItems(
  line: LrcLine,
  opts: LayoutOptions,
  sizeFor: (unitIndex: number) => number,
  rotateFor: (unitIndex: number) => number
): RowItem[] {
  const letterSpacing = opts.fontSize * 0.05
  return line.words.map((word, unitIndex) => {
    const fontSize = sizeFor(unitIndex)
    const charWidths = word.chars.map((c) => opts.measure(c.text, fontSize))
    const width = charWidths.reduce((a, b) => a + b, 0) + letterSpacing * Math.max(0, word.chars.length - 1)
    return { word, unitIndex, fontSize, rotate: rotateFor(unitIndex), charWidths, width }
  })
}

/**
 * 计算一行歌词每个字符的位置。
 * center：统一字号、整体居中——常规歌词构图。
 * staggered：每个词随机大小/角度错落——「文字向」冲击构图。
 */
export function layoutLine(line: LrcLine, opts: LayoutOptions): PlacedChar[] {
  if (line.words.length === 0) return []
  const rand = seededRand(line.id + 1)
  const isStaggered = opts.variant === 'staggered'

  const items = makeItems(
    line,
    opts,
    (i) => (isStaggered ? opts.fontSize * (0.85 + rand(i * 7 + 1) * 0.75) : opts.fontSize),
    (i) => (isStaggered ? (rand(i * 13 + 5) - 0.5) * 0.09 : 0)
  )

  const maxWidth = opts.width * (isStaggered ? 0.86 : 0.82)
  const gap = opts.fontSize * (isStaggered ? 0.3 : 0.12)
  const letterSpacing = opts.fontSize * 0.05
  const rows = packRows(items, maxWidth, gap)

  const rowHeights = rows.map(
    (row) => Math.max(...row.map((it) => it.fontSize)) * (isStaggered ? 1.4 : 1.3)
  )
  const blockHeight = rowHeights.reduce((a, b) => a + b, 0)
  let y = opts.height / 2 - blockHeight / 2

  const placed: PlacedChar[] = []
  let globalCharIndex = 0
  rows.forEach((row, rowIdx) => {
    const rowWidth = row.reduce((a, it) => a + it.width, 0) + gap * Math.max(0, row.length - 1)
    // 错落构图：行整体加一点水平抖动，制造交错感
    const jitterX = isStaggered ? (rand(rowIdx * 31 + 17) - 0.5) * opts.fontSize * 0.8 : 0
    let x = (opts.width - rowWidth) / 2 + jitterX
    const cy = y + rowHeights[rowIdx] / 2

    for (const item of row) {
      const jitterY = isStaggered ? (rand(item.unitIndex * 11 + 3) - 0.5) * opts.fontSize * 0.25 : 0
      item.word.chars.forEach((char, ci) => {
        const w = item.charWidths[ci]
        placed.push({
          char,
          word: item.word,
          unitIndex: item.unitIndex,
          charIndexInUnit: ci,
          globalCharIndex: globalCharIndex++,
          x: x + w / 2,
          y: cy + jitterY,
          fontSize: item.fontSize,
          w,
          rotate: item.rotate
        })
        x += w + letterSpacing
      })
      x += gap - letterSpacing
    }
    y += rowHeights[rowIdx]
  })
  return placed
}
