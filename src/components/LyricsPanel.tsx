import { useState } from 'react'
import { useProject } from '../store/project'
import { seek } from '../playback'

function fmt(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 歌词行列表：点击跳转、双击编辑文本 */
export function LyricsPanel(): React.JSX.Element {
  const lines = useProject((s) => s.lines)
  const currentTime = useProject((s) => s.currentTime)
  const updateLineText = useProject((s) => s.updateLineText)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  const tMs = currentTime * 1000
  const activeId = lines.findLast((l) => l.start <= tMs)?.id

  const commit = (id: number): void => {
    if (draft.trim().length > 0) updateLineText(id, draft)
    setEditingId(null)
  }

  if (lines.length === 0) {
    return (
      <div className="lyrics-panel empty">
        <p>
          尚未导入歌词
          <br />
          点击上方「导入歌词」选择 .lrc 文件
        </p>
      </div>
    )
  }

  return (
    <div className="lyrics-panel">
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
            <span className="txt">{line.text || '（间奏）'}</span>
          )}
        </div>
      ))}
    </div>
  )
}
