import { useEffect, useRef, useState } from 'react'
import { useProject, getProjectDuration } from '../store/project'
import { getEffect } from '../core/effects'
import { seek } from '../playback'
import type { LrcLine } from '../core/types'

/** 每种特效的线段配色，便于一眼区分 */
const EFFECT_COLORS: Record<string, string> = {
  pop: '#6366f1',
  punch: '#ef4444',
  slide: '#0ea5e9',
  typewriter: '#10b981',
  glow: '#f59e0b',
  flip: '#d946ef',
  'flip-bottom': '#a855f7',
  rise: '#14b8a6'
}

const TRIM_MODES = ['trim-l', 'trim-r'] as const
type DragMode = 'move' | (typeof TRIM_MODES)[number]

interface DragState {
  mode: DragMode
  startClientX: number
  /** 拖拽起始时刻的行快照（深拷贝），位移始终相对快照计算 */
  originals: LrcLine[]
  moved: boolean
  clickedId: number
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 刻度间隔：保证主刻度至少 70px */
function tickStep(pxPerSec: number): number {
  for (const s of [1, 2, 5, 10, 15, 30, 60, 120]) {
    if (s * pxPerSec >= 70) return s
  }
  return 300
}

/** 播放头独立订阅 currentTime，避免整个时间轴每帧重渲染 */
function Playhead({
  pxPerSec,
  scrollRef
}: {
  pxPerSec: number
  scrollRef: React.RefObject<HTMLDivElement>
}): React.JSX.Element {
  const t = useProject((s) => s.currentTime)
  const playing = useProject((s) => s.playing)
  const x = t * pxPerSec

  useEffect(() => {
    const el = scrollRef.current
    if (!playing || !el) return
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 80) {
      el.scrollLeft = Math.max(0, x - 80)
    }
  }, [x, playing, scrollRef])

  return <div className="tl-playhead" style={{ left: x }} />
}

export function Timeline(): React.JSX.Element {
  const lines = useProject((s) => s.lines)
  const audio = useProject((s) => s.audio)
  const selectedIds = useProject((s) => s.selectedIds)
  const globalEffectId = useProject((s) => s.style.effectId)
  const [pxPerSec, setPxPerSec] = useState(60)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)

  const duration = getProjectDuration({ lines, audio })
  const innerWidth = Math.max(duration * pxPerSec + 160, 400)
  const step = tickStep(pxPerSec)
  const ticks: number[] = []
  for (let s = 0; s <= duration; s += step) ticks.push(s)

  const zoom = (factor: number): void => {
    setPxPerSec((v) => Math.min(300, Math.max(12, v * factor)))
  }

  /* ---- 线段拖拽：移动 / 边缘微调 ---- */
  const onSegmentMouseDown = (e: React.MouseEvent, line: LrcLine, mode: DragMode): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    const st = useProject.getState()

    // 选区处理：Ctrl 多选切换；点击未选中的线段则单选
    if (e.ctrlKey || e.metaKey) {
      st.toggleSelected(line.id)
    } else if (!st.selectedIds.includes(line.id)) {
      st.setSelection([line.id])
    }

    const afterSel = useProject.getState()
    const dragIds = new Set(mode === 'move' ? afterSel.selectedIds : [line.id])
    const originals = afterSel.lines.filter((l) => dragIds.has(l.id)).map((l) => structuredClone(l))
    dragRef.current = { mode, startClientX: e.clientX, originals, moved: false, clickedId: line.id }

    const onMove = (ev: MouseEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const deltaPx = ev.clientX - drag.startClientX
      if (Math.abs(deltaPx) > 3) drag.moved = true
      if (!drag.moved) return
      const deltaMs = (deltaPx / pxPerSec) * 1000
      const s = useProject.getState()
      if (drag.mode === 'move') {
        s.moveLinesFrom(drag.originals, deltaMs)
      } else {
        const o = drag.originals[0]
        if (drag.mode === 'trim-l') s.retimeLineFrom(o, o.start + deltaMs, o.end)
        else s.retimeLineFrom(o, o.start, o.end + deltaMs)
      }
    }
    const onUp = (): void => {
      const drag = dragRef.current
      // 纯点击（没拖动）：把播放头跳进该行，画面里能看到并编辑它
      if (drag && !drag.moved) {
        const l = useProject.getState().lines.find((x) => x.id === drag.clickedId)
        if (l) seek((l.start + Math.min(800, (l.end - l.start) / 2)) / 1000)
      }
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /* ---- 空白处按下：定位播放头（拖动连续刷），并清除选区 ---- */
  const onTrackMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    const el = scrollRef.current
    if (!el) return
    useProject.getState().clearSelection()
    const toTime = (clientX: number): number => {
      const rect = el.getBoundingClientRect()
      return Math.max(0, (clientX - rect.left + el.scrollLeft) / pxPerSec)
    }
    seek(toTime(e.clientX))
    const onMove = (ev: MouseEvent): void => seek(toTime(ev.clientX))
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const selectedLine = selectedIds.length === 1 ? lines.find((l) => l.id === selectedIds[0]) : undefined

  if (lines.length === 0) {
    return <div className="timeline empty">导入歌词后，每句歌词会成为时间轴上的可编辑线段</div>
  }

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <button className="btn btn-sm" onClick={() => useProject.getState().selectAll()}>
          全选
        </button>
        <button
          className="btn btn-sm"
          disabled={selectedIds.length === 0}
          onClick={() => useProject.getState().clearSelection()}
        >
          取消选择
        </button>
        <span className="hint">
          {selectedIds.length > 0 ? `已选 ${selectedIds.length} 条 — 可在右侧选择特效，画面中拖动调整位置` : '点击线段选中 · Ctrl+点击多选 · 拖动挪时间 · 拖边缘微调'}
        </span>
        {selectedLine && (
          <span className="tl-times">
            <label>
              开始
              <input
                type="number"
                step={0.01}
                min={0}
                value={(selectedLine.start / 1000).toFixed(2)}
                onChange={(e) =>
                  useProject
                    .getState()
                    .retimeLineFrom(selectedLine, Number(e.target.value) * 1000, selectedLine.end)
                }
              />
            </label>
            <label>
              结束
              <input
                type="number"
                step={0.01}
                min={0}
                value={(selectedLine.end / 1000).toFixed(2)}
                onChange={(e) =>
                  useProject
                    .getState()
                    .retimeLineFrom(selectedLine, selectedLine.start, Number(e.target.value) * 1000)
                }
              />
            </label>
          </span>
        )}
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => zoom(1 / 1.3)} title="缩小时间轴">
          −
        </button>
        <button className="btn btn-sm" onClick={() => zoom(1.3)} title="放大时间轴">
          +
        </button>
      </div>

      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-inner" style={{ width: innerWidth }} onMouseDown={onTrackMouseDown}>
          <div className="tl-ruler">
            {ticks.map((s) => (
              <span key={s} className="tl-tick" style={{ left: s * pxPerSec }}>
                {fmt(s)}
              </span>
            ))}
          </div>
          <div className="tl-track">
            {lines.map((line) => {
              const effId = line.effectId ?? globalEffectId
              const color = EFFECT_COLORS[effId] ?? '#6366f1'
              const sel = selectedIds.includes(line.id)
              return (
                <div
                  key={line.id}
                  className={`tl-seg${sel ? ' selected' : ''}`}
                  style={{
                    left: (line.start / 1000) * pxPerSec,
                    width: Math.max(((line.end - line.start) / 1000) * pxPerSec, 14),
                    borderColor: color,
                    background: `${color}2e`
                  }}
                  title={`${line.text}\n${getEffect(effId).name}${line.effectId ? '' : '（全局默认）'}`}
                  onMouseDown={(e) => onSegmentMouseDown(e, line, 'move')}
                >
                  <div
                    className="tl-handle l"
                    onMouseDown={(e) => onSegmentMouseDown(e, line, 'trim-l')}
                  />
                  <span className="tl-seg-text">{line.text || '（间奏）'}</span>
                  <span className="tl-seg-fx" style={{ color }}>
                    {getEffect(effId).name}
                  </span>
                  <div
                    className="tl-handle r"
                    onMouseDown={(e) => onSegmentMouseDown(e, line, 'trim-r')}
                  />
                </div>
              )
            })}
          </div>
          <Playhead pxPerSec={pxPerSec} scrollRef={scrollRef} />
        </div>
      </div>
    </div>
  )
}
