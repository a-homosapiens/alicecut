/**
 * 顶栏工具按钮用的线性图标集：18×18、统一 currentColor 描边，随按钮文字颜色走。
 * 只画形状不带语义——可读文案由按钮的 title/aria-label 提供（工具按钮本身不显示文字）。
 */

export type IconName =
  | 'lyrics'
  | 'video'
  | 'audio'
  | 'plugin'
  | 'open'
  | 'save'
  | 'subtitle'
  | 'export'
  | 'console'

/** 每个图标的路径内容（在 0 0 20 20 视口里绘制） */
const PATHS: Record<IconName, React.JSX.Element> = {
  // 字幕框 + 文字行
  lyrics: (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
      <path d="M5.5 9h9M5.5 12h5.5" />
    </>
  ),
  // 播放器画面
  video: (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
      <path d="M8.6 7.9v4.2l3.6-2.1z" />
    </>
  ),
  // 波形柱
  audio: <path d="M3.5 8.2v3.6M7 5.6v8.8M10.5 7.4v5.2M14 4.8v10.4M17 8.8v2.4" />,
  // 四宫格 + 加号（扩展/插件）
  plugin: (
    <>
      <rect x="2.8" y="2.8" width="6" height="6" rx="1.5" />
      <rect x="11.2" y="2.8" width="6" height="6" rx="1.5" />
      <rect x="2.8" y="11.2" width="6" height="6" rx="1.5" />
      <path d="M14.2 11.8v5M11.7 14.3h5" />
    </>
  ),
  // 打开的文件夹
  open: (
    <path d="M2.5 6.4A1.5 1.5 0 0 1 4 4.9h3.4l1.7 2.2h5.9A1.5 1.5 0 0 1 16.5 8.6v5A1.5 1.5 0 0 1 15 15.1H4a1.5 1.5 0 0 1-1.5-1.5z" />
  ),
  // 软盘
  save: (
    <>
      <path d="M3.5 5A1.5 1.5 0 0 1 5 3.5h8L16.5 7v8A1.5 1.5 0 0 1 15 16.5H5A1.5 1.5 0 0 1 3.5 15z" />
      <path d="M6.8 3.5v4h6.4v-4" />
      <path d="M6.8 16.5v-5h6.4v5" />
    </>
  ),
  // 字幕框 + 向下箭头（导出字幕）
  subtitle: (
    <>
      <rect x="2.5" y="3.5" width="15" height="8.5" rx="2" />
      <path d="M6 7h8" />
      <path d="M10 13.2v4M8 15.2l2 2 2-2" />
    </>
  ),
  // 托盘 + 向上箭头（导出成片）
  export: (
    <>
      <path d="M3.8 12.2v3A1.5 1.5 0 0 0 5.3 16.7h9.4a1.5 1.5 0 0 0 1.5-1.5v-3" />
      <path d="M10 3.3v9.4M6.4 6.9 10 3.3l3.6 3.6" />
    </>
  ),
  // 终端
  console: (
    <>
      <rect x="2.5" y="4" width="15" height="12" rx="2" />
      <path d="M6 8.4 8.5 10.6 6 12.8M11.2 12.9h3.4" />
    </>
  )
}

interface Props {
  name: IconName
}

export function Icon({ name }: Props): React.JSX.Element {
  return (
    <svg
      className="icon"
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
