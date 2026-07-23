import { Icon, type IconName } from './Icon'
import { useT } from '../i18n'

/**
 * 顶栏工具条与原生菜单共用的命令集合；实现都在 App 里
 * （那里才有文件对话框与 store 上下文）。键名与主进程 MenuCommand 一一对应。
 */
export interface AppCommands {
  importLrc(): void
  importVideo(): void
  importAudio(): void
  importPlugin(): void
  openProject(): void
  saveProject(): void
  exportSrt(): void
  exportVideo(): void
}

interface Props {
  commands: AppCommands
  hasProject: boolean
  hasCaptions: boolean
  canExport: boolean
  consoleOpen: boolean
  toggleConsole(): void
}

/**
 * 顶栏工具条：只有图标，没有文字——文案走 title/aria-label（悬停可见），
 * 完整命令列表在菜单栏里。分组用细分隔线隔开：工程 | 导入 | 导出 | 工具。
 */
export function Toolbar({ commands, hasProject, hasCaptions, canExport, consoleOpen, toggleConsole }: Props): React.JSX.Element {
  const t = useT()

  // label 同时用作 tooltip 与无障碍名，工具按钮本身不显示文字
  const btn = (
    icon: IconName,
    label: string,
    onClick: () => void,
    opts: { disabled?: boolean; primary?: boolean; active?: boolean } = {}
  ): React.JSX.Element => (
    <button
      className={`tool-btn${opts.primary ? ' tool-btn-primary' : ''}${opts.active ? ' active' : ''}`}
      onClick={onClick}
      disabled={opts.disabled}
      title={label}
      aria-label={label}
    >
      <Icon name={icon} />
    </button>
  )

  return (
    <div className="toolbar">
      {btn('open', t('topbar.openProject'), commands.openProject)}
      {btn('save', t('topbar.saveProject'), commands.saveProject, { disabled: !hasProject })}

      <div className="tool-sep" />

      {btn('lyrics', t('topbar.importLyrics'), commands.importLrc)}
      {btn('video', t('topbar.importVideo'), commands.importVideo)}
      {btn('audio', t('topbar.importAudio'), commands.importAudio)}

      <div className="tool-sep" />

      {btn('console', t('console.title'), toggleConsole, { active: consoleOpen })}

      <div className="tool-sep" />

      {btn('subtitle', t('topbar.exportSrt'), commands.exportSrt, { disabled: !hasCaptions })}
      {btn('export', t('topbar.exportVideo'), commands.exportVideo, { disabled: !canExport, primary: true })}
    </div>
  )
}
