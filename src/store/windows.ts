import { create } from 'zustand'

/**
 * 全部"可关闭面板/区块"的注册表：驱动顶栏「窗口」菜单——每一项在那里都能勾选恢复。
 * id 是稳定字符串，caption/resourceLibrary 对应左侧栏整块，style.* 对应样式面板的各个区块。
 */
export interface WindowDef {
  id: string
  labelKey: string
}

export const WINDOW_REGISTRY: WindowDef[] = [
  { id: 'captions', labelKey: 'tracks.sectionTitle' },
  { id: 'resourceLibrary', labelKey: 'resourceLibrary.title' },
  { id: 'style.size', labelKey: 'style.sizeSection' },
  { id: 'style.background', labelKey: 'style.bgSection' },
  { id: 'style.text', labelKey: 'style.textSection' },
  { id: 'style.transform', labelKey: 'style.transformSection' },
  { id: 'style.effects', labelKey: 'style.effects' }
]

interface WindowsState {
  /** 缺省/false = 可见；true = 已关闭。纯 UI 状态：不进撤销历史，不写入工程文件 */
  hidden: Record<string, boolean>
  hide(id: string): void
  show(id: string): void
  toggle(id: string): void
}

export const useWindows = create<WindowsState>((set, get) => ({
  hidden: {},
  hide(id) {
    set({ hidden: { ...get().hidden, [id]: true } })
  },
  show(id) {
    set({ hidden: { ...get().hidden, [id]: false } })
  },
  toggle(id) {
    const cur = get().hidden[id] ?? false
    set({ hidden: { ...get().hidden, [id]: !cur } })
  }
}))
