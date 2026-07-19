/**
 * 会话自动保存：把当前工程（与「保存工程」相同的 v2 结构，仅元数据不含媒体字节）
 * 持久化到 localStorage，刷新/热重载/崩溃后可恢复——工程原本只在内存里，重载即丢失。
 */
import { useProject } from './store/project'

type State = ReturnType<typeof useProject.getState>

const KEY = 'alicecut.session'

/** 与 App「保存工程」一致的可序列化结构（clips 去掉运行时 id） */
export function serializeProject(s: State): object {
  return {
    version: 4,
    meta: s.meta,
    lines: s.lines,
    style: s.style,
    lrcName: s.lrcName,
    tracks: s.tracks,
    images: s.images,
    clips: s.clips.map(({ id: _id, ...rest }) => rest)
  }
}

/** 立即把当前工程写入会话存档；空工程则清除存档（避免覆盖掉有内容的存档） */
export function saveSession(): void {
  try {
    const s = useProject.getState()
    if (s.lines.length === 0 && s.clips.length === 0) {
      localStorage.removeItem(KEY)
      return
    }
    localStorage.setItem(KEY, JSON.stringify(serializeProject(s)))
  } catch {
    /* 配额/隐私模式：忽略 */
  }
}

/** 读取会话存档（无则 null） */
export function loadSession(): { lines?: unknown; clips?: unknown; [k: string]: unknown } | null {
  try {
    const text = localStorage.getItem(KEY)
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

let started = false

/**
 * 开启自动保存：订阅文档字段变化，防抖写入；并在页面卸载（刷新/热重载/关闭）前同步落盘。
 * 仅 GUI 调用（无头导出不需要）。
 */
export function enableSessionAutosave(): void {
  if (started) return
  started = true
  let timer: ReturnType<typeof setTimeout> | undefined
  useProject.subscribe((s, prev) => {
    if (
      s.lines === prev.lines &&
      s.clips === prev.clips &&
      s.style === prev.style &&
      s.meta === prev.meta &&
      s.lrcName === prev.lrcName &&
      s.tracks === prev.tracks &&
      s.images === prev.images
    ) {
      return
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(saveSession, 800)
  })
  // 重载/关闭前最后一次同步保存，保证未防抖落盘的改动不丢
  window.addEventListener('beforeunload', saveSession)
}
