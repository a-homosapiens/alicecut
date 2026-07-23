/**
 * AliceCut 品牌标记：白兔的怀表 —— 兔耳 + 表盘 + 播放三角。
 * 取《爱丽丝梦游仙境》里那只揣着怀表喊「要迟到了」的白兔：怀表点题「时间轴」，
 * 播放三角点题「视频」，兔耳一眼认出是 Alice。线条与工具栏图标同一套画法（描边、圆头）。
 */
export function Logo(): React.JSX.Element {
  return (
    <svg
      className="brand-logo"
      viewBox="0 0 64 64"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* 兔耳：耳根停在表盘边缘上，不伸进盘面里 */}
      <path d="M27.5 23.5C22 17 19.5 10 22 5c4.5 3.5 8 11 9 18" />
      <path d="M36.5 23.5C42 17 44.5 10 42 5c-4.5 3.5-8 11-9 18" />
      {/* 表盘 */}
      <circle cx="32" cy="40" r="17" />
      {/* 播放三角 */}
      <path d="M29 34 39.5 40 29 46z" fill="currentColor" />
    </svg>
  )
}
