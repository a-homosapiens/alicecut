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

/** 歌词行列表：点击跳转、双击编辑文本；顶部可按粒度重新分页 */
export function LyricsPanel(): React.JSX.Element {
  const t = useT()
  const lines = useProject((s) => s.lines)
  const currentTime = useProject((s) => s.currentTime)
  const updateLineText = useProject((s) => s.updateLineText)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [gran, setGran] = useState(1200)

  const tMs = currentTime * 1000
  const activeId = lines.findLast((l) => l.start <= tMs)?.id

  // 应用前预览：当前粒度会切成多少页（不改动状态）
  const lyricLines = lines.filter((l) => l.kind !== 'text')
  const previewPages = repaginateLines(lyricLines, gran).length

  const commit = (id: number): void => {
    if (draft.trim().length > 0) updateLineText(id, draft)
    setEditingId(null)
  }

  if (lines.length === 0) {
    return (
      <div className="lyrics-panel empty">
        <p>
          {t('lyrics.empty1')}
          <br />
          {t('lyrics.empty2')}
        </p>
      </div>
    )
  }

  return (
    <div className="lyrics-panel">
      {lyricLines.length > 0 && (
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
            <button className="btn btn-sm" onClick={() => useProject.getState().repaginate(gran)}>
              {t('lyrics.applyPaging')}
            </button>
            <span>{t('lyrics.perLine')}</span>
          </div>
        </div>
      )}
      {lines.map((line) => (
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
              onBlur={() => commit(line.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(line.id)
                if (e.key === 'Escape') setEditingId(null)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="txt">{line.text || t('tl.interlude')}</span>
          )}
        </div>
      ))}
    </div>
  )
}
