import { useState } from 'react'
import { useWindows } from '../store/windows'
import { useT } from '../i18n'

interface Props {
  windowId: string
  title: string
  summary?: string
  defaultOpen?: boolean
  children: React.ReactNode
}

/**
 * 可折叠 + 可关闭的区块：标题栏点击展开/收起（跟原来一样），✕ 把整块从视图里彻底移除
 * （标题栏也一起消失，不只是收起内容），在顶栏「窗口」菜单里可以随时恢复。
 * 复用 style-panel 既有的 .sp-* 视觉样式（未额外限定 .style-panel 祖先，样式面板之外也能用）。
 */
export function ClosableSection({ windowId, title, summary, defaultOpen = true, children }: Props): React.JSX.Element | null {
  const t = useT()
  const hidden = useWindows((s) => s.hidden[windowId] ?? false)
  const [open, setOpen] = useState(defaultOpen)

  if (hidden) return null

  return (
    <section className="sp-section">
      <h3 className="sp-head" onClick={() => setOpen((o) => !o)}>
        <span className={`sp-caret${open ? ' open' : ''}`}>▸</span>
        {title}
        <span className="sp-head-actions">
          {!open && summary && <span className="sp-summary">{summary}</span>}
          <button
            className="sp-close"
            title={t('windows.close')}
            onClick={(e) => {
              e.stopPropagation()
              useWindows.getState().hide(windowId)
            }}
          >
            ✕
          </button>
        </span>
      </h3>
      {open && <div className="sp-body">{children}</div>}
    </section>
  )
}
