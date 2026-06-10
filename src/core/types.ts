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

export interface LrcLine {
  id: number
  /** 行开始 ms */
  start: number
  /** 行结束 ms（= 下一行开始，最后一行为估算值） */
  end: number
  text: string
  words: LrcWord[]
  /** 本行特效；null = 跟随全局默认特效 */
  effectId: string | null
  /** 本行画面位置偏移（画布像素），画布内拖拽设置 */
  dx: number
  dy: number
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
  /** 增强型 LRC 的 <mm:ss.xx> 分段；标准 LRC 为 null */
  segments: { time: number; text: string }[] | null
}
