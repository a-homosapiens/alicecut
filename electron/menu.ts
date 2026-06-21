import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export type Locale = 'zh' | 'en'

/** 原生菜单文案（与渲染进程 UI 文案分开，主进程自包含） */
const M: Record<Locale, Record<string, string>> = {
  zh: {
    file: '文件', edit: '编辑', view: '视图', language: '语言', window: '窗口',
    quit: '退出', undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
    reload: '重新加载', devtools: '开发者工具', resetZoom: '实际大小', zoomIn: '放大', zoomOut: '缩小',
    fullscreen: '全屏', minimize: '最小化', close: '关闭'
  },
  en: {
    file: 'File', edit: 'Edit', view: 'View', language: 'Language', window: 'Window',
    quit: 'Quit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
    reload: 'Reload', devtools: 'Toggle DevTools', resetZoom: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out',
    fullscreen: 'Toggle Full Screen', minimize: 'Minimize', close: 'Close'
  }
}

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

/** 读持久化语言；缺省按系统语言推断 */
export function loadLocale(): Locale {
  try {
    const s = JSON.parse(readFileSync(settingsPath(), 'utf-8'))
    if (s.locale === 'zh' || s.locale === 'en') return s.locale
  } catch {
    /* 首次运行无文件 */
  }
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function saveLocale(locale: Locale): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify({ locale }), 'utf-8')
  } catch {
    /* 忽略写入失败 */
  }
}

/** 用给定语言构建并设置应用菜单；语言子菜单为单选，点击回调 onPick */
export function buildMenu(locale: Locale, onPick: (l: Locale) => void): void {
  const t = (k: string): string => M[locale][k] ?? k
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = []

  if (isMac) template.push({ role: 'appMenu' })

  template.push({
    label: t('file'),
    submenu: [isMac ? { role: 'close', label: t('close') } : { role: 'quit', label: t('quit') }]
  })
  template.push({
    label: t('edit'),
    submenu: [
      { role: 'undo', label: t('undo') },
      { role: 'redo', label: t('redo') },
      { type: 'separator' },
      { role: 'cut', label: t('cut') },
      { role: 'copy', label: t('copy') },
      { role: 'paste', label: t('paste') },
      { role: 'selectAll', label: t('selectAll') }
    ]
  })
  template.push({
    label: t('view'),
    submenu: [
      { role: 'reload', label: t('reload') },
      { role: 'toggleDevTools', label: t('devtools') },
      { type: 'separator' },
      { role: 'resetZoom', label: t('resetZoom') },
      { role: 'zoomIn', label: t('zoomIn') },
      { role: 'zoomOut', label: t('zoomOut') },
      { type: 'separator' },
      { role: 'togglefullscreen', label: t('fullscreen') }
    ]
  })
  template.push({
    label: t('language'),
    submenu: [
      { label: '中文', type: 'radio', checked: locale === 'zh', click: () => onPick('zh') },
      { label: 'English', type: 'radio', checked: locale === 'en', click: () => onPick('en') }
    ]
  })
  template.push({
    label: t('window'),
    submenu: [
      { role: 'minimize', label: t('minimize') },
      { role: 'close', label: t('close') }
    ]
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
