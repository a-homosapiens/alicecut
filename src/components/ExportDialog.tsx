import { useRef, useState } from 'react'
import { useProject, toRenderStyle, getProjectDuration } from '../store/project'
import { runExport } from '../exportRunner'
import { pause } from '../playback'

interface Props {
  onClose: () => void
}

type Phase = 'idle' | 'rendering' | 'done' | 'error'

export function ExportDialog({ onClose }: Props): React.JSX.Element {
  const [fps, setFps] = useState(30)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const cancelRef = useRef(false)

  const st = useProject.getState()
  const duration = getProjectDuration(st)

  const start = async (): Promise<void> => {
    const state = useProject.getState()
    const style = toRenderStyle(state.style)
    const baseName = (state.lrcName ?? 'lyrics').replace(/\.[^.]+$/, '')
    const outPath = await window.desktop.saveVideoPath(`${baseName}.mp4`)
    if (!outPath) return

    pause()
    state.setExporting(true)
    cancelRef.current = false
    setPhase('rendering')
    setProgress(0)

    try {
      const result = await runExport({
        lines: state.lines,
        meta: state.meta,
        style,
        clips: state.clips,
        fps,
        durationSec: duration,
        outPath,
        onProgress: setProgress,
        isCancelled: () => cancelRef.current
      })
      if (result.cancelled) {
        setPhase('idle')
        setProgress(0)
      } else if (result.code === 0) {
        setPhase('done')
        setMessage(outPath)
      } else {
        setPhase('error')
        setMessage(`FFmpeg 退出码 ${result.code}\n${result.log.slice(-600)}`)
      }
    } catch (err) {
      setPhase('error')
      setMessage(String(err))
    } finally {
      state.setExporting(false)
    }
  }

  const rendering = phase === 'rendering'

  return (
    <div className="modal-backdrop" onClick={rendering ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>导出视频</h2>

        {phase === 'idle' && (
          <>
            <label>
              帧率
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                <option value={30}>30 fps（推荐）</option>
                <option value={60}>60 fps</option>
              </select>
            </label>
            <p className="hint">
              时长约 {Math.round(duration)} 秒 · H.264 MP4
              {st.clips.some((c) => c.kind === 'video') ? ' · 含背景视频' : ''}
              {st.clips.some((c) => c.kind === 'audio') ? ' · 含音轨' : ' · 无音频（未导入音频文件）'}
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                取消
              </button>
              <button className="btn btn-primary" onClick={() => void start()}>
                选择保存位置并导出
              </button>
            </div>
          </>
        )}

        {rendering && (
          <>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${(progress * 100).toFixed(1)}%` }} />
            </div>
            <p className="hint">{(progress * 100).toFixed(0)}% — 逐帧渲染编码中…</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => (cancelRef.current = true)}>
                取消导出
              </button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <p>✅ 导出完成：</p>
            <p className="hint path">{message}</p>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={onClose}>
                关闭
              </button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <p>❌ 导出失败</p>
            <pre className="hint error-log">{message}</pre>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                关闭
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
