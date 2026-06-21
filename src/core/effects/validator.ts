/**
 * 插件校验器（开发期工具）。第三方/其 agent 写完插件后跑它自检：
 * 确定性（预览=导出的前提）、输出范围、性能、纯净度、不崩。详见 docs/plugin-platform.md。
 *
 * 本文件**自包含**（不 import 项目内其他模块），以便：app 内导入时校验、vitest 测试、
 * 以及 `node scripts/validate-plugin.ts` 直接运行（Node 跑 TS 不解析无扩展名的相对导入）。
 * 这里内联的工具与 src/core/easing.ts 保持一致（有 validator.test.ts 守护对齐）。
 */

/* ---- 内联工具（须与 easing.ts 对齐）---- */
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)
function easeOutBack(t: number): number {
  const c1 = 1.70158
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
function springEase(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return 1 - Math.exp(-6 * t) * Math.cos(9 * t)
}
function seededRand(seed: number): (key: number) => number {
  return (key: number) => {
    let h = (seed * 374761393 + key * 668265263) | 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h = (h ^ (h >>> 16)) >>> 0
    return h / 4294967296
  }
}
function valueNoise(seed: number, x: number): number {
  const rand = seededRand(seed)
  const xi = Math.floor(x)
  const xf = x - xi
  const a = rand(xi) * 2 - 1
  const b = rand(xi + 1) * 2 - 1
  return a + (b - a) * (xf * xf * (3 - 2 * xf))
}

export const VALIDATOR_HELPERS = {
  clamp01,
  lerp: (a: number, b: number, t: number): number => a + (b - a) * t,
  easeOutCubic,
  easeOutBack,
  spring: springEase,
  noise: valueNoise
}

/* ---- 报告类型 ---- */
export interface ValidationIssue {
  level: 'error' | 'warn'
  effect?: string
  message: string
}
export interface ValidationReport {
  ok: boolean // 无 error（warn 不阻断）
  pluginName: string
  effectCount: number
  issues: ValidationIssue[]
  sample: string[] // 首个特效在几个时间点的输出，供肉眼/agent 确认
}

/** 采样参数网格 */
function sampleArgs(): Record<string, number>[] {
  const out: Record<string, number>[] = []
  for (const enterT of [0, 0.3, 0.7, 1]) {
    for (const timeInLine of [0, 200, 800, 1500]) {
      for (const unitIndex of [0, 1, 2]) {
        for (const charIndexInUnit of [0, 1]) {
          out.push({
            unitIndex,
            unitCount: 3,
            charIndexInUnit,
            enterT,
            timeInLine,
            lineDuration: 1500,
            unitStart: 0,
            unitEnd: 400,
            intensity: 1
          })
        }
      }
    }
  }
  return out
}

/** 整行转场采样参数（不同行序/强度/包围盒栈） */
function lineSampleArgs(): Record<string, unknown>[] {
  const blocks = [
    { w: 600, h: 120 },
    { w: 500, h: 120 },
    { w: 700, h: 240 },
    { w: 400, h: 120 },
    { w: 400, h: 120 }
  ]
  const out: Record<string, unknown>[] = []
  for (const lineId of [0, 1, 2]) {
    for (const intensity of [0.5, 1, 1.8]) {
      out.push({ lineId, width: 1080, height: 1920, fontSize: 88, intensity, blocks })
    }
  }
  return out
}

const RANGE: Record<string, [number, number]> = {
  alpha: [0, 1],
  highlight: [0, 1],
  scale: [0, Infinity],
  blur: [0, Infinity],
  glow: [0, Infinity]
}

const BANNED: { re: RegExp; level: 'error' | 'warn'; msg: string }[] = [
  { re: /\bMath\.random\b/, level: 'error', msg: 'Math.random 破坏确定性（预览≠导出）' },
  { re: /\bDate\.now\b|\bnew Date\b/, level: 'error', msg: 'Date 破坏确定性' },
  { re: /\bperformance\.now\b/, level: 'error', msg: 'performance.now 破坏确定性' },
  { re: /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/, level: 'warn', msg: '疑似网络访问（应为纯函数）' },
  { re: /\bdocument\b|\bwindow\b|\blocalStorage\b/, level: 'warn', msg: '疑似访问宿主环境（应为纯函数）' }
]

function fmt(o: Record<string, unknown>): string {
  return Object.entries(o)
    .map(([k, v]) => `${k}=${typeof v === 'number' ? Number(v.toFixed(3)) : String(v)}`)
    .join(' ')
}

/**
 * 去掉注释后再做禁用项扫描，避免把"请勿使用 Math.random"这类文档注释误判为命中。
 * 过度剥离只会让源码扫描漏报——而确定性由"同参两跑"动态兜底，因此偏向剥离是安全的。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** 校验一个插件清单（raw = 默认导出对象；source = 源码文本，用于禁用项扫描） */
export function validatePlugin(raw: unknown, source?: string): ValidationReport {
  const issues: ValidationIssue[] = []
  const err = (message: string, effect?: string): void => void issues.push({ level: 'error', message, effect })
  const warn = (message: string, effect?: string): void => void issues.push({ level: 'warn', message, effect })

  if (!raw || typeof raw !== 'object') {
    err('插件没有默认导出对象')
    return { ok: false, pluginName: '?', effectCount: 0, issues, sample: [] }
  }
  const m = raw as Record<string, unknown>
  if (m.api !== 1) err(`api 版本应为 1，实际 ${String(m.api)}`)
  if (typeof m.name !== 'string' || !m.name) err('缺少 name')
  const effects = Array.isArray(m.textEffects) ? m.textEffects : []
  const lineEffects = Array.isArray(m.lineTransitions) ? m.lineTransitions : []
  if (effects.length === 0 && lineEffects.length === 0) warn('未声明任何 textEffects / lineTransitions')

  const rand = seededRand(12345)
  // 每个采样参数都带确定性 rand（供插件 args.rand 使用）
  const args = sampleArgs().map((a) => ({ ...a, rand }))
  const sample: string[] = []

  effects.forEach((raw, i) => {
    const d = raw as Record<string, unknown>
    const id = typeof d.id === 'string' ? d.id : `#${i}`
    if (typeof d.id !== 'string' || typeof d.name !== 'string' || typeof d.apply !== 'function') {
      err('条目需含 id、name 与 apply', id)
      return
    }
    const apply = d.apply as (a: unknown, m: unknown) => Record<string, number>

    let threw = false
    for (const a of args) {
      let o1: Record<string, number>, o2: Record<string, number>
      try {
        o1 = apply(a, VALIDATOR_HELPERS)
        o2 = apply(a, VALIDATOR_HELPERS)
      } catch (e) {
        if (!threw) err(`apply 抛错：${e instanceof Error ? e.message : String(e)}`, id)
        threw = true
        continue
      }
      // 确定性：同参两次必须一致
      if (JSON.stringify(o1) !== JSON.stringify(o2)) {
        err('apply 非确定性（同参两次输出不同）', id)
        break
      }
      // 范围/有限性
      if (o1 && typeof o1 === 'object') {
        for (const [k, v] of Object.entries(o1)) {
          if (typeof v !== 'number') continue
          if (!Number.isFinite(v)) warn(`字段 ${k} 出现非有限值（宿主会回退恒等）`, id)
          else if (RANGE[k] && (v < RANGE[k][0] || v > RANGE[k][1])) warn(`字段 ${k}=${v} 超出 [${RANGE[k][0]},${RANGE[k][1]}]（宿主会钳制）`, id)
        }
      }
    }

    // 性能：单点紧循环计时
    if (!threw) {
      const a = args[Math.floor(args.length / 2)]
      const N = 5000
      const t0 = performance.now()
      for (let n = 0; n < N; n++) apply(a, VALIDATOR_HELPERS)
      const usPerCall = ((performance.now() - t0) * 1000) / N
      if (usPerCall > 50) warn(`apply 偏慢：约 ${usPerCall.toFixed(1)} µs/次（逐字逐帧调用，建议 < 50）`, id)
    }

    if (i === 0 && !threw) {
      for (const enterT of [0, 0.5, 1]) {
        try {
          const o = apply({ ...args[0], enterT }, VALIDATOR_HELPERS)
          sample.push(`${id} @enterT=${enterT}: ${fmt(o)}`)
        } catch {
          /* 已在上面报错 */
        }
      }
    }
  })

  // 整行停靠式转场：探测 enterFrom + pose(0..maxDepth) 的确定性/范围/不崩
  const lineArgs = lineSampleArgs()
  lineEffects.forEach((raw, i) => {
    const d = raw as Record<string, unknown>
    const id = typeof d.id === 'string' ? d.id : `line#${i}`
    if (typeof d.id !== 'string' || typeof d.name !== 'string' || typeof d.enterFrom !== 'function' || typeof d.pose !== 'function') {
      err('lineTransitions 条目需含 id、name、enterFrom 与 pose', id)
      return
    }
    const enterFrom = d.enterFrom as (a: unknown, m: unknown) => Record<string, number>
    const pose = d.pose as (depth: number, a: unknown, m: unknown) => Record<string, number>
    const maxDepth = Math.min(6, Math.max(0, Math.round(typeof d.maxDepth === 'number' ? d.maxDepth : 1)))
    let threw = false
    for (const a of lineArgs) {
      try {
        const calls: Record<string, number>[][] = [
          [enterFrom(a, VALIDATOR_HELPERS), enterFrom(a, VALIDATOR_HELPERS)]
        ]
        for (let depth = 0; depth <= maxDepth; depth++) {
          calls.push([pose(depth, a, VALIDATOR_HELPERS), pose(depth, a, VALIDATOR_HELPERS)])
        }
        for (const [o1, o2] of calls) {
          if (JSON.stringify(o1) !== JSON.stringify(o2)) {
            err('enterFrom/pose 非确定性（同参两次输出不同）', id)
            threw = true
            break
          }
          if (o1 && typeof o1 === 'object') {
            for (const [k, v] of Object.entries(o1)) {
              if (typeof v !== 'number') continue
              if (!Number.isFinite(v)) warn(`字段 ${k} 出现非有限值（宿主会回退恒等）`, id)
              else if (RANGE[k] && (v < RANGE[k][0] || v > RANGE[k][1])) warn(`字段 ${k}=${v} 超出 [${RANGE[k][0]},${RANGE[k][1]}]（宿主会钳制）`, id)
            }
          }
        }
      } catch (e) {
        if (!threw) err(`enterFrom/pose 抛错：${e instanceof Error ? e.message : String(e)}`, id)
        threw = true
      }
      if (threw) break
    }
    if (i === 0 && !threw) {
      try {
        sample.push(`${id} enterFrom: ${fmt(enterFrom(lineArgs[0], VALIDATOR_HELPERS))}`)
        sample.push(`${id} pose(0): ${fmt(pose(0, lineArgs[0], VALIDATOR_HELPERS))}`)
        sample.push(`${id} pose(1): ${fmt(pose(1, lineArgs[0], VALIDATOR_HELPERS))}`)
      } catch {
        /* 已在上面报错 */
      }
    }
  })

  // 源码扫描（启发式，多为 warn）：先剥离注释，避免文档注释里的"勿用 X"被误判
  if (source) {
    const code = stripComments(source)
    for (const b of BANNED) {
      if (b.re.test(code)) issues.push({ level: b.level, message: `源码命中：${b.msg}` })
    }
  }

  return {
    ok: !issues.some((x) => x.level === 'error'),
    pluginName: typeof m.name === 'string' ? m.name : '?',
    effectCount: effects.length + lineEffects.length,
    issues,
    sample
  }
}
