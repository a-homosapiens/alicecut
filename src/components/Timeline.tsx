import { useEffect, useRef, useState } from 'react'
import { useProject, getProjectDuration } from '../store/project'
import { getEffect } from '../core/effects'
import { clipEnd, type MediaClip } from '../core/media'
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

const CLIP_COLORS: Record<MediaClip['kind'], string> = {
  video: '#f97316',
  audio: '#22c55e'
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

/** 媒体线段（视频/音频轨）：拖动挪起点，点击选中 */
function ClipSegment({
  clip,
  pxPerSec,
  durationMs
}: {
  clip: MediaClip
  pxPerSec: number
  durationMs: number
}): React.JSX.Element {
  const selected = useProject((s) => s.selectedClipId === clip.id)
  const color = CLIP_COLORS[clip.kind]
  const endMs = clipEnd(clip, durationMs)
  const left = (clip.start / 1000) * pxPerSec
  const width = Math.max(((endMs - clip.start) / 1000) * pxPerSec, 14)
  // 循环边界刻线：每个 sourceDuration 一道
  const period = (clip.sourceDuration / 1000) * pxPerSec
  const loopMarks =
    (clip.loop === 'infinite' || clip.loop > 1) && period > 6
      ? `repeating-linear-gradient(to right, transparent 0, transparent ${period - 1.5}px, ${color}aa ${period - 1.5}px, ${color}aa ${period}px)`
      : undefined
  const loopLabel = clip.loop === 'infinite' ? '∞' : clip.loop > 1 ? `×${clip.loop}` : ''

  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    const st = useProject.getState()
    st.setSelectedClip(clip.id)
    const original = { ...clip }
    const startClientX = e.clientX
    let moved = false
    const onMove = (ev: MouseEvent): void => {
      const deltaPx = ev.clientX - startClientX
      if (Math.abs(deltaPx) > 3) moved = true
      if (!moved) return
      useProject.getState().moveClipFrom(original, (deltaPx / pxPerSec) * 1000)
    }
    const onUp = (): void => {
      if (!moved) seek(clip.start / 1000) // 纯点击：播放头跳到线段开头
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className={`tl-clip${selected ? ' selected' : ''}`}
      style={{
        left,
        width,
        borderColor: color,
        background: `${color}2e`,
        backgroundImage: loopMarks
      }}
      title={`${clip.name}\n${clip.kind === 'video' ? '背景视频' : '音轨'} · ${
        clip.loop === 'infinite' ? '无限循环' : `重复 ${clip.loop} 次`
      }`}
      onMouseDown={onMouseDown}
    >
      <span className="tl-clip-icon">{clip.kind === 'video' ? '🎬' : '🎵'}</span>
      <span className="tl-seg-text">{clip.name}</span>
      {loopLabel && (
        <span className="tl-clip-loop" style={{ color }}>
          {loopLabel}
        </span>
      )}
    </div>
  )
}

/** 选中媒体线段时的工具条控件：起点 / 循环次数 / 无限循环 / 删除 */
function ClipControls({ clip }: { clip: MediaClip }): React.JSX.Element {
  const st = (): ReturnType<typeof useProject.getState> => useProject.getState()
  return (
    <span className="tl-times">
      <label>
        开始
        <input
          type="number"
          step={0.1}
          min={0}
          value={(clip.start / 1000).toFixed(2)}
          onChange={(e) => st().setClipStart(clip.id, Number(e.target.value) * 1000)}
        />
      </label>
      <label>
        循环
        <input
          type="number"
          step={1}
          min={1}
          disabled={clip.loop === 'infinite'}
          value={clip.loop === 'infinite' ? '' : clip.loop}
          placeholder="∞"
          onChange={(e) => st().setClipLoop(clip.id, Number(e.target.value))}
        />
        次
      </label>
      <label title="一直循环到项目结束">
        <input
          type="checkbox"
          checked={clip.loop === 'infinite'}
          onChange={(e) => st().setClipLoop(clip.id, e.target.checked ? 'infinite' : 1)}
        />
        无限循环
      </label>
      <button className="btn btn-sm" onClick={() => st().removeClip(clip.id)}>
        删除
      </button>
    </span>
  )
}

export function Timeline(): React.JSX.Element {
  const lines = useProject((s) => s.lines)
  const clips = useProject((s) => s.clips)
  const selectedIds = useProject((s) => s.selectedIds)
  const selectedClipId = useProject((s) => s.selectedClipId)
  const globalEffectId = useProject((s) => s.style.effectId)
  const [pxPerSec, setPxPerSec] = useState(60)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)

  const duration = getProjectDuration({ lines, clips })
  const durationMs = duration * 1000
  const innerWidth = Math.max(duration * pxPerSec + 160, 400)
  const step = tickStep(pxPerSec)
  const ticks: number[] = []
  for (let s = 0; s <= duration; s += step) ticks.push(s)

  const videoClips = clips.filter((c) => c.kind === 'video')
  const audioClips = clips.filter((c) => c.kind === 'audio')

  const zoom = (factor: number): void => {
    setPxPerSec((v) => Math.min(300, Math.max(12, v * factor)))
  }

  /* ---- 歌词线段拖拽：移动 / 边缘微调 ---- */
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
  const selectedClip = clips.find((c) => c.id === selectedClipId)

  if (lines.length === 0 && clips.length === 0) {
    return (
      <div className="timeline empty">
        导入歌词 / 视频 / 音频后，每个素材会成为时间轴上的可编辑线段
      </div>
    )
  }

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <button className="btn btn-sm" onClick={() => useProject.getState().selectAll()}>
          全选
        </button>
        <button
          className="btn btn-sm"
          disabled={selectedIds.length === 0 && selectedClipId === null}
          onClick={() => useProject.getState().clearSelection()}
        >
          取消选择
        </button>
        <span className="hint">
          {selectedClip
            ? `${selectedClip.kind === 'video' ? '背景视频' : '音轨'} · ${selectedClip.name}`
            : selectedIds.length > 0
              ? `已选 ${selectedIds.length} 条 — 可在右侧选择特效，画面中拖动调整位置`
              : '点击线段选中 · Ctrl+点击多选 · 拖动挪时间 · 拖边缘微调'}
        </span>
        {selectedClip && <ClipControls clip={selectedClip} />}
        {selectedLine && !selectedClip && (
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
          {videoClips.length > 0 && (
            <div className="tl-mediatrack">
              {videoClips.map((c) => (
                <ClipSegment key={c.id} clip={c} pxPerSec={pxPerSec} durationMs={durationMs} />
              ))}
            </div>
          )}
          {audioClips.length > 0 && (
            <div className="tl-mediatrack">
              {audioClips.map((c) => (
                <ClipSegment key={c.id} clip={c} pxPerSec={pxPerSec} durationMs={durationMs} />
              ))}
            </div>
          )}
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
