/** 核心数据模型：解析 + 排版 + 渲染共用，全部纯数据，便于单测 */

export interface LrcChar {
  text: string
  /** 出现时间 ms */
  start: number
  /** 进场动画参考结束时间 ms */
  end: number
}

export interface LrcWord {
  text: string
  start: number
  end: number
  chars: LrcChar[]
}

/** 行级文字属性覆盖：缺省字段跟随全局样式 */
export interface LineTextOverride {
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  italic?: boolean
  textColor?: string
  textAlpha?: number
  letterSpacing?: number
  wordSpacing?: number
  lineSpacing?: number
  textAlign?: 'left' | 'center' | 'right'
  textOrientation?: 'horizontal' | 'vertical'
  strokeColor?: string
  strokeWidth?: number
  strokeAlpha?: number
  textBgColor?: string
  textBgAlpha?: number
  glowColor?: string
  halo?: number
  shadowColor?: string
  shadowAlpha?: number
  shadowBlur?: number
  shadowOffset?: number
}

export interface LrcLine {
  id: number
  /** 行开始 ms */
  start: number
  /** 行结束 ms（= 下一行开始，最后一行为估算值） */
  end: number
  text: string
  words: LrcWord[]
  /** 本行进场特效；null = 跟随全局默认特效 */
  effectId: string | null
  /** 本行退场特效（反向播放该特效的进场）；缺省/null = 默认淡出上浮 */
  effectOutId?: string | null
  /** 本行画面位置偏移（画布像素），画布内拖拽设置 */
  dx: number
  dy: number
  /** 本行文字属性覆盖（字体/字号/颜色…）；缺省字段跟随全局样式 */
  over?: LineTextOverride
  /** 层序（仅独立文字块用于时间轴堆叠与绘制 z 序；0 最底）；歌词行忽略 */
  layer?: number
  /**
   * 'text' = 独立文字块：不参与歌词流（当前行/停靠转场历史），
   * 只在自己的起止区间内独立进场显示。缺省/undefined 为普通歌词行。
   */
  kind?: 'text'
  /** 所属字幕组（多语言/多字幕轨场景）；缺省/undefined = 主字幕组（0） */
  trackId?: number
}

/** 一条额外字幕组（多语言字幕）；主字幕组（id 0）不在这里存储，仍用顶层 meta/lines/lrcName */
export interface CaptionTrack {
  id: number
  /** 展示名；空串 = UI 显示本地化占位名 */
  name: string
  lrcName: string | null
  meta: LrcMeta
  /** 竖直位置偏移（画布像素），叠加在每行自己的 dy 之上，用于与其它字幕组错开不重叠 */
  offsetY: number
  visible: boolean
}

/** 图片库中的一张已导入图片（当前只用作背景图，路径不内嵌） */
export interface ImageAsset {
  id: number
  path: string
  name: string
}

export interface LrcMeta {
  title?: string
  artist?: string
  album?: string
  /** [offset:] 标签，ms，正值表示歌词整体提前 */
  offset: number
}

export interface ParsedLrc {
  meta: LrcMeta
  lines: LrcLine[]
}

/** 解析中间产物：一行原始内容 + 可选的逐字时间段（增强型 LRC） */
export interface RawEntry {
  time: number
  content: string
  /**
   * 行显式结束时间 ms（字幕格式 SRT/VTT 自带，可能与下一行起点之间留有空白）。
   * 缺省时由 buildLines 按"下一行起点"推算（LRC 行为）。
   */
  end?: number
  /** 增强型 LRC 的 <mm:ss.xx> 分段；标准 LRC 为 null */
  segments: { time: number; text: string }[] | null
}
