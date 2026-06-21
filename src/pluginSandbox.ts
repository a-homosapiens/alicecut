/**
 * 插件硬隔离探针（导入期闸门）。
 *
 * 现状回顾：渲染热路径是**同步**的（每帧每字调用 apply），所以无法用异步的 Worker
 * 直接为渲染做隔离。真正的同步逐帧隔离需要 QuickJS-WASM（同步 in-process isolate），
 * 那是下一步。本模块做的是**导入期闸门**：在注册前，把不受信插件放进一个
 * 全局被遮蔽（Date/Math.random/performance/fetch… 不可用）、带硬超时的 Worker 里
 * 跑一遍样本网格——一次性批量评估（"batched per-line evaluation"），用来抓死循环、
 * 越界/非有限输出、非确定性、以及访问被禁全局的行为。通过闸门后才在主世界导入使用。
 *
 * Worker 不可用时（node/vitest/headless）抛 SandboxUnavailableError，调用方降级到
 * 同步校验器（src/core/effects/validator.ts）。determinism 由"同参两跑比对"保证，
 * 与渲染世界无关，因此降级仍安全。
 */

export class SandboxUnavailableError extends Error {
  constructor(msg = 'Worker 沙箱不可用') {
    super(msg)
    this.name = 'SandboxUnavailableError'
  }
}

export interface ProbeIssue {
  level: 'error' | 'warn'
  effect?: string
  message: string
}
export interface ProbeReport {
  ok: boolean
  issues: ProbeIssue[]
}

/** Worker 回传的单个特效原始结果：两跑输出（已序列化为普通对象）或错误 */
export interface RawEffectProbe {
  id: string
  runA?: (Record<string, number> | null)[]
  runB?: (Record<string, number> | null)[]
  error?: string
}

const RANGE: Record<string, [number, number]> = {
  alpha: [0, 1],
  highlight: [0, 1],
  scale: [0, Infinity],
  blur: [0, Infinity],
  glow: [0, Infinity]
}

/**
 * 纯函数：把 Worker 回传的原始两跑结果分析成报告。
 * 抛错 / 非确定性 → error（拒绝导入）；越界/非有限 → warn（宿主会钳制）。
 * 单独导出以便单测，不依赖真实 Worker。
 */
export function analyzeProbe(perEffect: RawEffectProbe[]): ProbeReport {
  const issues: ProbeIssue[] = []
  if (perEffect.length === 0) issues.push({ level: 'warn', message: '插件未声明任何 textEffects' })
  for (const e of perEffect) {
    if (e.error) {
      issues.push({ level: 'error', effect: e.id, message: `apply 在隔离环境抛错：${e.error}` })
      continue
    }
    const a = e.runA ?? []
    const b = e.runB ?? []
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      issues.push({ level: 'error', effect: e.id, message: 'apply 非确定性（同参两跑输出不同）' })
      continue
    }
    for (const out of a) {
      if (!out) continue
      for (const [k, v] of Object.entries(out)) {
        if (typeof v !== 'number') continue
        if (!Number.isFinite(v)) issues.push({ level: 'warn', effect: e.id, message: `字段 ${k} 非有限值（宿主回退恒等）` })
        else if (RANGE[k] && (v < RANGE[k][0] || v > RANGE[k][1])) issues.push({ level: 'warn', effect: e.id, message: `字段 ${k}=${v} 越界（宿主会钳制）` })
      }
    }
  }
  return { ok: !issues.some((i) => i.level === 'error'), issues }
}

/** Worker 驱动源码（模块 worker）：遮蔽全局 → 导入插件 → 样本网格两跑 → 回传原始结果 */
const WORKER_SOURCE = String.raw`
// ---- 遮蔽危险全局（在导入插件之前）----
const BAN = ['fetch','XMLHttpRequest','WebSocket','importScripts','indexedDB','caches']
for (const n of BAN) { try { globalThis[n] = undefined } catch (e) {} }
// 确定性：禁掉时间/随机源（插件用了就抛错 → 被判不合格）
try { globalThis.Date = function(){ throw new Error('Date 被禁用') } } catch(e){}
try { Math.random = function(){ throw new Error('Math.random 被禁用') } } catch(e){}
try { globalThis.performance = undefined } catch(e){}

// ---- 纯工具（与 easing.ts 对齐）----
const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
const easeOutBack = (t) => { const c1=1.70158; return 1 + (c1+1)*Math.pow(t-1,3) + c1*Math.pow(t-1,2) }
const springEase = (t) => t<=0?0:t>=1?1:1 - Math.exp(-6*t)*Math.cos(9*t)
const seededRand = (seed) => (key) => { let h=(seed*374761393+key*668265263)|0; h=Math.imul(h^(h>>>13),1274126177); h=(h^(h>>>16))>>>0; return h/4294967296 }
const valueNoise = (seed,x) => { const r=seededRand(seed); const xi=Math.floor(x), xf=x-xi; const a=r(xi)*2-1,b=r(xi+1)*2-1; return a+(b-a)*(xf*xf*(3-2*xf)) }
const HELPERS = { clamp01, lerp:(a,b,t)=>a+(b-a)*t, easeOutCubic, easeOutBack, spring:springEase, noise:valueNoise }

function grid(){
  const out=[]
  for (const enterT of [0,0.3,0.7,1])
    for (const timeInLine of [0,200,800,1500])
      for (const unitIndex of [0,1,2])
        for (const charIndexInUnit of [0,1])
          out.push({ unitIndex, unitCount:3, charIndexInUnit, enterT, timeInLine, lineDuration:1500, unitStart:0, unitEnd:400, intensity:1 })
  return out
}

self.onmessage = async (ev) => {
  const source = ev.data && ev.data.source
  let mod
  try {
    mod = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(source))
  } catch (e) {
    self.postMessage({ type:'fatal', message:'插件无法作为模块加载：' + (e && e.message || e) }); return
  }
  const manifest = mod && mod.default
  const pick = (r) => { if (!r || typeof r !== 'object') return null; const o = {}; for (const k in r) if (typeof r[k] === 'number') o[k] = r[k]; return o }
  const perEffect = []

  // 文字特效：apply 在样本网格上两跑
  const effects = manifest && Array.isArray(manifest.textEffects) ? manifest.textEffects : []
  const samples = grid()
  for (const def of effects) {
    const id = def && def.id || '?'
    if (!def || typeof def.apply !== 'function') { perEffect.push({ id, error:'缺少 apply 函数' }); continue }
    const runOnce = () => samples.map((s) => pick(def.apply(Object.assign({ rand: seededRand(12345) }, s), HELPERS)))
    try { perEffect.push({ id, runA: runOnce(), runB: runOnce() }) }
    catch (e) { perEffect.push({ id, error: (e && e.message) || String(e) }) }
  }

  // 整行转场：enterFrom + pose(0..maxDepth) 在样本网格上两跑
  const lineDefs = manifest && Array.isArray(manifest.lineTransitions) ? manifest.lineTransitions : []
  const lblocks = [{w:600,h:120},{w:500,h:120},{w:700,h:240},{w:400,h:120},{w:400,h:120}]
  const lsamples = []
  for (const lineId of [0,1,2]) for (const intensity of [0.5,1,1.8]) lsamples.push({ lineId, width:1080, height:1920, fontSize:88, intensity, blocks:lblocks })
  for (const def of lineDefs) {
    const id = def && def.id || '?'
    if (!def || typeof def.enterFrom !== 'function' || typeof def.pose !== 'function') { perEffect.push({ id, error:'缺少 enterFrom/pose' }); continue }
    const maxDepth = Math.min(6, Math.max(0, Math.round(typeof def.maxDepth === 'number' ? def.maxDepth : 1)))
    const runOnce = () => {
      const arr = []
      for (const s of lsamples) {
        arr.push(pick(def.enterFrom(s, HELPERS)))
        for (let depth = 0; depth <= maxDepth; depth++) arr.push(pick(def.pose(depth, s, HELPERS)))
      }
      return arr
    }
    try { perEffect.push({ id, runA: runOnce(), runB: runOnce() }) }
    catch (e) { perEffect.push({ id, error: (e && e.message) || String(e) }) }
  }

  // 视频转场：in/out 在进度网格上两跑
  const vtDefs = manifest && Array.isArray(manifest.videoTransitions) ? manifest.videoTransitions : []
  const pGrid = [0, 0.25, 0.5, 0.75, 1]
  for (const def of vtDefs) {
    const id = def && def.id || '?'
    if (!def || typeof def.in !== 'function' || typeof def.out !== 'function') { perEffect.push({ id, error:'缺少 in/out' }); continue }
    const runOnce = () => { const arr = []; for (const fn of [def.in, def.out]) for (const p of pGrid) arr.push(pick(fn(p, HELPERS))); return arr }
    try { perEffect.push({ id, runA: runOnce(), runB: runOnce() }) }
    catch (e) { perEffect.push({ id, error: (e && e.message) || String(e) }) }
  }

  self.postMessage({ type:'result', perEffect })
}
`

/**
 * 在隔离 Worker 中探测插件源码；超时即判死循环并终止。
 * @throws SandboxUnavailableError 当环境无 Worker/URL（node/vitest/headless）
 */
export function probePluginInWorker(source: string, timeoutMs = 2000): Promise<ProbeReport> {
  if (typeof Worker === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.reject(new SandboxUnavailableError())
  }
  return new Promise<ProbeReport>((resolve, reject) => {
    let url: string | null = null
    let worker: Worker | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      if (worker) worker.terminate()
      if (url) URL.revokeObjectURL(url)
    }
    try {
      url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
      worker = new Worker(url, { type: 'module' })
    } catch {
      cleanup()
      reject(new SandboxUnavailableError('无法创建 Worker'))
      return
    }
    timer = setTimeout(() => {
      cleanup()
      reject(new Error('插件执行超时（疑似死循环），已终止'))
    }, timeoutMs)
    worker.onmessage = (ev: MessageEvent): void => {
      const d = ev.data
      cleanup()
      if (d && d.type === 'fatal') reject(new Error(d.message))
      else if (d && d.type === 'result') resolve(analyzeProbe(d.perEffect as RawEffectProbe[]))
      else reject(new Error('Worker 返回未知结果'))
    }
    worker.onerror = (e: ErrorEvent): void => {
      cleanup()
      // Worker 自身脚本出错（环境问题）→ 视为不可用，调用方降级
      reject(new SandboxUnavailableError('Worker 运行出错：' + (e.message || 'unknown')))
    }
    worker.postMessage({ source })
  })
}
