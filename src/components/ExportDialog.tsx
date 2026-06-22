import { useRef, useState } from 'react'
import { useProject, toRenderStyle, getProjectDuration } from '../store/project'
import { runExport } from '../exportRunner'
import { pause } from '../playback'
import { useT } from '../i18n'

interface Props {
  onClose: () => void
}

type Phase = 'idle' | 'rendering' | 'done' | 'error'

export function ExportDialog({ onClose }: Props): React.JSX.Element {
  const t = useT()
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
        setMessage(`${t('export.ffmpegExit', { code: result.code })}\n${result.log.slice(-600)}`)
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
        <h2>{t('export.title')}</h2>

        {phase === 'idle' && (
          <>
            <label>
              {t('export.fps')}
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                <option value={30}>{t('export.fps30')}</option>
                <option value={60}>60 fps</option>
              </select>
            </label>
            <p className="hint">
              {t('export.duration', { n: Math.round(duration) })}
              {st.clips.some((c) => c.kind === 'video') ? t('export.withVideo') : ''}
              {st.clips.some((c) => c.kind === 'audio') ? t('export.withAudio') : t('export.noAudio')}
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                {t('export.cancel')}
              </button>
              <button className="btn btn-primary" onClick={() => void start()}>
                {t('export.chooseAndExport')}
              </button>
            </div>
          </>
        )}

        {rendering && (
          <>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${(progress * 100).toFixed(1)}%` }} />
            </div>
            <p className="hint">{(progress * 100).toFixed(0)}% — {t('export.encoding')}</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => (cancelRef.current = true)}>
                {t('export.cancelExport')}
              </button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <p>{t('export.done')}</p>
            <p className="hint path">{message}</p>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={onClose}>
                {t('export.close')}
              </button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <p>{t('export.failed')}</p>
            <pre className="hint error-log">{message}</pre>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                {t('export.close')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
