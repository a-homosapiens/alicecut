export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

export function easeInQuad(t: number): number {
  return t * t
}

export function easeInCubic(t: number): number {
  return t * t * t
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

/** 带过冲回弹，落点 1.0，峰值约 1.1 */
export function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/**
 * 欠阻尼弹簧缓动：t∈[0,1]，0→1 之间带回弹振荡后归位（峰值约 1.12）。
 * 比 easeOutBack 多几次衰减振荡，更「弹」。确定性、纯函数。
 */
export function springEase(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return 1 - Math.exp(-6 * t) * Math.cos(9 * t)
}

/**
 * 平滑值噪声：同一 seed 下关于 x 连续平滑的 [-1,1] 噪声（整数处取随机、
 * smoothstep 插值）。用于有机的飘摆/抖动，逐帧稳定。
 */
export function valueNoise(seed: number, x: number): number {
  const rand = seededRand(seed)
  const xi = Math.floor(x)
  const xf = x - xi
  const a = rand(xi) * 2 - 1
  const b = rand(xi + 1) * 2 - 1
  const u = xf * xf * (3 - 2 * xf)
  return a + (b - a) * u
}

/** 确定性随机：同一 (seed, key) 永远返回相同 [0,1) 值，保证逐帧渲染稳定 */
export function seededRand(seed: number): (key: number) => number {
  return (key: number) => {
    let h = (seed * 374761393 + key * 668265263) | 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h = (h ^ (h >>> 16)) >>> 0
    return h / 4294967296
  }
}
