import { useState } from 'react'
import { useProject } from '../store/project'
import { repaginateLines } from '../core/subtitles'
import { seek } from '../playback'
import { useT } from '../i18n'

function fmt(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

interface Props {
  trackId: number
}

/**
 * 一个字幕组的内容：歌词行列表（点击跳转、双击编辑文本）、分页粒度、导入/改名/删除、
 * 竖直位置与可见性（id 0 主字幕组没有这些，位置固定居中、不可删除/隐藏）。
 * 由 TrackList 决定把它渲染在停靠栏里还是 FloatingPanelFrame 内。
 */
export function CaptionTrackPanel({ trackId }: Props): React.JSX.Element | null {
  const t = useT()
  const lines = useProject((s) => s.lines)
  const currentTime = useProject((s) => s.currentTime)
  const tracksArr = useProject((s) => s.tracks)
  const primaryLrcName = useProject((s) => s.lrcName)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [gran, setGran] = useState(1200)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const extra = trackId === 0 ? null : tracksArr.find((tr) => tr.id === trackId)
  if (trackId !== 0 && !extra) return null // 字幕组已被删除但面板还没关

  const name = trackId === 0 ? '' : extra!.name
  const lrcName = trackId === 0 ? primaryLrcName : extra!.lrcName
  const offsetY = trackId === 0 ? 0 : extra!.offsetY
  const visible = trackId === 0 ? true : extra!.visible
  const displayName = name || t(trackId === 0 ? 'tracks.primary' : 'tracks.untitled', { n: trackId })

  const trackLines = lines.filter((l) => l.kind !== 'text' && (l.trackId ?? 0) === trackId)
  const tMs = currentTime * 1000
  const activeId = trackLines.findLast((l) => l.start <= tMs)?.id
  const previewPages = repaginateLines(trackLines, gran).length

  const commitText = (id: number): void => {
    if (draft.trim().length > 0) useProject.getState().updateLineText(id, draft)
    setEditingId(null)
  }

  const commitName = (): void => {
    useProject.getState().renameTrack(trackId, nameDraft.trim())
    setRenaming(false)
  }

  const importLrc = async (): Promise<void> => {
    const file = await window.desktop.openLrc()
    if (!file) return
    useProject.getState().loadLrcToTrack(trackId, file.text, file.name)
  }

  return (
    <div className="track-panel-body">
      {trackId !== 0 &&
        (renaming ? (
          <input
            autoFocus
            className="track-rename-input"
            value={nameDraft}
            placeholder={t('tracks.renamePlaceholder')}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <div
            className="track-rename"
            onDoubleClick={() => {
              setNameDraft(name)
              setRenaming(true)
            }}
            title={t('tracks.renamePlaceholder')}
          >
            {displayName}
          </div>
        ))}

      {lrcName && <p className="hint path">{lrcName}</p>}

      <button className="btn btn-sm" onClick={() => void importLrc()}>
        {t('tracks.importInto')}
      </button>

      {trackLines.length > 0 && (
        <>
          <button className="btn btn-sm" onClick={() => useProject.getState().setSelection(trackLines.map((l) => l.id))}>
            {t('tracks.selectAll')} ({trackLines.length})
          </button>
          <p className="hint">{t('tracks.selectAllHint')}</p>
        </>
      )}

      {trackId !== 0 && (
        <div className="track-panel-offset">
          <label>
            {t('tracks.offsetY')} {offsetY}px
            <input
              type="range"
              min={-800}
              max={800}
              value={offsetY}
              onChange={(e) => useProject.getState().setTrackOffsetY(trackId, Number(e.target.value))}
            />
          </label>
          <p className="hint">{t('tracks.offsetHint')}</p>
          <label className="row">
            {t('tracks.visibleLabel')}
            <input
              type="checkbox"
              checked={visible}
              onChange={(e) => useProject.getState().setTrackVisible(trackId, e.target.checked)}
            />
          </label>
          <button className="btn btn-sm" onClick={() => useProject.getState().removeTrack(trackId)}>
            {t('tracks.deleteTrack')}
          </button>
        </div>
      )}

      {trackLines.length === 0 ? (
        <p className="hint">
          {t('lyrics.empty1')}
          <br />
          {t('tracks.emptyHint')}
        </p>
      ) : (
        <>
          <div className="repaginate">
            <div className="repaginate-row">
              <span className="repaginate-label">{t('lyrics.granularity')}</span>
              <span className="repaginate-count">{t('lyrics.pages', { n: previewPages })}</span>
            </div>
            <input
              type="range"
              min={200}
              max={4000}
              step={100}
              value={gran}
              onChange={(e) => setGran(Number(e.target.value))}
            />
            <div className="repaginate-row repaginate-ends">
              <span>{t('lyrics.perWord')}</span>
              <button className="btn btn-sm" onClick={() => useProject.getState().repaginate(trackId, gran)}>
                {t('lyrics.applyPaging')}
              </button>
              <span>{t('lyrics.perLine')}</span>
            </div>
          </div>
          {trackLines.map((line) => (
            <div
              key={line.id}
              className={`lyric-row${line.id === activeId ? ' active' : ''}`}
              onClick={() => {
                useProject.getState().setSelection([line.id])
                seek(line.start / 1000)
              }}
              onDoubleClick={() => {
                setEditingId(line.id)
                setDraft(line.text)
              }}
            >
              <span className="ts">{fmt(line.start)}</span>
              {editingId === line.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitText(line.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitText(line.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="txt">{line.text || t('tl.interlude')}</span>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
