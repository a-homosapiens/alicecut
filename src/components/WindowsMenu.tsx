import { useState } from 'react'
import { useWindows, WINDOW_REGISTRY } from '../store/windows'
import { useT } from '../i18n'

/** 顶栏「窗口」菜单：勾选列出全部可关闭面板/区块，点一下切换显示/隐藏；恢复被关闭项的唯一入口 */
export function WindowsMenu(): React.JSX.Element {
  const t = useT()
  const hidden = useWindows((s) => s.hidden)
  const [open, setOpen] = useState(false)
  const hiddenCount = WINDOW_REGISTRY.filter((w) => hidden[w.id]).length

  return (
    <span className="lang-menu">
      <button className="btn" onClick={() => setOpen((o) => !o)} title={t('windows.title')}>
        {t('windows.title')}
        {hiddenCount > 0 ? ` (${hiddenCount})` : ''} ▾
      </button>
      {open && (
        <div className="lang-dropdown">
          {WINDOW_REGISTRY.map((w) => (
            <button key={w.id} onClick={() => useWindows.getState().toggle(w.id)}>
              {!hidden[w.id] ? '✓ ' : ''}
              {t(w.labelKey as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
