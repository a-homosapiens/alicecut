import { useEffect, useState } from 'react'
import { mediaUrl } from './mediaPool'

/**
 * 音频波形峰值：把整段音频降采样成 RES 个桶的归一化峰值（0..1），
 * 供时间轴选中音轨时画波形。按路径缓存，首次异步解码（Web Audio）。
 */
const RES = 2000
const cache = new Map<string, number[]>()
const pending = new Map<string, Promise<number[]>>()

async function decodePeaks(path: string): Promise<number[]> {
  const res = await fetch(mediaUrl(path))
  if (!res.ok) throw new Error(`Waveform media request failed: HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  const actx = new AudioContext()
  try {
    const audio = await actx.decodeAudioData(buf)
    const ch = audio.getChannelData(0) // 取首声道近似
    const block = Math.max(1, Math.floor(ch.length / RES))
    const peaks: number[] = []
    let max = 0
    for (let i = 0; i < RES; i++) {
      let m = 0
      const s = i * block
      const e = Math.min(ch.length, s + block)
      for (let j = s; j < e; j++) {
        const a = Math.abs(ch[j])
        if (a > m) m = a
      }
      peaks.push(m)
      if (m > max) max = m
    }
    if (max > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= max
    return peaks
  } finally {
    void actx.close()
  }
}

/** 取某音频文件的波形峰值；未就绪返回 null（解码完成后触发重渲染） */
export function useWaveform(path: string): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(() => cache.get(path) ?? null)
  useEffect(() => {
    const cached = cache.get(path)
    if (cached) {
      setPeaks(cached)
      return
    }
    setPeaks(null)
    let alive = true
    let p = pending.get(path)
    if (!p) {
      p = decodePeaks(path).then((v) => {
        cache.set(path, v)
        pending.delete(path)
        return v
      })
      p.catch(() => pending.delete(path))
      pending.set(path, p)
    }
    p.then((v) => alive && setPeaks(v)).catch((error: unknown) => {
      console.error(`Waveform decode failed for ${path}`, error)
      if (alive) setPeaks(null)
    })
    return () => {
      alive = false
    }
  }, [path])
  return peaks
}
