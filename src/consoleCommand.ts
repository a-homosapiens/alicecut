import type { JobClipSpec, JobTextSpec, JobTrackSpec, HeadlessClip, HeadlessTrackSpec } from '../electron/headless'
import type { LineTextOverride } from './core/types'
import {
  applyLineEffects,
  applyLineStyles,
  applyTrack,
  applyClips,
  applyTexts,
  applyStyle,
  applyPrimaryLrc,
  type CommandLog
} from './projectCommand'

/**
 * 命令控制台接受的 JSON 命令：字段与 job.json 同名同义，是它的一个子集
 * （不含 out/fps/duration——那三个是导出专属参数，作为一次性动作在实时编辑里没有意义）。
 * 应用顺序固定：lrc → tracks → audio/video → texts → style → lineEffects → lineStyles，
 * 让 lineEffects/lineStyles 有机会命中同一条命令里刚 lrc/tracks 载入的新内容。
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
  style?: Record<string, unknown>
  lineEffects?: Record<string, string>
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

  if (cmd.style) {
    try {
      applyStyle(cmd.style)
      log(`✓ style: 已应用`)
    } catch (err) {
      log(`✗ style: ${errMsg(err)}`)
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

  if (cmd.lineStyles) {
    try {
      applyLineStyles(cmd.lineStyles, log)
      log(`✓ lineStyles: 已应用`)
    } catch (err) {
      log(`✗ lineStyles: ${errMsg(err)}`)
    }
  }
}
