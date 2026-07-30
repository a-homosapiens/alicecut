import { useEffect, useMemo, useRef, useState } from 'react'
import { allCaptionTracks, useProject } from '../store/project'
import { buildCaptionExport, nonEmptyCaptionTracks, preferredCaptionTrackId } from '../captionExport'
import { useT } from '../i18n'

interface Props {
  onClose(): void
}

export function CaptionExportDialog({ onClose }: Props): React.JSX.Element {
  const t = useT()
  const dialogRef = useRef<HTMLDivElement>(null)
  const lines = useProject((state) => state.lines)
  const meta = useProject((state) => state.meta)
  const lrcName = useProject((state) => state.lrcName)
  const extraTracks = useProject((state) => state.tracks)
  const selectedIds = useProject((state) => state.selectedIds)
  const tracks = useMemo(
    () => nonEmptyCaptionTracks(lines, allCaptionTracks({ meta, lrcName, tracks: extraTracks })),
    [extraTracks, lines, lrcName, meta]
  )
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(() => {
    const state = useProject.getState()
    const available = nonEmptyCaptionTracks(state.lines, allCaptionTracks(state))
    return preferredCaptionTrackId(state.lines, available, state.selectedIds)
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedPath, setSavedPath] = useState('')

  useEffect(() => {
    const selectedRadio = dialogRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')
    const focusTarget = selectedRadio ?? dialogRef.current
    focusTarget?.focus()
  }, [])

  useEffect(() => {
    if (!tracks.some((track) => track.id === selectedTrackId)) {
      setSelectedTrackId(preferredCaptionTrackId(lines, tracks, selectedIds))
    }
  }, [lines, selectedIds, selectedTrackId, tracks])

  const displayName = (trackId: number, name: string, sourceName: string | null): string =>
    name.trim() || sourceName || t(trackId === 0 ? 'tracks.primary' : 'tracks.untitled', { n: trackId })

  const save = async (): Promise<void> => {
    if (selectedTrackId === null) return
    setError('')
    const state = useProject.getState()
    const chosen = allCaptionTracks(state).find((track) => track.id === selectedTrackId)
    if (!chosen) {
      setError(t('captionExport.trackUnavailable'))
      return
    }
    // Read state only after the user confirms. This intentionally exports the
    // edited project lines, not the source subtitle file or a dialog-open snapshot.
    const document = buildCaptionExport(state.lines, chosen, t('app.subtitleDefault'))
    if (!document) {
      setError(t('app.noSubtitles'))
      return
    }
    setSaving(true)
    try {
      const path = await window.desktop.saveSrt(document.srt, document.defaultName)
      if (path) setSavedPath(path)
    } catch (cause) {
      setError(t('captionExport.failed', { message: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={saving ? undefined : onClose}>
      <div
        ref={dialogRef}
        className="modal caption-export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="caption-export-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || saving) return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <h2 id="caption-export-title">{t('captionExport.title')}</h2>
        {savedPath ? (
          <>
            <p>{t('captionExport.done')}</p>
            <p className="hint path">{savedPath}</p>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={onClose}>{t('export.close')}</button>
            </div>
          </>
        ) : (
          <>
            <p className="hint caption-export-hint">{t('captionExport.currentStateHint')}</p>
            <fieldset className="caption-export-tracks" disabled={saving}>
              <legend>{tracks.length > 1 ? t('captionExport.selectTrack') : t('captionExport.track')}</legend>
              {tracks.map((track) => {
                const count = lines.filter(
                  (line) => line.kind !== 'text' && (line.trackId ?? 0) === track.id && line.text.trim().length > 0
                ).length
                const name = displayName(track.id, track.name, track.lrcName)
                return (
                  <label
                    key={track.id}
                    className={`caption-export-track${selectedTrackId === track.id ? ' selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="caption-export-track"
                      value={track.id}
                      checked={selectedTrackId === track.id}
                      onChange={() => setSelectedTrackId(track.id)}
                    />
                    <span className="caption-export-track-info">
                      <span className="caption-export-track-title">
                        {name}
                        {!track.visible && <span className="caption-export-hidden">{t('captionExport.hidden')}</span>}
                      </span>
                      <span className="hint">
                        {t('tracks.lineCount', { n: count })}
                        {track.lrcName && track.lrcName !== name ? ` · ${t('captionExport.source', { name: track.lrcName })}` : ''}
                      </span>
                    </span>
                  </label>
                )
              })}
            </fieldset>
            <p className="hint caption-export-format-note">{t('captionExport.formatNote')}</p>
            {error && <p className="caption-export-error" role="alert">{error}</p>}
            <div className="modal-actions">
              <button className="btn" disabled={saving} onClick={onClose}>{t('export.cancel')}</button>
              <button
                className="btn btn-primary"
                disabled={saving || selectedTrackId === null}
                onClick={() => void save()}
              >
                {saving ? t('captionExport.saving') : t('captionExport.chooseAndExport')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
