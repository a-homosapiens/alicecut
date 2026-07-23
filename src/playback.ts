import { useProject, getProjectDuration } from './store/project'
import { pauseAllMedia, syncMediaPlayback } from './mediaPool'

/**
 * 播放控制单例：performance.now 是唯一时钟源；
 * 音/视频媒体线段每帧向时钟对齐（mediaPool.syncMediaPlayback）。
 * 组件只调 play/pause/seek，PreviewCanvas 每帧用 getTime() 取时间渲染。
 */
let clockBase = 0 // 开始播放时的项目时间（秒）
let clockStartedAt = 0 // performance.now() ms

export function getTime(): number {
  const st = useProject.getState()
  if (!st.playing) return st.currentTime
  return clockBase + (performance.now() - clockStartedAt) / 1000
}

export function play(): void {
  const st = useProject.getState()
  const duration = getProjectDuration(st)
  if (duration <= 0) return
  let t = st.currentTime
  if (t >= duration - 0.05) t = 0
  clockBase = t
  clockStartedAt = performance.now()
  st.setPlaying(true)
  // Start media synchronously in the click/keyboard gesture that requested
  // playback. Deferring the first HTMLMediaElement.play() to the next RAF can
  // make Chromium treat it as autoplay and reject audio from opened projects.
  syncMediaPlayback(st.clips, t * 1000, true, duration * 1000)
}

export function pause(): void {
  const st = useProject.getState()
  if (st.playing) st.setCurrentTime(getTime())
  st.setPlaying(false)
  pauseAllMedia()
}

export function toggle(): void {
  if (useProject.getState().playing) pause()
  else play()
}

export function seek(t: number): void {
  const st = useProject.getState()
  const duration = getProjectDuration(st)
  const clamped = Math.max(0, Math.min(t, duration))
  clockBase = clamped
  clockStartedAt = performance.now()
  st.setCurrentTime(clamped)
}

/** 每帧由渲染循环调用：推进时钟、同步媒体元素、到尾自动停 */
export function tick(): void {
  const st = useProject.getState()
  const duration = getProjectDuration(st)
  let t = getTime()
  if (st.playing) {
    if (t >= duration) {
      t = duration
      st.setPlaying(false)
      st.setCurrentTime(duration)
      pauseAllMedia()
    } else {
      st.setCurrentTime(t)
    }
  }
  syncMediaPlayback(st.clips, t * 1000, useProject.getState().playing, duration * 1000)
}
