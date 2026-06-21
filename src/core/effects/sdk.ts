/**
 * 特效插件 SDK（公开契约，api=1）。第三方按此实现纯函数特效，
 * 宿主用本文件的适配器把它包成内部 EffectPreset：合并到恒等值、钳制范围、
 * 异常兜底——坏插件不能搞崩渲染。详见 docs/plugin-platform.md。
 *
 * 注：本原型为「软」装载（仅输出校验 + try/catch），尚未做全局遮蔽/硬沙箱。
 */
import { clamp01, easeOutCubic, easeOutBack, springEase, valueNoise } from '../easing'
import { IDENTITY_FX, IDENTITY_LINE_FX, type CharFx, type EffectPreset, type LineFx } from './types'

/** 整行转场参数（公开契约，与内部 LineFxArgs 对齐） */
export interface LineFxArgs {
  /** 行序号；转场方向常按行序奇偶取，保证连续转场方向一致 */
  lineId: number
  width: number
  height: number
  fontSize: number
  intensity: number
  /** 各深度行未缩放包围盒（画布像素）：blocks[0] 当前中心行，blocks[d] 第 d 条旧行 */
  blocks: { w: number; h: number }[]
}

/** 整行变换增量（绕画面中心；只写要改的，其余取恒等） */
export type PartialLineFx = Partial<{
  dx: number
  dy: number
  scale: number
  rotate: number
  alpha: number
  blur: number
}>

/** 平台提供给插件的纯工具，免去访问全局 */
export interface PluginHelpers {
  clamp01(t: number): number
  lerp(a: number, b: number, t: number): number
  easeOutCubic(t: number): number
  easeOutBack(t: number): number
  spring(t: number): number
  noise(seed: number, x: number): number
}

/** 插件可返回的字符变换增量（只写要改的，其余取恒等） */
export type PartialCharFx = Partial<{
  dx: number
  dy: number
  scale: number
  rotate: number
  alpha: number
  blur: number
  glow: number
  highlight: number
  skewX: number
  skewY: number
}>

/** 传给插件 apply 的参数（公开契约，与内部 FxArgs 对齐） */
export interface TextFxArgs {
  unitIndex: number
  unitCount: number
  charIndexInUnit: number
  enterT: number
  timeInLine: number
  lineDuration: number
  unitStart: number
  unitEnd: number
  intensity: number
  rand(key: number): number
}

export interface TextEffectDef {
  id: string
  name: string
  unit: 'char' | 'word'
  enterDurationMs: number
  appearAtLineStart?: boolean
  /**
   * 声明式遮罩揭示（几何裁剪，非 apply 能表达）：进场 enterDurationMs 内用裁剪区域
   * 把整行揭示出来——wipe 矩形扫过 / iris 圆形展开 / clockWipe 角度扫掠。
   * 建议搭配 appearAtLineStart: true（整行一起出现、由遮罩推进可见性）。apply 照常运行。
   */
  reveal?: 'wipe' | 'iris' | 'clockWipe'
  /** 声明式运动残影：字符运动时按更早时刻姿态画 count 个淡出残影。 */
  trail?: { count: number; stepMs: number; decay?: number }
  /** 声明式：在当前朗读词背后画随词弹跳的圆角高亮块（仿抖音字幕）。 */
  wordBox?: boolean
  apply(args: TextFxArgs, m: PluginHelpers): PartialCharFx
}

/**
 * 整行停靠式转场（unit='line'）：整句进中心，旧行不消失而是缩放/旋转后停靠
 * （堆叠上方 / 立侧边）形成历史。每当新行进场，所有行从 pose(depth-1) 联动到
 * pose(depth)，新行从 enterFrom 过渡到 pose(0)。enterFrom/pose 为纯函数。
 */
export interface LineEffectDef {
  id: string
  name: string
  /** 进场动画时长 ms */
  enterDurationMs: number
  /** 保留多少条停靠旧行（深度超过即淡出）；宿主钳到 0..6 */
  maxDepth: number
  /** 新行进场起始姿态 */
  enterFrom(args: LineFxArgs, m: PluginHelpers): PartialLineFx
  /** 第 depth 条行的停靠姿态；depth=0 为当前中心行 */
  pose(depth: number, args: LineFxArgs, m: PluginHelpers): PartialLineFx
}

export interface PluginManifest {
  api: number
  name: string
  version?: string
  author?: string
  textEffects?: TextEffectDef[]
  /** 整行停靠式转场（unit='line'） */
  lineTransitions?: LineEffectDef[]
}

export const HELPERS: PluginHelpers = {
  clamp01,
  lerp: (a, b, t) => a + (b - a) * t,
  easeOutCubic,
  easeOutBack,
  spring: springEase,
  noise: valueNoise
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

const REVEALS = ['wipe', 'iris', 'clockWipe'] as const

/** 规范化 reveal：仅接受已知枚举，否则 undefined（不静默退化成 wipe） */
export function normReveal(v: unknown): TextEffectDef['reveal'] {
  return typeof v === 'string' && (REVEALS as readonly string[]).includes(v)
    ? (v as TextEffectDef['reveal'])
    : undefined
}

/** 规范化 trail：count≥1（封顶 12 防性能爆炸）、stepMs∈[1,200]、decay∈[0,1]；非法 → undefined */
export function normTrail(v: unknown): TextEffectDef['trail'] {
  if (!v || typeof v !== 'object') return undefined
  const t = v as Record<string, unknown>
  const count = Math.round(num(t.count, 0))
  if (count < 1) return undefined
  const trail: { count: number; stepMs: number; decay?: number } = {
    count: Math.min(12, count),
    stepMs: Math.min(200, Math.max(1, num(t.stepMs, 24)))
  }
  if (t.decay !== undefined) trail.decay = clamp01(num(t.decay, 0.5))
  return trail
}

/** 把插件返回的部分增量合并成完整 CharFx，并钳制到安全范围 */
export function sanitizeCharFx(p: PartialCharFx | null | undefined): CharFx {
  if (!p || typeof p !== 'object') return { ...IDENTITY_FX }
  return {
    dx: num(p.dx, 0),
    dy: num(p.dy, 0),
    scale: Math.max(0, num(p.scale, 1)),
    rotate: num(p.rotate, 0),
    alpha: clamp01(num(p.alpha, 1)),
    blur: Math.max(0, num(p.blur, 0)),
    glow: Math.max(0, num(p.glow, 0)),
    highlight: clamp01(num(p.highlight, 0)),
    skewX: num(p.skewX, 0),
    skewY: num(p.skewY, 0)
  }
}

/** 把插件返回的部分整行增量合并成完整 LineFx，并钳制到安全范围 */
export function sanitizeLineFx(p: PartialLineFx | null | undefined): LineFx {
  if (!p || typeof p !== 'object') return { ...IDENTITY_LINE_FX }
  return {
    dx: num(p.dx, 0),
    dy: num(p.dy, 0),
    scale: Math.max(0, num(p.scale, 1)),
    rotate: num(p.rotate, 0),
    alpha: clamp01(num(p.alpha, 1)),
    blur: Math.max(0, num(p.blur, 0))
  }
}

/** 适配器：LineEffectDef → 内部 EffectPreset（unit='line'，enterFrom/pose 包裹校验与兜底） */
export function lineEffectToPreset(def: LineEffectDef): EffectPreset {
  return {
    id: def.id,
    name: def.name,
    enterDuration: Math.max(1, num(def.enterDurationMs, 480)),
    layoutVariant: 'center',
    unit: 'line',
    lineTransition: {
      maxDepth: Math.min(6, Math.max(0, Math.round(num(def.maxDepth, 1)))),
      enterFrom(args) {
        try {
          return sanitizeLineFx(def.enterFrom(args, HELPERS))
        } catch {
          return { ...IDENTITY_LINE_FX }
        }
      },
      pose(depth, args) {
        try {
          return sanitizeLineFx(def.pose(depth, args, HELPERS))
        } catch {
          return { ...IDENTITY_LINE_FX }
        }
      }
    },
    // lineTransition 定义后 apply 不被调用，仅为满足 EffectPreset 形状
    apply: () => ({ ...IDENTITY_FX })
  }
}

/** 适配器：TextEffectDef → 内部 EffectPreset（apply 包裹校验与兜底；声明式能力规范化后透传） */
export function textEffectToPreset(def: TextEffectDef): EffectPreset {
  const preset: EffectPreset = {
    id: def.id,
    name: def.name,
    enterDuration: Math.max(1, num(def.enterDurationMs, 300)),
    layoutVariant: 'center',
    unit: def.unit === 'word' ? 'word' : 'char',
    appearAtLineStart: !!def.appearAtLineStart,
    apply(args) {
      try {
        return sanitizeCharFx(def.apply(args, HELPERS))
      } catch {
        return { ...IDENTITY_FX }
      }
    }
  }
  const reveal = normReveal(def.reveal)
  if (reveal) preset.reveal = reveal
  const trail = normTrail(def.trail)
  if (trail) preset.trail = trail
  if (def.wordBox) preset.wordBox = true
  return preset
}

/** 校验插件清单结构，返回规整后的 manifest；非法则抛出可读错误 */
export function validateManifest(raw: unknown): PluginManifest {
  if (!raw || typeof raw !== 'object') throw new Error('插件没有默认导出对象')
  const m = raw as Record<string, unknown>
  if (m.api !== 1) throw new Error(`不支持的插件 api 版本：${String(m.api)}（需要 1）`)
  if (typeof m.name !== 'string' || m.name.length === 0) throw new Error('插件缺少 name')
  const rawEffects = Array.isArray(m.textEffects) ? m.textEffects : []
  const textEffects: TextEffectDef[] = []
  for (const t of rawEffects) {
    const d = t as Record<string, unknown>
    if (typeof d.id !== 'string' || typeof d.name !== 'string' || typeof d.apply !== 'function') {
      throw new Error('textEffects 条目需含 id、name 与 apply')
    }
    textEffects.push({
      id: d.id,
      name: d.name,
      unit: d.unit === 'word' ? 'word' : 'char',
      enterDurationMs: num(d.enterDurationMs, 300),
      appearAtLineStart: !!d.appearAtLineStart,
      reveal: normReveal(d.reveal),
      trail: normTrail(d.trail),
      wordBox: !!d.wordBox,
      apply: d.apply as TextEffectDef['apply']
    })
  }
  const rawLines = Array.isArray(m.lineTransitions) ? m.lineTransitions : []
  const lineTransitions: LineEffectDef[] = []
  for (const t of rawLines) {
    const d = t as Record<string, unknown>
    if (typeof d.id !== 'string' || typeof d.name !== 'string' || typeof d.enterFrom !== 'function' || typeof d.pose !== 'function') {
      throw new Error('lineTransitions 条目需含 id、name、enterFrom 与 pose')
    }
    lineTransitions.push({
      id: d.id,
      name: d.name,
      enterDurationMs: num(d.enterDurationMs, 480),
      maxDepth: num(d.maxDepth, 1),
      enterFrom: d.enterFrom as LineEffectDef['enterFrom'],
      pose: d.pose as LineEffectDef['pose']
    })
  }
  return {
    api: 1,
    name: m.name,
    version: typeof m.version === 'string' ? m.version : undefined,
    author: typeof m.author === 'string' ? m.author : undefined,
    textEffects,
    lineTransitions
  }
}
