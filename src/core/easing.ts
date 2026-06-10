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

/** 确定性随机：同一 (seed, key) 永远返回相同 [0,1) 值，保证逐帧渲染稳定 */
export function seededRand(seed: number): (key: number) => number {
  return (key: number) => {
    let h = (seed * 374761393 + key * 668265263) | 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h = (h ^ (h >>> 16)) >>> 0
    return h / 4294967296
  }
}
