import { useRef, useState } from 'react'
import { useProject, toRenderStyle, getProjectDuration, allCaptionTracks } from '../store/project'
import { runExport } from '../exportRunner'
import { pause } from '../playback'
import { useT } from '../i18n'
import {
  outExtension,
  type Container,
  type Codec,
  type Speed,
  type HwAccel,
  type EncodeSettings,
  type VideoFrameMode
} from '../../electron/exporterCore'

interface Props {
  onClose: () => void
}

type Phase = 'idle' | 'rendering' | 'done' | 'error'

export function ExportDialog({ onClose }: Props): React.JSX.Element {
  const t = useT()
  const [fps, setFps] = useState(30)
  const [container, setContainer] = useState<Container>('mp4')
  const [codec, setCodec] = useState<Codec>('h264')
  const [speed, setSpeed] = useState<Speed>('balanced')
  const [hwAccel, setHwAccel] = useState<HwAccel>('auto')
  const [videoFrameMode, setVideoFrameMode] = useState<VideoFrameMode>('fast')
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const cancelRef = useRef(false)

  const st = useProject.getState()
  const duration = getProjectDuration(st)
  const [durationInput, setDurationInput] = useState(duration > 0 ? duration : 5)

  // ProRes 只装 .mov：容器选择在此静默解析+改标签，不是错误(不同于 CLI 的硬校验——
  // GUI 用户没有手动敲扩展名，保存对话框直接给对的就行)
  const encode: EncodeSettings = { container, codec, speed, hwAccel }
  const effectiveExt = outExtension(encode)

  const start = async (): Promise<void> => {
    const state = useProject.getState()
    if (!Number.isFinite(durationInput) || durationInput <= 0) {
      setPhase('error')
      setMessage('Export duration must be greater than zero.')
      return
    }
    if (state.clips.some((clip) => clip.offline) && !confirm('Some media is offline and will be omitted from the export. Continue?')) return
    const style = toRenderStyle(state.style)
    const baseName = (state.lrcName ?? 'lyrics').replace(/\.[^.]+$/, '')
    const outPath = await window.desktop.saveVideoPath(`${baseName}.${effectiveExt}`, effectiveExt)
    if (!outPath) return
    state.setProjectDurationSec(durationInput)

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
        tracks: allCaptionTracks(state),
        clips: state.clips,
        fps,
        durationSec: durationInput,
        outPath,
        encode,
        videoFrameMode,
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
            <label>
              Duration (seconds)
              <input
                type="number"
                min={0.1}
                max={86400}
                step={0.1}
                value={durationInput}
                onChange={(e) => setDurationInput(Number(e.target.value))}
              />
            </label>
            <label>
              {t('export.codec')}
              <select value={codec} onChange={(e) => setCodec(e.target.value as Codec)}>
                <option value="h264">{t('export.codecH264')}</option>
                <option value="hevc">{t('export.codecHevc')}</option>
                <option value="prores">{t('export.codecProres')}</option>
              </select>
            </label>
            <label>
              {t('export.container')}
              <select
                value={effectiveExt}
                disabled={codec === 'prores'}
                onChange={(e) => setContainer(e.target.value as Container)}
              >
                <option value="mp4">MP4</option>
                <option value="mov">MOV</option>
              </select>
            </label>
            <label>
              {t('export.speed')}
              <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}>
                <option value="fast">{t('export.speedFast')}</option>
                <option value="balanced">{t('export.speedBalanced')}</option>
                <option value="quality">{t('export.speedQuality')}</option>
              </select>
            </label>
            <label className="row">
              {t('export.hwAccel')}
              <input
                type="checkbox"
                checked={hwAccel === 'auto'}
                onChange={(e) => setHwAccel(e.target.checked ? 'auto' : 'software')}
              />
            </label>
            <p className="hint">{t('export.hwAccelHint')}</p>
            {st.clips.some((c) => c.kind === 'video') && (
              <>
                <label className="row">
                  {t('export.videoFrameExact')}
                  <input
                    type="checkbox"
                    checked={videoFrameMode === 'exact'}
                    onChange={(e) => setVideoFrameMode(e.target.checked ? 'exact' : 'fast')}
                  />
                </label>
                <p className="hint">{t('export.videoFrameModeHint')}</p>
              </>
            )}
            <p className="hint">
              {t('export.duration', { n: Math.round(durationInput) })}
              {' · '}
              {effectiveExt.toUpperCase()}
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
