/** 一个字符在某一帧的变换结果 */
export interface CharFx {
  dx: number
  dy: number
  scale: number
  /** rad */
  rotate: number
  /** 0..1 */
  alpha: number
  /** px，>0 时应用模糊 */
  blur: number
  /** px，>0 时应用辉光（shadowBlur） */
  glow: number
  /** 0..1：向高亮色（style.highlightColor）混合的比例，卡拉OK高亮用；缺省 0 */
  highlight?: number
  /** 水平/垂直错切（shear），rad 量级；缺省 0。飘摆/倾斜特效用 */
  skewX?: number
  skewY?: number
}

export interface FxArgs {
  /** 动画单元（字或词）在行内的序号 */
  unitIndex: number
  unitCount: number
  charIndexInUnit: number
  /** 该单元进场进度 0..1（线性，未缓动；进场完成后恒为 1） */
  enterT: number
  /** 距行开始的毫秒数 */
  timeInLine: number
  lineDuration: number
  /** 本单元（字/词）相对行开始的起止毫秒，卡拉OK高亮判断当前词用 */
  unitStart: number
  unitEnd: number
  /** 用户强度参数，1 为默认 */
  intensity: number
  /** 确定性随机 [0,1)，按行播种，逐帧稳定 */
  rand: (key: number) => number
}

/** 整行作为整体的变换（绕画面中心），行级转场特效用 */
export interface LineFx {
  dx: number
  dy: number
  scale: number
  /** rad */
  rotate: number
  /** 0..1 */
  alpha: number
  blur: number
}

export interface LineFxArgs {
  /** 该行的行序号；转场方向按行序取模，保证新行进场与旧行停靠动作方向一致 */
  lineId: number
  width: number
  height: number
  fontSize: number
  intensity: number
  /** 各深度行的未缩放包围盒（画布像素）：blocks[0] 是当前中心行，blocks[d] 是第 d 条旧行 */
  blocks: { w: number; h: number }[]
}

/**
 * 行级转场（停靠式）：整句进场，旧行不消失而是停靠在画面上
 * （堆叠在上方 / 立在侧边）。每当新行进场，所有行从 pose(depth-1)
 * 联动过渡到 pose(depth)，新行从 enterFrom 过渡到 pose(0)。
 * 定义了 lineTransition 的特效走整块变换路径，apply 不再被调用。
 */
export interface LineTransition {
  /** 保留多少条停靠的旧行；深度超过 maxDepth 的行在转场中淡出（pose 返回 alpha 0） */
  maxDepth: number
  /** 新行进场的起始姿态 */
  enterFrom(args: LineFxArgs): LineFx
  /** 第 depth 条行的停靠姿态；depth=0 为当前中心行 */
  pose(depth: number, args: LineFxArgs): LineFx
}

export interface EffectPreset {
  id: string
  name: string
  /** 单个单元进场动画时长 ms */
  enterDuration: number
  /** 布局构图 */
  layoutVariant: 'center' | 'staggered'
  /** 动画单元：char 逐字 / word 逐词 / line 整句 */
  unit: 'char' | 'word' | 'line'
  /** 整行所有字从行开始就一起出现（不按字/词逐个出场），如卡拉OK高亮 */
  appearAtLineStart?: boolean
  /** 是否绘制打字机光标 */
  cursor?: boolean
  /** 在当前朗读词背后绘制一个圆角高亮块，并随读词逐词弹跳移动（仿抖音字幕） */
  wordBox?: boolean
  /**
   * 运动残影（仿 @remotion/motion-blur 的 Trail）：在字符运动时，
   * 按 apply 在 tMs−i·stepMs 时刻的姿态画 count 个逐渐淡出的残影。
   */
  trail?: { count: number; stepMs: number; decay?: number }
  /**
   * 遮罩式入场转场（仿 @remotion/transitions）：用裁剪区域在 enterDuration 内
   * 把整行"揭示"出来——wipe 矩形扫过 / iris 圆形展开 / clockWipe 角度扫掠。
   * 与停靠式 lineTransition 互斥；apply 通常返回全显（可见性交给裁剪）。
   */
  reveal?: 'wipe' | 'iris' | 'clockWipe'
  /** 行级转场（unit 为 line 时必填） */
  lineTransition?: LineTransition
  apply(args: FxArgs): CharFx
}

export const IDENTITY_FX: CharFx = { dx: 0, dy: 0, scale: 1, rotate: 0, alpha: 1, blur: 0, glow: 0, highlight: 0 }

export const IDENTITY_LINE_FX: LineFx = { dx: 0, dy: 0, scale: 1, rotate: 0, alpha: 1, blur: 0 }
