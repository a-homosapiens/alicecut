import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useProject, getProjectDuration } from '../store/project'
import { getEffect } from '../core/effects'
import {
  clipEnd,
  clipSegmentMs,
  clipSourceTime,
  videoTransitionList,
  MAX_SPEED,
  MIN_SPEED,
  type MediaClip,
  type VideoTransition
} from '../core/media'
import { seek } from '../playback'
import { useWaveform } from '../waveform'
import { useT, hasMsg } from '../i18n'
import type { LrcLine } from '../core/types'

/** 每种特效的线段配色，便于一眼区分 */
const EFFECT_COLORS: Record<string, string> = {
  pop: '#6366f1',
  punch: '#ef4444',
  slide: '#0ea5e9',
  typewriter: '#10b981',
  glow: '#f59e0b',
  karaoke: '#eab308',
  flip: '#d946ef',
  'flip-bottom': '#a855f7',
  rise: '#14b8a6'
}

const CLIP_COLORS: Record<MediaClip['kind'], string> = {
  video: '#f97316',
  audio: '#22c55e'
}
const TEXT_COLOR = '#eab308'

/** 媒体轨一行的高度（含 4px 间距），竖向拖动换层按它换算 */
const MEDIA_ROW_H = 34
const MAX_LAYER = 4
/** 选中音轨展开后的波形高度（与 CSS .tl-clip-wave 高度保持一致） */
const WAVE_H = 54

/** 时间轴缩放范围 px/秒：下限很小（几乎不限缩小，避免 0 导致除零/退化） */
const ZOOM_MIN = 0.5
const ZOOM_MAX = 300
const clampZoom = (v: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v))

/** 选中音轨内的波形画布：x→源时间（含修剪/循环/变速）→ 峰值，画竖条 */
function ClipWaveform({
  clip,
  pxPerSec,
  durationMs,
  width,
  color
}: {
  clip: MediaClip
  pxPerSec: number
  durationMs: number
  width: number
  color: string
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const peaks = useWaveform(clip.path)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const W = Math.max(1, Math.round(width))
    cv.width = W
    cv.height = WAVE_H
    ctx.clearRect(0, 0, W, WAVE_H)
    if (!peaks) return
    const mid = WAVE_H / 2
    ctx.fillStyle = color
    for (let x = 0; x < W; x++) {
      const tMs = clip.start + (x / pxPerSec) * 1000
      const src = clipSourceTime(clip, tMs, durationMs)
      if (src === null) continue
      const idx = Math.min(peaks.length - 1, Math.max(0, Math.floor((src / clip.sourceDuration) * peaks.length)))
      const h = Math.max(1, peaks[idx] * (WAVE_H - 6))
      ctx.fillRect(x, mid - h / 2, 1, h)
    }
  }, [peaks, width, color, pxPerSec, durationMs, clip.start, clip.sourceIn, clip.sourceOut, clip.speed, clip.loop, clip.sourceDuration])
  return <canvas ref={ref} className="tl-wave" />
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

/** 媒体线段（视频/音频轨）：横向拖动挪起点，视频可竖向拖动换层 */
function ClipSegment({
  clip,
  pxPerSec,
  durationMs
}: {
  clip: MediaClip
  pxPerSec: number
  durationMs: number
}): React.JSX.Element {
  const t = useT()
  const selected = useProject((s) => s.selectedClipId === clip.id)
  const color = CLIP_COLORS[clip.kind]
  const endMs = clipEnd(clip, durationMs)
  const left = (clip.start / 1000) * pxPerSec
  const width = Math.max(((endMs - clip.start) / 1000) * pxPerSec, 14)
  // 循环边界刻线：每圈一道
  const period = (clipSegmentMs(clip) / 1000) * pxPerSec
  const loopMarks =
    (clip.loop === 'infinite' || clip.loop > 1) && period > 6
      ? `repeating-linear-gradient(to right, transparent 0, transparent ${period - 1.5}px, ${color}aa ${period - 1.5}px, ${color}aa ${period}px)`
      : undefined
  const badges: string[] = []
  if (clip.loop === 'infinite') badges.push('∞')
  else if (clip.loop > 1) badges.push(`×${clip.loop}`)
  if (clip.speed !== 1) badges.push(`${clip.speed}x`)

  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    const st = useProject.getState()
    st.setSelectedClip(clip.id)
    const original = { ...clip }
    const startClientX = e.clientX
    const startClientY = e.clientY
    // 点击点对应的时间（线段左缘 = clip.start），纯点击时把播放头移到这里
    const segRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const clickTime = clip.start / 1000 + (e.clientX - segRect.left) / pxPerSec
    let moved = false
    const onMove = (ev: MouseEvent): void => {
      const deltaPx = ev.clientX - startClientX
      const deltaPy = ev.clientY - startClientY
      if (Math.abs(deltaPx) > 3 || Math.abs(deltaPy) > 3) moved = true
      if (!moved) return
      useProject.getState().moveClipFrom(original, (deltaPx / pxPerSec) * 1000)
      // 视频竖向拖换层：界面上层在上方，往上拖 = 层序加大
      if (clip.kind === 'video') {
        const layerDelta = -Math.round(deltaPy / MEDIA_ROW_H)
        const layer = Math.min(MAX_LAYER, Math.max(0, original.layer + layerDelta))
        if (layer !== useProject.getState().clips.find((c) => c.id === clip.id)?.layer) {
          useProject.getState().setClipLayer(clip.id, layer)
        }
      }
    }
    const onUp = (): void => {
      // 纯点击：把播放头移到点击处并刷新画面（拖动过则不跳）
      if (!moved) seek(clickTime)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const showWave = clip.kind === 'audio' && selected

  return (
    <div
      className={`tl-clip${selected ? ' selected' : ''}${showWave ? ' tl-clip-wave' : ''}`}
      style={{
        left,
        width,
        borderColor: color,
        background: `${color}2e`,
        backgroundImage: loopMarks
      }}
      title={`${clip.name}\n${
        clip.kind === 'video' ? `${t('tl.bgVideo')} · ${t('tl.layerN', { n: clip.layer + 1 })}` : t('tl.audioTrack')
      } · ${clip.loop === 'infinite' ? t('tl.loopInfinite') : t('tl.loopN', { n: clip.loop })}${
        clip.speed !== 1 ? ` ${t('tl.speedSuffix', { x: clip.speed })}` : ''
      }${clip.kind === 'video' ? `\n${t('tl.dragVertical')}` : ''}`}
      onMouseDown={onMouseDown}
    >
      {showWave && (
        <ClipWaveform clip={clip} pxPerSec={pxPerSec} durationMs={durationMs} width={width} color={`${color}cc`} />
      )}
      <span className="tl-clip-icon">{clip.kind === 'video' ? '🎬' : '🎵'}</span>
      <span className="tl-seg-text">{clip.name}</span>
      {badges.length > 0 && (
        <span className="tl-clip-loop" style={{ color }}>
          {badges.join(' ')}
        </span>
      )}
    </div>
  )
}

/** 视频转场：进场(transIn)/退场(transOut)。从菜单添加后可选类型与秒数 */
function ClipVideoFx({ clip }: { clip: MediaClip }): React.JSX.Element {
  const t = useT()
  const st = useProject.getState
  const [menuOpen, setMenuOpen] = useState(false)
  // 订阅插件视频转场以触发重渲染；选项来自注册表（内置 + 插件）
  useProject((s) => s.pluginVideoTransitions)
  // 内置转场名按语言翻译（vtrans.<id>）；插件转场回退自带 name
  const options = videoTransitionList().map((o) => ({
    id: o.id,
    name: hasMsg(`vtrans.${o.id}`) ? t(`vtrans.${o.id}` as Parameters<typeof t>[0]) : o.name
  }))

  const add = (which: 'in' | 'out'): void => {
    st().setClipTransition(clip.id, which, { type: 'fade', durationMs: 1000 })
    setMenuOpen(false)
  }

  const chip = (which: 'in' | 'out', trans: VideoTransition): React.JSX.Element => (
    <span className="clip-fx-chip" title={which === 'in' ? t('tl.transInTitle') : t('tl.transOutTitle')}>
      {which === 'in' ? t('tl.enter') : t('tl.leave')}
      <select
        value={trans.type}
        onChange={(e) => st().setClipTransition(clip.id, which, { ...trans, type: e.target.value })}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <input
        type="number"
        step={0.1}
        min={0}
        value={(trans.durationMs / 1000).toFixed(1)}
        onChange={(e) =>
          st().setClipTransition(clip.id, which, { ...trans, durationMs: Math.max(0, Number(e.target.value) * 1000) })
        }
      />
      {t('tl.sec')}
      <button className="clip-fx-x" title={t('tl.removeTrans')} onClick={() => st().setClipTransition(clip.id, which, null)}>
        ✕
      </button>
    </span>
  )

  return (
    <span className="clip-fx">
      <span className="clip-fx-add">
        <button className="btn btn-sm" onClick={() => setMenuOpen((o) => !o)} title={t('tl.addTransTitle')}>
          + {t('tl.transition')} ▾
        </button>
        {menuOpen && (
          <div className="clip-fx-menu">
            <button onClick={() => add('in')} disabled={!!clip.transIn}>
              {t('tl.enterTrans')}
            </button>
            <button onClick={() => add('out')} disabled={!!clip.transOut}>
              {t('tl.leaveTrans')}
            </button>
          </div>
        )}
      </span>
      {clip.transIn && chip('in', clip.transIn)}
      {clip.transOut && chip('out', clip.transOut)}
    </span>
  )
}

/** 音轨特效：淡入(transit in)/淡出(transit out)。从菜单添加后以可编辑「?秒」呈现 */
function ClipAudioFx({ clip }: { clip: MediaClip }): React.JSX.Element {
  const t = useT()
  const st = useProject.getState
  const [menuOpen, setMenuOpen] = useState(false)
  const DEFAULT_MS = 2000

  const add = (which: 'in' | 'out'): void => {
    st().setClipFade(clip.id, which === 'in' ? { in: DEFAULT_MS } : { out: DEFAULT_MS })
    setMenuOpen(false)
  }

  return (
    <span className="clip-fx">
      <span className="clip-fx-add">
        <button className="btn btn-sm" onClick={() => setMenuOpen((o) => !o)} title={t('tl.addFadeTitle')}>
          + {t('tl.fx')} ▾
        </button>
        {menuOpen && (
          <div className="clip-fx-menu">
            <button onClick={() => add('in')} disabled={clip.fadeInMs > 0}>
              {t('tl.fadeIn')}
            </button>
            <button onClick={() => add('out')} disabled={clip.fadeOutMs > 0}>
              {t('tl.fadeOut')}
            </button>
          </div>
        )}
      </span>
      {clip.fadeInMs > 0 && (
        <span className="clip-fx-chip" title={t('tl.fadeInTitle')}>
          {t('tl.fadeIn')}
          <input
            type="number"
            step={0.1}
            min={0}
            value={(clip.fadeInMs / 1000).toFixed(1)}
            onChange={(e) => st().setClipFade(clip.id, { in: Number(e.target.value) * 1000 })}
          />
          {t('tl.sec')}
          <button className="clip-fx-x" title={t('tl.removeFadeIn')} onClick={() => st().setClipFade(clip.id, { in: 0 })}>
            ✕
          </button>
        </span>
      )}
      {clip.fadeOutMs > 0 && (
        <span className="clip-fx-chip" title={t('tl.fadeOutTitle')}>
          {t('tl.fadeOut')}
          <input
            type="number"
            step={0.1}
            min={0}
            value={(clip.fadeOutMs / 1000).toFixed(1)}
            onChange={(e) => st().setClipFade(clip.id, { out: Number(e.target.value) * 1000 })}
          />
          {t('tl.sec')}
          <button className="clip-fx-x" title={t('tl.removeFadeOut')} onClick={() => st().setClipFade(clip.id, { out: 0 })}>
            ✕
          </button>
        </span>
      )}
    </span>
  )
}

/** 选中媒体线段时的工具条控件：切割/起点/循环/速度/提取音频/缩放/删除 */
function ClipControls({ clip }: { clip: MediaClip }): React.JSX.Element {
  const t = useT()
  const st = useProject.getState

  const splitAtPlayhead = (): void => {
    const ok = st().splitClip(clip.id, st().currentTime * 1000)
    if (!ok) alert(t('tl.cantSplit'))
  }

  const extractAudio = async (): Promise<void> => {
    const has = await window.desktop.mediaHasAudio(clip.path)
    if (!has) {
      alert(t('tl.noAudioStream'))
      return
    }
    const audio = st().addClip({
      kind: 'audio',
      path: clip.path,
      name: `${clip.name.replace(/\.[^.]+$/, '')}${t('tl.audioNameSuffix')}`,
      start: clip.start,
      sourceDuration: clip.sourceDuration,
      sourceIn: clip.sourceIn,
      sourceOut: clip.sourceOut,
      speed: clip.speed,
      loop: clip.loop,
      layer: 0,
      tx: 0,
      ty: 0,
      scale: 1
    })
    st().setSelectedClip(audio.id)
  }

  return (
    <span className="tl-times">
      <button className="btn btn-sm" onClick={splitAtPlayhead} title={t('tl.splitTitle')}>
        ✂ {t('tl.splitWord')}
      </button>
      <label>
        {t('tl.start')}
        <input
          type="number"
          step={0.1}
          min={0}
          value={(clip.start / 1000).toFixed(2)}
          onChange={(e) => st().setClipStart(clip.id, Number(e.target.value) * 1000)}
        />
      </label>
      <label>
        {t('tl.loop')}
        <input
          type="number"
          step={1}
          min={1}
          disabled={clip.loop === 'infinite'}
          value={clip.loop === 'infinite' ? '' : clip.loop}
          placeholder="∞"
          onChange={(e) => st().setClipLoop(clip.id, Number(e.target.value))}
        />
        {t('tl.times')}
      </label>
      <label title={t('tl.loopInfiniteTitle')}>
        <input
          type="checkbox"
          checked={clip.loop === 'infinite'}
          onChange={(e) => st().setClipLoop(clip.id, e.target.checked ? 'infinite' : 1)}
        />
        ∞
      </label>
      <label title={t('tl.speedTitle')}>
        {t('tl.speed')} {clip.speed}x
        <input
          type="range"
          min={MIN_SPEED}
          max={MAX_SPEED}
          step={0.25}
          value={clip.speed}
          onChange={(e) => st().setClipSpeed(clip.id, Number(e.target.value))}
        />
      </label>
      {clip.kind === 'video' && (
        <>
          <label className="tl-layer-ctl" title={t('tl.layerTitle')}>
            {t('tl.layer')} {clip.layer + 1}
            <button
              className="btn btn-sm"
              disabled={clip.layer >= MAX_LAYER}
              onClick={() => st().setClipLayer(clip.id, clip.layer + 1)}
              title={t('tl.moveUp')}
            >
              ▲
            </button>
            <button
              className="btn btn-sm"
              disabled={clip.layer <= 0}
              onClick={() => st().setClipLayer(clip.id, clip.layer - 1)}
              title={t('tl.moveDown')}
            >
              ▼
            </button>
          </label>
          <label title={t('tl.scaleTitle')}>
            {t('tl.scale')} {clip.scale.toFixed(2)}
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.05}
              value={clip.scale}
              onChange={(e) => st().setClipScale(clip.id, Number(e.target.value))}
            />
          </label>
          <button className="btn btn-sm" onClick={() => void extractAudio()} title={t('tl.extractAudioTitle')}>
            {t('tl.extractAudio')}
          </button>
          <ClipVideoFx clip={clip} />
        </>
      )}
      {clip.kind === 'audio' && <ClipAudioFx clip={clip} />}
      <button className="btn btn-sm" onClick={() => st().removeClip(clip.id)}>
        {t('tl.delete')}
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
  const pxPerSecRef = useRef(pxPerSec)
  // 缩放后保持光标下时间点不动：记录锚点，待 DOM 用新刻度重排后再校正 scrollLeft
  const zoomAnchorRef = useRef<{ timeAtCursor: number; offsetX: number } | null>(null)

  useEffect(() => {
    pxPerSecRef.current = pxPerSec
  }, [pxPerSec])

  useLayoutEffect(() => {
    const el = scrollRef.current
    const a = zoomAnchorRef.current
    if (el && a) {
      el.scrollLeft = a.timeAtCursor * pxPerSec - a.offsetX
      zoomAnchorRef.current = null
    }
  }, [pxPerSec])

  // 时间轴缩放：滚轮 / 触控板捏合（ctrl+wheel）/ 触屏双指捏合；横向滑动仍走原生滚动。
  // 缩放时把锚点（光标或捏合中心）下的时间点固定，用新刻度重排后由 useLayoutEffect 校正 scrollLeft
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    /** 应用缩放：以容器内 offsetX 处为锚点把 pxPerSec 设为 next */
    const applyZoom = (next: number, offsetX: number): void => {
      const old = pxPerSecRef.current
      if (next === old) return
      zoomAnchorRef.current = { timeAtCursor: (offsetX + el.scrollLeft) / old, offsetX }
      pxPerSecRef.current = next
      setPxPerSec(next)
    }

    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return // 横向滑动：交给原生滚动
      e.preventDefault()
      const offsetX = e.clientX - el.getBoundingClientRect().left
      const k = e.ctrlKey ? 0.012 : 0.0018 // 捏合更灵敏
      applyZoom(clampZoom(pxPerSecRef.current * Math.exp(-e.deltaY * k)), offsetX)
    }

    // 触屏双指捏合：按两指间距比例缩放，锚定捏合中心
    let pinch: { dist: number; base: number; offsetX: number } | null = null
    const touchDist = (t: TouchList): number => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 2) return
      const rect = el.getBoundingClientRect()
      const offsetX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left
      pinch = { dist: touchDist(e.touches), base: pxPerSecRef.current, offsetX }
    }
    const onTouchMove = (e: TouchEvent): void => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const d = touchDist(e.touches)
      if (pinch.dist <= 0) return
      applyZoom(clampZoom(pinch.base * (d / pinch.dist)), pinch.offsetX)
    }
    const onTouchEnd = (e: TouchEvent): void => {
      if (e.touches.length < 2) pinch = null
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
    // 内容从无到有时时间轴才挂载 scrollRef，需在此时重挂监听
  }, [lines.length === 0 && clips.length === 0])

  const duration = getProjectDuration({ lines, clips })
  const durationMs = duration * 1000
  const innerWidth = Math.max(duration * pxPerSec + 160, 400)
  const step = tickStep(pxPerSec)
  const ticks: number[] = []
  for (let s = 0; s <= duration; s += step) ticks.push(s)

  // 视频按层分行（高层在上），最上方再留一条空图层轨作为「叠加新层」的拖放目标
  const videoClips = clips.filter((c) => c.kind === 'video')
  const audioClips = clips.filter((c) => c.kind === 'audio')
  const maxVideoLayer = videoClips.reduce((m, c) => Math.max(m, c.layer), 0)
  const videoRows: { layer: number; clips: MediaClip[] }[] = []
  if (videoClips.length > 0) {
    const top = Math.min(MAX_LAYER, maxVideoLayer + 1) // 顶部空轨
    for (let l = top; l >= 0; l--) {
      videoRows.push({ layer: l, clips: videoClips.filter((c) => c.layer === l) })
    }
  }
  const lyricLines = lines.filter((l) => l.kind !== 'text')
  const textBlocks = lines.filter((l) => l.kind === 'text')

  const zoom = (factor: number): void => {
    setPxPerSec((v) => clampZoom(v * factor))
  }

  const addAtPlayhead = (kind: 'lyric' | 'text'): void => {
    const st = useProject.getState()
    st.addLineAt(st.currentTime * 1000, kind)
  }

  /* ---- 歌词/文字线段拖拽：移动 / 边缘微调 ---- */
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

  /** 按下后拖动连续移动播放头；clearSel 决定是否同时清除选区 */
  const startScrub = (e: React.MouseEvent, clearSel: boolean): void => {
    if (e.button !== 0) return
    const el = scrollRef.current
    if (!el) return
    if (clearSel) useProject.getState().clearSelection()
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

  /* 空白轨道：定位播放头并清除选区（点空白 = 取消选择） */
  const onTrackMouseDown = (e: React.MouseEvent): void => startScrub(e, true)
  /* 顶部刻度尺：定位播放头但保留选区（选中线段后仍可在此挪红轴，便于切割等） */
  const onRulerMouseDown = (e: React.MouseEvent): void => {
    e.stopPropagation()
    startScrub(e, false)
  }

  const renderLineSegment = (line: LrcLine): React.JSX.Element => {
    const isText = line.kind === 'text'
    const effId = line.effectId ?? globalEffectId
    const color = isText ? TEXT_COLOR : (EFFECT_COLORS[effId] ?? '#6366f1')
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
        <div className="tl-handle l" onMouseDown={(e) => onSegmentMouseDown(e, line, 'trim-l')} />
        <span className="tl-seg-text">
          {isText ? `📝 ${line.text}` : line.text || '（间奏）'}
        </span>
        <span className="tl-seg-fx" style={{ color }}>
          {getEffect(effId).name}
        </span>
        <div className="tl-handle r" onMouseDown={(e) => onSegmentMouseDown(e, line, 'trim-r')} />
      </div>
    )
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
        <button className="btn btn-sm" onClick={() => addAtPlayhead('lyric')} title="在播放头处加一句字幕（2 秒，双击左侧列表改文字）">
          + 字幕
        </button>
        <button className="btn btn-sm" onClick={() => addAtPlayhead('text')} title="在播放头处加一块独立文字（3 秒，可选特效，不参与歌词流）">
          + 文字
        </button>
        {selectedIds.length > 0 && (
          <button
            className="btn btn-sm"
            onClick={() => useProject.getState().removeLines(useProject.getState().selectedIds)}
            title="删除选中的字幕/文字（Delete 键同效）"
          >
            删除选中
          </button>
        )}
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
          <div className="tl-ruler" onMouseDown={onRulerMouseDown}>
            {ticks.map((s) => (
              <span key={s} className="tl-tick" style={{ left: s * pxPerSec }}>
                {fmt(s)}
              </span>
            ))}
          </div>
          {videoRows.map((row) => (
            <div
              className={`tl-mediatrack tl-videolayer${row.clips.length === 0 ? ' empty' : ''}`}
              key={`v${row.layer}`}
            >
              <span className="tl-layer-label">
                {row.clips.length === 0 ? `图层 ${row.layer + 1}（拖视频到此叠加）` : `图层 ${row.layer + 1}`}
              </span>
              {row.clips.map((c) => (
                <ClipSegment key={c.id} clip={c} pxPerSec={pxPerSec} durationMs={durationMs} />
              ))}
            </div>
          ))}
          {audioClips.length > 0 && (
            <div className={`tl-mediatrack tl-audiotrack${selectedClip?.kind === 'audio' ? ' expanded' : ''}`}>
              {audioClips.map((c) => (
                <ClipSegment key={c.id} clip={c} pxPerSec={pxPerSec} durationMs={durationMs} />
              ))}
            </div>
          )}
          {textBlocks.length > 0 && (
            <div className="tl-texttrack">{textBlocks.map(renderLineSegment)}</div>
          )}
          <div className="tl-track">{lyricLines.map(renderLineSegment)}</div>
          <Playhead pxPerSec={pxPerSec} scrollRef={scrollRef} />
        </div>
      </div>
    </div>
  )
}
