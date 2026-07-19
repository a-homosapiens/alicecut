import { create } from 'zustand'

/**
 * 悬浮/可停靠字幕组面板的界面状态（是否展开、浮动/停靠、浮动时的位置/层序）。
 * 纯 UI 状态：不进撤销历史，不写入工程文件——关闭/移动面板不算一次编辑。
 * 键（panelId）就是字幕组 id（0 = 主字幕组）。
 */
export interface PanelInfo {
  open: boolean
  floating: boolean
  /** 浮动时的位置（视口像素） */
  x: number
  y: number
  /** 层序：数值越大越靠前；点击/拖动面板时提升 */
  z: number
}

interface PanelsState {
  /** 以 panelId 为键；缺省项视为未展开过 */
  panels: Record<number, PanelInfo>
  /** 展开面板；已有记录则保留其位置/浮动状态，仅重开并置顶；首次展开时 floating 缺省浮动 */
  openPanel(panelId: number, floating?: boolean): void
  closePanel(panelId: number): void
  setFloating(panelId: number, floating: boolean): void
  movePanel(panelId: number, x: number, y: number): void
  bringToFront(panelId: number): void
}

let nextZ = 1
const FLOAT_BASE_X = 300
const FLOAT_BASE_Y = 90
const FLOAT_CASCADE = 28

function floatingOpenCount(panels: Record<number, PanelInfo>): number {
  return Object.values(panels).filter((p) => p.open && p.floating).length
}

export const usePanels = create<PanelsState>((set, get) => ({
  // 主字幕组（id 0）默认停靠展开，和原先始终可见的歌词面板体验一致
  panels: { 0: { open: true, floating: false, x: 0, y: 0, z: nextZ++ } },

  openPanel(panelId, floating) {
    const st = get()
    const cur = st.panels[panelId]
    if (cur) {
      set({ panels: { ...st.panels, [panelId]: { ...cur, open: true, z: nextZ++ } } })
      return
    }
    const n = floatingOpenCount(st.panels)
    set({
      panels: {
        ...st.panels,
        [panelId]: {
          open: true,
          floating: floating ?? true,
          x: FLOAT_BASE_X + n * FLOAT_CASCADE,
          y: FLOAT_BASE_Y + n * FLOAT_CASCADE,
          z: nextZ++
        }
      }
    })
  },

  closePanel(panelId) {
    const cur = get().panels[panelId]
    if (!cur) return
    set({ panels: { ...get().panels, [panelId]: { ...cur, open: false } } })
  },

  setFloating(panelId, floating) {
    const cur = get().panels[panelId]
    if (!cur) return
    set({ panels: { ...get().panels, [panelId]: { ...cur, floating, z: nextZ++ } } })
  },

  movePanel(panelId, x, y) {
    const cur = get().panels[panelId]
    if (!cur) return
    set({ panels: { ...get().panels, [panelId]: { ...cur, x, y } } })
  },

  bringToFront(panelId) {
    const cur = get().panels[panelId]
    if (!cur) return
    set({ panels: { ...get().panels, [panelId]: { ...cur, z: nextZ++ } } })
  }
}))
