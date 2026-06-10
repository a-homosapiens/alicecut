import { useProject, getProjectDuration } from './store/project'

/**
 * 播放控制单例：音频元素是时钟源；无音频时用 performance.now 推进。
 * 组件只调 play/pause/seek，PreviewCanvas 每帧用 getTime() 取时间渲染。
 */
const audio = new Audio()
audio.preload = 'auto'

let clockBase = 0 // 无音频时：开始播放时的项目时间（秒）
let clockStartedAt = 0 // performance.now() ms

audio.addEventListener('ended', () => {
  useProject.getState().setPlaying(false)
})

export function setAudioSource(url: string | null): Promise<number> {
  return new Promise((resolve) => {
    if (!url) {
      audio.removeAttribute('src')
      audio.load()
      resolve(0)
      return
    }
    audio.src = url
    audio.addEventListener(
      'loadedmetadata',
      () => resolve(isFinite(audio.duration) ? audio.duration : 0),
      { once: true }
    )
    audio.load()
  })
}

function hasAudio(): boolean {
  return audio.src !== ''
}

export function getTime(): number {
  const st = useProject.getState()
  if (hasAudio()) return audio.currentTime
  if (!st.playing) return st.currentTime
  return clockBase + (performance.now() - clockStartedAt) / 1000
}

export function play(): void {
  const st = useProject.getState()
  const duration = getProjectDuration(st)
  if (duration <= 0) return
  let t = st.currentTime
  if (t >= duration - 0.05) t = 0
  if (hasAudio()) {
    audio.currentTime = t
    void audio.play()
  } else {
    clockBase = t
    clockStartedAt = performance.now()
  }
  st.setPlaying(true)
}

export function pause(): void {
  const st = useProject.getState()
  if (hasAudio()) audio.pause()
  else st.setCurrentTime(getTime())
  st.setPlaying(false)
}

export function toggle(): void {
  if (useProject.getState().playing) pause()
  else play()
}

export function seek(t: number): void {
  const st = useProject.getState()
  const duration = getProjectDuration(st)
  const clamped = Math.max(0, Math.min(t, duration))
  if (hasAudio()) audio.currentTime = clamped
  else {
    clockBase = clamped
    clockStartedAt = performance.now()
  }
  st.setCurrentTime(clamped)
}

/** 无音频播放时由渲染循环调用：到尾自动停 */
export function tick(): void {
  const st = useProject.getState()
  if (!st.playing) return
  const t = getTime()
  const duration = getProjectDuration(st)
  if (t >= duration) {
    pause()
    st.setCurrentTime(duration)
  } else {
    st.setCurrentTime(t)
  }
}
