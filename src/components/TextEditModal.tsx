import { useEffect, useRef, useState } from 'react'
import { useProject } from '../store/project'
import { useT } from '../i18n'

/**
 * 编辑单句字幕/独立文字块的文字内容弹窗。时间轴上双击片段打开。
 * 保存走 updateLineText（按新文字重新插值逐字时间，保留原起止区间）；
 * 空内容不写入（避免误清空）。行被删除（如撤销）时自动关闭。
 */
export function TextEditModal({ lineId, onClose }: { lineId: number; onClose: () => void }): React.JSX.Element | null {
  const t = useT()
  const line = useProject((s) => s.lines.find((l) => l.id === lineId))
  const [draft, setDraft] = useState(line?.text ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  // 目标行消失（撤销/删除）时关闭，避免编辑一个不存在的行
  useEffect(() => {
    if (!line) onClose()
  }, [line, onClose])

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  if (!line) return null

  const commit = (): void => {
    const text = draft.trim()
    if (text.length > 0 && text !== line.text) useProject.getState().updateLineText(lineId, text)
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{t('edit.title')}</h2>
        <label>
          {t('edit.label')}
          <input
            ref={inputRef}
            className="text-edit-input"
            value={draft}
            placeholder={t('edit.placeholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 输入框内按键不冒泡到全局快捷键（空格播放、Delete 删行等）
              e.stopPropagation()
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') onClose()
            }}
          />
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('edit.cancel')}
          </button>
          <button className="btn btn-primary" onClick={commit}>
            {t('edit.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
