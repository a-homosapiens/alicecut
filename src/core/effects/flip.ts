import type { EffectPreset, LineFx, LineFxArgs } from './types'
import { IDENTITY_LINE_FX } from './types'

const QUARTER = Math.PI / 2

/** 行序奇偶决定停靠侧：交替左右，新行进场旋转方向与旧行停靠方向一致 */
function dirOf(lineId: number): number {
  return lineId % 2 === 0 ? 1 : -1
}

/** 停靠缩放：强度滑杆控制侧边旧字幕的大小 */
function parkedScale(intensity: number): number {
  return 0.35 + 0.25 * intensity
}

/**
 * 翻转切换工厂：整句进入中心，旧字幕翻转 90° 竖排停靠在新字幕侧边。
 * align = 'center'：旧字幕与新字幕垂直居中对齐；
 * align = 'bottom'：旧字幕（竖排后的）下边缘与新字幕下边缘对齐，像立在同一条底线上。
 */
function makeFlip(id: string, name: string, align: 'center' | 'bottom'): EffectPreset {
  /** 停靠竖排块的垂直偏移：竖排后高度 = 原块宽度 × 缩放 */
  const parkedDy = (depth: number, { blocks }: LineFxArgs, s: number): number => {
    if (align === 'center') return 0
    const parked = blocks[Math.min(depth, blocks.length - 1)]
    // 底对齐：停靠块底边 (dy + w·s/2) = 新字幕块底边 (h/2)
    return blocks[0].h / 2 - (parked.w * s) / 2
  }

  return {
    id,
    name,
    enterDuration: 480,
    layoutVariant: 'center',
    unit: 'line',
    lineTransition: {
      maxDepth: 1,
      enterFrom({ lineId, intensity }: LineFxArgs): LineFx {
        // 与上一行的停靠转向同向（同一行间边界），读起来像连续翻转
        const dir = dirOf(lineId)
        return {
          dx: 0,
          dy: 0,
          rotate: -dir * QUARTER,
          scale: 0.25,
          alpha: 0,
          blur: 2 * intensity
        }
      },
      pose(depth, args: LineFxArgs): LineFx {
        if (depth === 0) return IDENTITY_LINE_FX
        const { lineId, fontSize, intensity, blocks } = args
        // 这一行停靠时的转场方向 = 它让位给下一行（lineId+1）时的方向
        const dir = dirOf(lineId + 1)
        const s = parkedScale(intensity)
        // 竖排后水平占宽 = 原块高度 × 缩放；紧靠当前行块的外侧
        const sideGap = fontSize * 0.45
        const dx =
          dir * (blocks[0].w / 2 + (blocks[Math.min(depth, blocks.length - 1)].h * s) / 2 + sideGap)
        const dy = parkedDy(depth, args, s)
        if (depth === 1) {
          return { dx, dy, rotate: dir * QUARTER, scale: s, alpha: 0.78, blur: 0 }
        }
        // 更深的旧行：沿同侧推远并淡出
        return {
          dx: dx + dir * fontSize * (depth - 1) * 1.2,
          dy,
          rotate: dir * QUARTER,
          scale: s * 0.85,
          alpha: 0,
          blur: 2
        }
      }
    },
    apply() {
      return { dx: 0, dy: 0, scale: 1, rotate: 0, alpha: 1, blur: 0, glow: 0 }
    }
  }
}

export const flip = makeFlip('flip', '翻转切换', 'center')

export const flipBottom = makeFlip('flip-bottom', '翻转·底对齐', 'bottom')
