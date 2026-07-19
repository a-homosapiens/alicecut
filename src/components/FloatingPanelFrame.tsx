import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { usePanels } from '../store/panels'
import { useT } from '../i18n'

interface Props {
  panelId: number
  title: string
  children: React.ReactNode
}

/** 通用浮动面板外壳：可拖动标题栏、停靠 + 关闭按钮，portal 到 body 顶层显示 */
export function FloatingPanelFrame({ panelId, title, children }: Props): React.JSX.Element | null {
  const t = useT()
  const panel = usePanels((s) => s.panels[panelId])
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  if (!panel) return null

  const onHeaderMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    usePanels.getState().bringToFront(panelId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: panel.x, originY: panel.y }
    const onMove = (ev: MouseEvent): void => {
      const d = dragRef.current
      if (!d) return
      usePanels.getState().movePanel(panelId, d.originX + (ev.clientX - d.startX), d.originY + (ev.clientY - d.startY))
    }
    const onUp = (): void => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return createPortal(
    <div
      className="float-panel"
      style={{ left: panel.x, top: panel.y, zIndex: 5 + panel.z }}
      onMouseDownCapture={() => usePanels.getState().bringToFront(panelId)}
    >
      <div className="float-panel-head" onMouseDown={onHeaderMouseDown}>
        <span className="float-panel-title">{title}</span>
        <div className="float-panel-actions">
          <button
            className="float-panel-btn"
            title={t('tracks.dock')}
            onClick={() => usePanels.getState().setFloating(panelId, false)}
          >
            ⧉
          </button>
          <button
            className="float-panel-btn"
            title={t('tracks.close')}
            onClick={() => usePanels.getState().closePanel(panelId)}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="float-panel-body">{children}</div>
    </div>,
    document.body
  )
}
