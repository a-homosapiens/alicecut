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
  letterSpacing: number
  wordSpacing: number
  lineSpacing: number
  align: 'left' | 'center' | 'right'
  orientation: 'horizontal' | 'vertical'
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
  letterSpacing: number
}

/**
 * 把词按累计尺寸打包成组（行 / 列），不在词内断行。
 * sizeOf 返回该词沿主轴的尺寸（横排 = 宽度，竖排 = 高度）。
 */
function packUnits(items: RowItem[], maxSize: number, gap: number, sizeOf: (it: RowItem) => number): RowItem[][] {
  const groups: RowItem[][] = []
  let group: RowItem[] = []
  let acc = 0
  for (const item of items) {
    const s = sizeOf(item)
    const need = group.length === 0 ? s : acc + gap + s
    if (group.length > 0 && need > maxSize) {
      groups.push(group)
      group = [item]
      acc = s
    } else {
      group.push(item)
      acc = need
    }
  }
  if (group.length > 0) groups.push(group)
  return groups
}

function makeItems(
  line: LrcLine,
  opts: LayoutOptions,
  sizeFor: (unitIndex: number) => number,
  rotateFor: (unitIndex: number) => number
): RowItem[] {
  const letterSpacing = opts.letterSpacing
  return line.words.map((word, unitIndex) => {
    const fontSize = sizeFor(unitIndex)
    const charWidths = word.chars.map((c) => opts.measure(c.text, fontSize))
    const width = charWidths.reduce((a, b) => a + b, 0) + letterSpacing * Math.max(0, word.chars.length - 1)
    return { word, unitIndex, fontSize, rotate: rotateFor(unitIndex), charWidths, width, letterSpacing }
  })
}

function scaleItem(item: RowItem, factor: number): RowItem {
  const f = Number.isFinite(factor) && factor > 0 ? Math.min(1, factor) : 1
  return {
    ...item,
    fontSize: item.fontSize * f,
    charWidths: item.charWidths.map((width) => width * f),
    width: item.width * f,
    letterSpacing: item.letterSpacing * f
  }
}

/**
 * 计算一行歌词每个字符的位置。
 * center：统一字号、整体居中——常规歌词构图。
 * staggered：每个词随机大小/角度错落——「文字向」冲击构图。
 * 竖排（orientation='vertical'）走独立的排版路径：字保持直立、自上而下、多列时从右向左。
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

  return opts.orientation === 'vertical'
    ? layoutVertical(items, opts, rand, isStaggered)
    : layoutHorizontal(items, opts, rand, isStaggered)
}

/** 横排：词按宽度折行，行自上而下堆叠，行内字从左到右。 */
function layoutHorizontal(items: RowItem[], opts: LayoutOptions, rand: (k: number) => number, isStaggered: boolean): PlacedChar[] {
  const maxWidth = opts.width * (isStaggered ? 0.86 : 0.82)
  const gap = isStaggered ? Math.max(opts.wordSpacing, opts.fontSize * 0.3) : opts.wordSpacing
  const fitted = items.map((item) => item.width > maxWidth ? scaleItem(item, maxWidth / item.width) : item)
  const rows = packUnits(fitted, maxWidth, gap, (it) => it.width)

  const rowHeights = rows.map(
    (row) => Math.max(...row.map((it) => it.fontSize)) * (isStaggered ? 1.4 : 1.3) * opts.lineSpacing
  )
  const blockHeight = rowHeights.reduce((a, b) => a + b, 0)
  let y = opts.height / 2 - blockHeight / 2

  const placed: PlacedChar[] = []
  let globalCharIndex = 0
  rows.forEach((row, rowIdx) => {
    const rowWidth = row.reduce((a, it) => a + it.width, 0) + gap * Math.max(0, row.length - 1)
    // 错落构图：行整体加一点水平抖动，制造交错感
    const jitterX = isStaggered ? (rand(rowIdx * 31 + 17) - 0.5) * opts.fontSize * 0.8 : 0
    const left = opts.width * 0.09
    const right = opts.width * 0.91
    let x =
      opts.align === 'left'
        ? left + jitterX
        : opts.align === 'right'
          ? right - rowWidth + jitterX
          : (opts.width - rowWidth) / 2 + jitterX
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
        x += w + item.letterSpacing
      })
      x += gap - item.letterSpacing
    }
    y += rowHeights[rowIdx]
  })
  return placed
}

/**
 * 竖排（传统中文竖排）：字保持直立、在一列内自上而下堆叠；一列排满（超过画面高度）
 * 后换到左边的新列——多列从右向左阅读。整块列组水平居中，字沿列心对齐。
 * align 映射到纵向：left→顶对齐、center→居中、right→底对齐。
 */
function layoutVertical(items: RowItem[], opts: LayoutOptions, rand: (k: number) => number, isStaggered: boolean): PlacedChar[] {
  const gap = isStaggered ? Math.max(opts.wordSpacing, opts.fontSize * 0.3) : opts.wordSpacing
  const maxHeight = opts.height * (isStaggered ? 0.86 : 0.82)
  // 词沿列的高度：每个字的纵向步进≈字号（CJK 方块字），字间距叠加在字之间
  const itemHeight = (it: RowItem): number =>
    it.fontSize * it.word.chars.length + it.letterSpacing * Math.max(0, it.word.chars.length - 1)
  const fitted = items.map((item) => {
    const height = itemHeight(item)
    return height > maxHeight ? scaleItem(item, maxHeight / height) : item
  })
  const columns = packUnits(fitted, maxHeight, gap, itemHeight)

  // 列的横向步进（列宽，含列间距）——对应横排里的行高
  const columnWidths = columns.map(
    (col) => Math.max(...col.map((it) => it.fontSize)) * (isStaggered ? 1.4 : 1.3) * opts.lineSpacing
  )
  const blockWidth = columnWidths.reduce((a, b) => a + b, 0)
  // 列组水平居中；从右向左：第一列（阅读顺序）落在整块的最右侧
  let xRightEdge = opts.width / 2 + blockWidth / 2

  const placed: PlacedChar[] = []
  let globalCharIndex = 0
  columns.forEach((col, colIdx) => {
    const colWidth = columnWidths[colIdx]
    const colHeight = col.reduce((a, it) => a + itemHeight(it), 0) + gap * Math.max(0, col.length - 1)
    // 错落构图：整列加一点横向抖动
    const jitterX = isStaggered ? (rand(colIdx * 31 + 17) - 0.5) * opts.fontSize * 0.8 : 0
    const top = opts.height * 0.09
    const bottom = opts.height * 0.91
    let y =
      opts.align === 'left'
        ? top
        : opts.align === 'right'
          ? bottom - colHeight
          : (opts.height - colHeight) / 2
    const cx = xRightEdge - colWidth / 2 + jitterX

    for (const item of col) {
      const jitterY = isStaggered ? (rand(item.unitIndex * 11 + 3) - 0.5) * opts.fontSize * 0.25 : 0
      item.word.chars.forEach((char, ci) => {
        const h = item.fontSize // 纵向步进
        placed.push({
          char,
          word: item.word,
          unitIndex: item.unitIndex,
          charIndexInUnit: ci,
          globalCharIndex: globalCharIndex++,
          x: cx,
          y: y + h / 2 + jitterY,
          fontSize: item.fontSize,
          w: item.charWidths[ci],
          rotate: item.rotate // 直立，不旋转
        })
        y += h + item.letterSpacing
      })
      y += gap - item.letterSpacing
    }
    xRightEdge -= colWidth
  })
  return placed
}
