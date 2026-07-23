import { useState } from 'react'
import { useProject } from '../store/project'
import { useT, availableLanguages } from '../i18n'
import { parseLanguagePack, installPack, saveLocalePref, makeTemplate } from '../i18n/packs'

/**
 * 应用内语言选择器：列出内置 + 已安装语言包，可安装新语言包（.json）或导出模板。
 * 语言包是纯数据，渲染进程为权威源（localStorage 持久化），切换后告知主进程本地化其文案。
 */
export function LanguageMenu(): React.JSX.Element {
  const t = useT()
  const locale = useProject((s) => s.locale)
  const languages = useProject((s) => s.languages)
  const [open, setOpen] = useState(false)
  const current = languages.find((l) => l.id === locale)?.name ?? locale

  const applyLocale = (id: string): void => {
    useProject.getState().setLocale(id)
    saveLocalePref(id)
    void window.desktop.setLocale(id)
    setOpen(false)
  }

  const install = async (): Promise<void> => {
    const file = await window.desktop.openLanguage()
    if (!file) return
    try {
      const pack = parseLanguagePack(file.text)
      installPack(pack)
      useProject.getState().setLanguages(availableLanguages())
      applyLocale(pack.id)
      alert(t('lang.installed', { name: pack.name }))
    } catch (err) {
      alert(t('lang.installFail') + (err instanceof Error ? err.message : String(err)))
    }
  }

  const exportTemplate = async (): Promise<void> => {
    await window.desktop.saveLanguageTemplate(makeTemplate(), 'template.lang.json')
    setOpen(false)
  }

  return (
    <span className="lang-menu">
      <button className="menu-title" onClick={() => setOpen((o) => !o)} title={t('lang.title')}>
        🌐 {current} ▾
      </button>
      {open && (
        <div className="lang-dropdown">
          {languages.map((l) => (
            <button key={l.id} className={l.id === locale ? 'active' : ''} onClick={() => applyLocale(l.id)}>
              {l.id === locale ? '✓ ' : ''}
              {l.name}
            </button>
          ))}
          <div className="lang-sep" />
          <button onClick={() => void install()}>{t('lang.install')}</button>
          <button onClick={() => void exportTemplate()}>{t('lang.exportTemplate')}</button>
        </div>
      )}
    </span>
  )
}
