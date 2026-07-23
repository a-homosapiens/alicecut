import type { JobClipSpec, JobTextSpec, JobTrackSpec, HeadlessClip, HeadlessTrackSpec } from '../electron/headless'
import type { LineTextOverride } from './core/types'
import { useProject } from './store/project'
import {
  applyLineEffects,
  applyLineEffectsOut,
  applyLineEffectDurations,
  applyLineStyles,
  applyTrack,
  applyClips,
  applyTexts,
  applyStyle,
  applyPrimaryLrc,
  type CommandLog
} from './projectCommand'

/**
 * 命令控制台接受的 JSON 命令：支持 job.json 的实时编辑子集，并额外支持
 * select/effectIn/effectOut/selectedStyle 这组选区命令（不含导出专用的 out/fps/duration）。
 * 应用顺序固定：lrc → tracks → audio/video → texts → select → style →
 * effectIn/effectOut/selectedStyle → lineEffects → lineEffectsOut → lineStyles。
 * 每个顶层字段各自 try/catch、各自在回显里报告成功/失败——不做"全部成功才生效"的事务，
 * 每一步本身已经在撤销栈上，一步坏了 Ctrl+Z 即可，没必要另建回滚机制。
 */
export interface ConsoleCommand {
  /** 非破坏性地替换主字幕组：映射到 loadLrcToTrack(0, …)，
   *  不是 job.json headless 模式那个会清空整份工程的 lrc——那个只保留给顶栏「导入歌词」 */
  lrc?: string
  audio?: string | JobClipSpec | (string | JobClipSpec)[]
  video?: string | JobClipSpec | (string | JobClipSpec)[]
  texts?: JobTextSpec[]
  tracks?: (Omit<JobTrackSpec, 'lrc'> & { lrc: string })[]
  /** Select captions before applying the selected-item fields below. */
  select?: 'captions' | 'all' | 'none' | number[]
  style?: Record<string, unknown>
  effectIn?: string | null
  effectOut?: string | null
  /** Selected-caption durations in seconds. If both are present, In has priority. */
  effectInDuration?: number
  effectOutDuration?: number
  selectedStyle?: LineTextOverride
  lineEffects?: Record<string, string>
  lineEffectsOut?: Record<string, string>
  lineEffectDurations?: Record<string, import('../electron/headless').EffectDurationSpec>
  lineStyles?: Record<string, LineTextOverride>
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** 解析并依次应用一条命令；raw 不是合法 JSON 时只报一行错误，不碰任何 store 状态 */
export async function runConsoleCommand(raw: string, log: CommandLog): Promise<void> {
  let cmd: ConsoleCommand
  try {
    cmd = JSON.parse(raw) as ConsoleCommand
  } catch (err) {
    log(`✗ JSON 解析失败：${errMsg(err)}`)
    return
  }
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) {
    log('✗ 命令必须是 JSON 对象')
    return
  }
  if (cmd.tracks !== undefined && !Array.isArray(cmd.tracks)) {
    log('✗ tracks: expected an array')
    return
  }
  if (cmd.texts !== undefined && !Array.isArray(cmd.texts)) {
    log('✗ texts: expected an array')
    return
  }
  if (cmd.style !== undefined && (!cmd.style || typeof cmd.style !== 'object' || Array.isArray(cmd.style))) {
    log('✗ style: expected an object')
    return
  }

  if (cmd.lrc) {
    try {
      const text = await window.desktop.readText(cmd.lrc)
      if (text == null) throw new Error(`文件不存在或不是绝对路径: ${cmd.lrc}`)
      applyPrimaryLrc(text, basename(cmd.lrc))
      log(`✓ lrc: 已载入主字幕组（${basename(cmd.lrc)}）`)
    } catch (err) {
      log(`✗ lrc: ${errMsg(err)}`)
    }
  }

  if (cmd.tracks) {
    for (const spec of cmd.tracks) {
      try {
        const text = await window.desktop.readText(spec.lrc)
        if (text == null) throw new Error(`文件不存在或不是绝对路径: ${spec.lrc}`)
        const resolved: HeadlessTrackSpec = {
          name: spec.name,
          lrcText: text,
          lrcName: basename(spec.lrc),
          offsetY: spec.offsetY,
          visible: spec.visible,
          lineEffects: spec.lineEffects ?? {},
          lineEffectsOut: spec.lineEffectsOut ?? {},
          lineStyles: spec.lineStyles ?? {}
        }
        const track = applyTrack(resolved, log)
        log(`✓ tracks: 新增字幕组「${track.name || `#${track.id}`}」`)
      } catch (err) {
        log(`✗ tracks: ${errMsg(err)}`)
      }
    }
  }

  if (cmd.audio || cmd.video) {
    try {
      const videoClips: HeadlessClip[] = cmd.video ? await window.desktop.normalizeClips('video', cmd.video) : []
      const audioClips: HeadlessClip[] = cmd.audio ? await window.desktop.normalizeClips('audio', cmd.audio) : []
      await applyClips([...videoClips, ...audioClips])
      log(`✓ audio/video: 已加入 ${videoClips.length + audioClips.length} 段媒体线段`)
    } catch (err) {
      log(`✗ audio/video: ${errMsg(err)}`)
    }
  }

  if (cmd.texts) {
    try {
      applyTexts(cmd.texts, log)
      log(`✓ texts: 已加入 ${cmd.texts.length} 个文字块`)
    } catch (err) {
      log(`✗ texts: ${errMsg(err)}`)
    }
  }

  if (cmd.select !== undefined) {
    try {
      const st = useProject.getState()
      if (cmd.select === 'captions') st.selectAllCaptions()
      else if (cmd.select === 'all') st.selectAll()
      else if (cmd.select === 'none') st.clearSelection()
      else if (Array.isArray(cmd.select)) {
        const existing = new Set(st.lines.map((line) => line.id))
        st.setSelection(cmd.select.filter((id) => Number.isInteger(id) && existing.has(id)))
      } else throw new Error('expected "captions", "all", "none", or an array of line ids')
      log(`✓ select: ${useProject.getState().selectedIds.length} item(s) selected`)
    } catch (err) {
      log(`✗ select: ${errMsg(err)}`)
    }
  }

  if (cmd.style) {
    try {
      applyStyle(cmd.style)
      log(`✓ style: 已应用`)
    } catch (err) {
      log(`✗ style: ${errMsg(err)}`)
    }
  }

  if (Object.prototype.hasOwnProperty.call(cmd, 'effectIn')) {
    try {
      const ids = useProject.getState().selectedIds
      if (ids.length === 0) throw new Error('no captions selected')
      useProject.getState().setLineEffect(ids, cmd.effectIn ?? null)
      log(`✓ effectIn: applied to ${ids.length} selected item(s)`)
    } catch (err) {
      log(`✗ effectIn: ${errMsg(err)}`)
    }
  }

  if (Object.prototype.hasOwnProperty.call(cmd, 'effectOut')) {
    try {
      const ids = useProject.getState().selectedIds
      if (ids.length === 0) throw new Error('no captions selected')
      useProject.getState().setLineEffectOut(ids, cmd.effectOut ?? null)
      log(`✓ effectOut: applied to ${ids.length} selected item(s)`)
    } catch (err) {
      log(`✗ effectOut: ${errMsg(err)}`)
    }
  }

  if (cmd.effectInDuration !== undefined || cmd.effectOutDuration !== undefined) {
    try {
      const ids = useProject.getState().selectedIds
      if (ids.length === 0) throw new Error('no captions selected')
      // One command containing both values gives In priority.
      if (typeof cmd.effectOutDuration === 'number') {
        useProject.getState().setLineEffectDuration(ids, 'out', cmd.effectOutDuration * 1000)
      }
      if (typeof cmd.effectInDuration === 'number') {
        useProject.getState().setLineEffectDuration(ids, 'in', cmd.effectInDuration * 1000)
      }
      log(`✓ effect duration: applied to ${ids.length} selected item(s)`)
    } catch (err) {
      log(`✗ effect duration: ${errMsg(err)}`)
    }
  }

  if (cmd.selectedStyle) {
    try {
      const ids = useProject.getState().selectedIds
      if (ids.length === 0) throw new Error('no captions selected')
      useProject.getState().patchLineOver(ids, cmd.selectedStyle)
      log(`✓ selectedStyle: applied to ${ids.length} selected item(s)`)
    } catch (err) {
      log(`✗ selectedStyle: ${errMsg(err)}`)
    }
  }

  if (cmd.lineEffects) {
    try {
      applyLineEffects(cmd.lineEffects, log)
      log(`✓ lineEffects: 已应用`)
    } catch (err) {
      log(`✗ lineEffects: ${errMsg(err)}`)
    }
  }

  if (cmd.lineEffectsOut) {
    try {
      applyLineEffectsOut(cmd.lineEffectsOut, log)
      log(`✓ lineEffectsOut: 已应用`)
    } catch (err) {
      log(`✗ lineEffectsOut: ${errMsg(err)}`)
    }
  }

  if (cmd.lineEffectDurations) {
    try {
      applyLineEffectDurations(cmd.lineEffectDurations, log)
      log(`✓ lineEffectDurations: 已应用`)
    } catch (err) {
      log(`✗ lineEffectDurations: ${errMsg(err)}`)
    }
  }

  if (cmd.lineStyles) {
    try {
      applyLineStyles(cmd.lineStyles, log)
      log(`✓ lineStyles: 已应用`)
    } catch (err) {
      log(`✗ lineStyles: ${errMsg(err)}`)
    }
  }
}
