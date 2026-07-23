import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { mergeStoredSettings, parseStoredSettings, type StoredSettings } from './settingsCore'

export type Locale = 'zh' | 'en'

/** 原生菜单文案（与渲染进程 UI 文案分开，主进程自包含） */
const M: Record<Locale, Record<string, string>> = {
  zh: {
    file: '文件', edit: '编辑', view: '视图', language: '语言', window: '窗口', helpMenu: '帮助', help: '帮助', about: '关于',
    quit: '退出', undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
    reload: '重新加载', devtools: '开发者工具', resetZoom: '实际大小', zoomIn: '放大', zoomOut: '缩小',
    fullscreen: '全屏', minimize: '最小化', close: '关闭'
  },
  en: {
    file: 'File', edit: 'Edit', view: 'View', language: 'Language', window: 'Window', helpMenu: 'Help', help: 'Help', about: 'About',
    quit: 'Quit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
    reload: 'Reload', devtools: 'Toggle DevTools', resetZoom: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out',
    fullscreen: 'Toggle Full Screen', minimize: 'Minimize', close: 'Close'
  }
}

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

function readSettings(): StoredSettings {
  try {
    return parseStoredSettings(readFileSync(settingsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function saveSettings(patch: Partial<StoredSettings>): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(mergeStoredSettings(readSettings(), patch)), 'utf-8')
  } catch {
    /* Ignore settings write failures. */
  }
}

/** 读持久化语言；缺省按系统语言推断 */
export function loadLocale(): Locale {
  const s = readSettings()
  if (s.locale === 'zh' || s.locale === 'en') return s.locale
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function saveLocale(locale: Locale): void {
  saveSettings({ locale })
}

export function loadLastProjectDirectory(): string | null {
  const directory = readSettings().lastProjectDirectory
  if (typeof directory !== 'string' || !directory || !existsSync(directory)) return null
  try {
    return statSync(directory).isDirectory() ? directory : null
  } catch {
    return null
  }
}

export function saveLastProjectDirectory(directory: string): void {
  saveSettings({ lastProjectDirectory: directory })
}

/** 渲染进程可通过原生菜单触发的命令（与 App 里的 AppCommands 一一对应） */
export type MenuCommand =
  | 'openProject'
  | 'saveProject'
  | 'importLrc'
  | 'importVideo'
  | 'importAudio'
  | 'importPlugin'
  | 'exportSrt'
  | 'exportVideo'
  | 'toggleConsole'
  | 'undo'
  | 'redo'
  | 'selectAll'

/**
 * 渲染进程推给主进程的菜单状态。命令文案与面板清单都由渲染进程解析好再送来——
 * 那边才是 i18n 的权威源（含用户安装的语言包），主进程只负责画菜单。
 */
export interface AppMenuState {
  /** 已按当前语言解析好的命令文案，键 = MenuCommand + panels */
  labels: Record<string, string>
  panels: { id: string; label: string; visible: boolean }[]
  consoleOpen: boolean
  hasProject: boolean
  hasCaptions: boolean
  canExport: boolean
}

export interface MenuEmit {
  command(cmd: MenuCommand): void
  togglePanel(id: string): void
  openHelp(): void
  openAbout(): void
}

/**
 * 用给定语言构建并设置应用菜单（语言切换改在应用内，菜单不含语言项）。
 * state 为 null 时（渲染进程还没送状态过来）只画标准的系统菜单项。
 */
export function buildMenu(locale: Locale, state: AppMenuState | null = null, emit?: MenuEmit): void {
  const t = (k: string): string => M[locale][k] ?? k
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = []

  if (isMac) template.push({ role: 'appMenu' })

  const cmd = (key: MenuCommand, enabled = true): MenuItemConstructorOptions => ({
    label: state?.labels[key] ?? key,
    enabled,
    click: () => emit?.command(key)
  })

  const fileItems: MenuItemConstructorOptions[] = state
    ? [
        cmd('openProject'),
        cmd('saveProject', state.hasProject),
        { type: 'separator' },
        cmd('importLrc'),
        cmd('importVideo'),
        cmd('importAudio'),
        { type: 'separator' },
        cmd('exportSrt', state.hasCaptions),
        cmd('exportVideo', state.canExport),
        { type: 'separator' },
        isMac ? { role: 'close', label: t('close') } : { role: 'quit', label: t('quit') }
      ]
    : [isMac ? { role: 'close', label: t('close') } : { role: 'quit', label: t('quit') }]

  template.push({ label: t('file'), submenu: fileItems })
  template.push({
    label: t('edit'),
    submenu: [
      cmd('undo'),
      cmd('redo'),
      { type: 'separator' },
      { role: 'cut', label: t('cut') },
      { role: 'copy', label: t('copy') },
      { role: 'paste', label: t('paste') },
      cmd('selectAll')
    ]
  })
  // 视图：面板显隐（恢复被关闭面板的唯一入口）+ 命令控制台，之后才是标准的缩放/全屏
  const viewItems: MenuItemConstructorOptions[] = []
  if (state) {
    viewItems.push(
      {
        label: state.labels.panels ?? 'Panels',
        submenu: state.panels.map((p) => ({
          label: p.label,
          type: 'checkbox' as const,
          checked: p.visible,
          click: () => emit?.togglePanel(p.id)
        }))
      },
      {
        label: state.labels.toggleConsole ?? 'Console',
        type: 'checkbox',
        checked: state.consoleOpen,
        click: () => emit?.command('toggleConsole')
      },
      { type: 'separator' }
    )
  }
  if (!app.isPackaged) {
    viewItems.push(
      { role: 'reload', label: t('reload') },
      { role: 'toggleDevTools', label: t('devtools') },
      { type: 'separator' }
    )
  }
  viewItems.push(
    { role: 'resetZoom', label: t('resetZoom') },
    { role: 'zoomIn', label: t('zoomIn') },
    { role: 'zoomOut', label: t('zoomOut') },
    { type: 'separator' },
    { role: 'togglefullscreen', label: t('fullscreen') }
  )
  template.push({ label: t('view'), submenu: viewItems })
  template.push({
    label: t('window'),
    submenu: [
      { role: 'minimize', label: t('minimize') },
      { role: 'close', label: t('close') }
    ]
  })
  template.push({
    label: t('helpMenu'),
    submenu: [
      { label: t('help'), click: () => emit?.openHelp() },
      { label: t('about'), click: () => emit?.openAbout() }
    ]
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
