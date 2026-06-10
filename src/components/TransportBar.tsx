import { useProject, getProjectDuration } from '../store/project'
import { toggle, seek } from '../playback'

function fmt(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function TransportBar(): React.JSX.Element {
  const playing = useProject((s) => s.playing)
  const currentTime = useProject((s) => s.currentTime)
  const lines = useProject((s) => s.lines)
  const audio = useProject((s) => s.audio)
  const duration = getProjectDuration({ lines, audio })
  const disabled = duration <= 0

  return (
    <div className="transport">
      <button className="btn btn-play" onClick={toggle} disabled={disabled} title="空格键播放/暂停">
        {playing ? '⏸' : '▶'}
      </button>
      <span className="time">{fmt(currentTime)}</span>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 0.01)}
        step={0.01}
        value={Math.min(currentTime, duration)}
        disabled={disabled}
        onChange={(e) => seek(Number(e.target.value))}
      />
      <span className="time">{fmt(duration)}</span>
    </div>
  )
}
