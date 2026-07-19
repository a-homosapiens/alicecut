import { useCallback, useEffect, useRef, useState } from 'react'
import { useProject, toRenderStyle, getProjectDuration, allCaptionTracks } from '../store/project'
import { renderFrame, getLineBlockRect, applyGlobalTextTransform } from '../core/render'
import { drawBackgroundImage, drawVideoBackdrop, getClipDrawRect, type ClipRect } from '../mediaPool'
import { getTime, tick } from '../playback'
import { useT } from '../i18n'

/**
 * 视图模型（仿 Photoshop / Inkscape）：
 * - 视口 viewport = 画布元素本身，铺满面板，尺寸随面板走（与文档比例无关）
 * - 文档 artboard = 输出画面（W×H），画成带阴影的矩形
 * - 画板 pasteboard = artboard 周围的灰色无限区域，溢出内容（超大视频）显示于此
 * 单一视图变换 (zoom, panX, panY) 把文档坐标映射到视口 CSS 像素：vx = x*zoom + panX
 */
interface View {
  zoom: number
  panX: number
  panY: number
}

const MIN_ZOOM = 0.05
const MAX_ZOOM = 8
const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

/** 文档坐标 → 视口 CSS 坐标 */
const toView = (v: View, x: number, y: number): [number, number] => [
  x * v.zoom + v.panX,
  y * v.zoom + v.panY
]

/** 让文档矩形(0,0,W,H)居中铺满视口（留边） */
function fitView(W: number, H: number, cssW: number, cssH: number, margin = 0.94): View {
  const zoom = clampZoom(Math.min(cssW / W, cssH / H) * margin)
  return { zoom, panX: (cssW - W * zoom) / 2, panY: (cssH - H * zoom) / 2 }
}

/** 选中物件的边框 + 四角把手（视口 CSS 坐标，线宽固定） */
function drawFrame(ctx: CanvasRenderingContext2D, r: ClipRect, color: string): void {
  const s = 9
  ctx.save()
  ctx.setLineDash([])
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.strokeRect(r.x, r.y, r.w, r.h)
  ctx.fillStyle = color
  for (const [cx, cy] of [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h]
  ]) {
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s)
  }
  ctx.restore()
}

/** 选中歌词/文字的虚线框（映射到视口坐标） */
function drawTextSelection(ctx: CanvasRenderingContext2D, view: View, tMs: number): void {
  const st = useProject.getState()
  if (st.selectedIds.length === 0) return
  const style = toRenderStyle(st.style)
  const sel = new Set(st.selectedIds)
  const offsetById = new Map(allCaptionTracks(st).map((t) => [t.id, t.offsetY]))
  ctx.save()
  // 与文字同一坐标系（含视图变换 + 全局文字变换），框随旋转/平移一起动
  ctx.translate(view.panX, view.panY)
  ctx.scale(view.zoom, view.zoom)
  applyGlobalTextTransform(ctx, style)
  ctx.strokeStyle = '#818cf8'
  ctx.lineWidth = 2 / view.zoom
  ctx.setLineDash([10 / view.zoom, 6 / view.zoom])
  for (const line of st.lines) {
    if (!sel.has(line.id)) continue
    if (tMs < line.start || tMs >= line.end) continue
    const r = getLineBlockRect(ctx, line, style, offsetById.get(line.trackId ?? 0) ?? 0)
    if (!r) continue
    const pad = style.fontSize * 0.25
    ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2)
  }
  ctx.restore()
}

/** 预览：视口铺满面板，文档(artboard)按视图变换绘制，周围是灰色画板(pasteboard) */
export function PreviewCanvas(): React.JSX.Element {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const aspect = useProject((s) => s.style.aspect)
  const hasSelection = useProject(
    (s) =>
      s.selectedIds.length > 0 ||
      s.clips.some((c) => c.id === s.selectedClipId && c.kind === 'video')
  )

  const [zoomPct, setZoomPct] = useState(100)
  const viewRef = useRef<View>({ zoom: 1, panX: 0, panY: 0 })
  const selRectRef = useRef<ClipRect | null>(null)
  // 拖动文字时的画面中心参考线 + 是否已吸附
  const centerGuideRef = useRef<{ active: boolean; snapX: boolean; snapY: boolean }>({
    active: false,
    snapX: false,
    snapY: false
  })
  // 视口 CSS 尺寸（每帧刷新，供交互换算）
  const sizeRef = useRef({ w: 0, h: 0 })
  // 需要重新适配（首帧 / 切换比例）
  const refitRef = useRef(true)

  const setView = useCallback((v: View): void => {
    viewRef.current = v
    setZoomPct(Math.round(v.zoom * 100))
  }, [])

  // 切换画面比例时重新适配
  useEffect(() => {
    refitRef.current = true
  }, [aspect])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    const loop = (): void => {
      const st = useProject.getState()
      if (!st.exporting) {
        tick()
        const style = toRenderStyle(st.style)
        const trackPlacements = allCaptionTracks(st)
        const W = style.width
        const H = style.height
        const dpr = window.devicePixelRatio || 1
        const cssW = canvas.clientWidth
        const cssH = canvas.clientHeight
        sizeRef.current = { w: cssW, h: cssH }
        if (canvas.width !== Math.round(cssW * dpr)) canvas.width = Math.round(cssW * dpr)
        if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr)

        if (refitRef.current && cssW > 0) {
          refitRef.current = false
          setView(fitView(W, H, cssW, cssH))
        }
        const view = viewRef.current

        const tMs = getTime() * 1000
        const endMs = getProjectDuration(st) * 1000
        const drawBackdrop = (c: CanvasRenderingContext2D): void => {
          if (style.bgType === 'image' && style.bgImage)
            drawBackgroundImage(c, style.bgImage, W, H, style.bgImageScale, style.bgImageX, style.bgImageY)
          drawVideoBackdrop(c, st.clips, tMs, endMs, W, H)
        }

        const editVideo = !st.playing
          ? st.clips.find((c) => c.id === st.selectedClipId && c.kind === 'video')
          : undefined
        selRectRef.current = editVideo ? getClipDrawRect(editVideo, W, H) : null

        // 以 CSS 像素为工作坐标（dpr 只作用于底层缓冲清晰度）
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = '#15151a' // pasteboard
        ctx.fillRect(0, 0, cssW, cssH)

        const [ax, ay] = toView(view, 0, 0)
        const aw = W * view.zoom
        const ah = H * view.zoom

        // artboard 阴影
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.45)'
        ctx.shadowBlur = 24
        ctx.shadowOffsetY = 6
        ctx.fillStyle = '#000'
        ctx.fillRect(ax, ay, aw, ah)
        ctx.restore()

        const applyView = (): void => {
          ctx.translate(view.panX, view.panY)
          ctx.scale(view.zoom, view.zoom)
        }

        // 编辑视频时：先画一层暗淡的完整合成（含溢出 artboard 的部分，像 PS 自由变换）
        if (editVideo) {
          ctx.save()
          applyView()
          ctx.globalAlpha = 0.3
          renderFrame(ctx, st.lines, st.meta, style, tMs, drawBackdrop, { tracks: trackPlacements })
          ctx.restore()
        }

        // 不透明的最终合成，裁剪到 artboard（= 实际导出范围）
        ctx.save()
        ctx.beginPath()
        ctx.rect(ax, ay, aw, ah)
        ctx.clip()
        applyView()
        renderFrame(ctx, st.lines, st.meta, style, tMs, drawBackdrop, { tracks: trackPlacements })
        ctx.restore()

        // artboard 边框
        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,0.28)'
        ctx.lineWidth = 1
        ctx.strokeRect(ax, ay, aw, ah)
        ctx.restore()

        // 选中标记
        const r = selRectRef.current
        if (editVideo && r) {
          const [vx, vy] = toView(view, r.x, r.y)
          drawFrame(ctx, { x: vx, y: vy, w: r.w * view.zoom, h: r.h * view.zoom }, '#f97316')
        } else if (!editVideo) {
          drawTextSelection(ctx, view, tMs)
        }

        // 拖动文字时的画面中心参考线（吸附时高亮）
        const g = centerGuideRef.current
        if (g.active) {
          const [gcx, gcy] = toView(view, W / 2, H / 2)
          ctx.save()
          ctx.lineWidth = 1
          ctx.strokeStyle = g.snapX ? '#22d3ee' : 'rgba(34,211,238,0.4)'
          ctx.beginPath()
          ctx.moveTo(gcx, ay)
          ctx.lineTo(gcx, ay + ah)
          ctx.stroke()
          ctx.strokeStyle = g.snapY ? '#22d3ee' : 'rgba(34,211,238,0.4)'
          ctx.beginPath()
          ctx.moveTo(ax, gcy)
          ctx.lineTo(ax + aw, gcy)
          ctx.stroke()
          ctx.restore()
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [setView])

  /** 围绕视口某点缩放 */
  const zoomAt = useCallback(
    (cssX: number, cssY: number, factor: number): void => {
      const v = viewRef.current
      const z = clampZoom(v.zoom * factor)
      if (z === v.zoom) return
      const docX = (cssX - v.panX) / v.zoom
      const docY = (cssY - v.panY) / v.zoom
      setView({ zoom: z, panX: cssX - docX * z, panY: cssY - docY * z })
    },
    [setView]
  )

  // 滚轮 / 触控板：Ctrl 或捏合 = 缩放（围绕光标）；否则两指滑动 = 平移
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      if (e.ctrlKey) {
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.01))
      } else {
        const v = viewRef.current
        setView({ ...v, panX: v.panX - e.deltaX, panY: v.panY - e.deltaY })
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [setView, zoomAt])

  /** 屏幕坐标 → 视口 CSS 坐标 */
  const toCssPoint = (clientX: number, clientY: number): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return [clientX - rect.left, clientY - rect.top]
  }

  const startPan = (e: React.MouseEvent): void => {
    const v0 = viewRef.current
    const sx = e.clientX
    const sy = e.clientY
    const onMove = (ev: MouseEvent): void => {
      setView({ ...viewRef.current, panX: v0.panX + (ev.clientX - sx), panY: v0.panY + (ev.clientY - sy) })
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /** 左键：命中选中物件→编辑；否则平移。中键/空格→始终平移 */
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const st = useProject.getState()
    // 中键 = 平移
    if (e.button === 1) {
      e.preventDefault()
      startPan(e)
      return
    }
    if (e.button !== 0) return
    const view = viewRef.current
    const [px, py] = toCssPoint(e.clientX, e.clientY)

    const selClip = !st.playing ? st.clips.find((c) => c.id === st.selectedClipId) : undefined
    if (selClip && selClip.kind === 'video') {
      const rect = selRectRef.current
      // 命中四角把手 → 等比缩放（围绕视频中心，恒为 W/2+tx, H/2+ty）
      if (rect) {
        const hit = 14
        const corners: [number, number][] = [
          [rect.x, rect.y],
          [rect.x + rect.w, rect.y],
          [rect.x, rect.y + rect.h],
          [rect.x + rect.w, rect.y + rect.h]
        ]
        const onCorner = corners.some(([ox, oy]) => {
          const [cx, cy] = toView(view, ox, oy)
          return Math.hypot(px - cx, py - cy) < hit
        })
        if (onCorner) {
          const style = toRenderStyle(st.style)
          const [ccx, ccy] = toView(view, style.width / 2 + selClip.tx, style.height / 2 + selClip.ty)
          const startDist = Math.max(1, Math.hypot(px - ccx, py - ccy))
          const origScale = selClip.scale
          const id = selClip.id
          const onMove = (ev: MouseEvent): void => {
            const [mx, my] = toCssPoint(ev.clientX, ev.clientY)
            useProject.getState().setClipScale(id, origScale * (Math.hypot(mx - ccx, my - ccy) / startDist))
          }
          const onUp = (): void => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
          return
        }
      }
      // 命中视频内部 → 平移画面；否则平移视图
      if (rect && px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h) {
        const original = { id: selClip.id, tx: selClip.tx, ty: selClip.ty }
        const sx = e.clientX
        const sy = e.clientY
        const onMove = (ev: MouseEvent): void => {
          useProject
            .getState()
            .setClipTransformFrom(original, (ev.clientX - sx) / view.zoom, (ev.clientY - sy) / view.zoom)
        }
        const onUp = (): void => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return
      }
      startPan(e)
      return
    }

    // 选中字幕/文字：拖动平移文字位置；未选中：平移视图
    if (selClip || st.selectedIds.length === 0) {
      startPan(e)
      return
    }
    const sel = new Set(st.selectedIds)
    const originals = st.lines
      .filter((l) => sel.has(l.id))
      .map((l) => ({ id: l.id, dx: l.dx, dy: l.dy }))
    const sx = e.clientX
    const sy = e.clientY

    // 以首个选中行为吸附基准：算出它在偏移=0 时的块中心（中心+偏移 = 该行所属字幕组的中心 → 居中）
    const style = toRenderStyle(st.style)
    const ctx = canvasRef.current?.getContext('2d')
    const primary = st.lines.find((l) => sel.has(l.id))
    const primaryOffsetY = primary
      ? (allCaptionTracks(st).find((t) => t.id === (primary.trackId ?? 0))?.offsetY ?? 0)
      : 0
    const rect = ctx && primary ? getLineBlockRect(ctx, primary, style, primaryOffsetY) : null
    const baseCx = rect && primary ? rect.x + rect.w / 2 - primary.dx : null
    const baseCy = rect && primary ? rect.y + rect.h / 2 - primary.dy : null
    const targetCy = style.height / 2 + primaryOffsetY
    const snapDoc = 8 / view.zoom // 屏幕约 8px 内吸附
    const p0dx = primary?.dx ?? 0
    const p0dy = primary?.dy ?? 0
    centerGuideRef.current = { active: true, snapX: false, snapY: false }

    const onMove = (ev: MouseEvent): void => {
      let ddx = (ev.clientX - sx) / view.zoom
      let ddy = (ev.clientY - sy) / view.zoom
      let snapX = false
      let snapY = false
      if (baseCx !== null && Math.abs(baseCx + p0dx + ddx - style.width / 2) < snapDoc) {
        ddx = style.width / 2 - baseCx - p0dx // 让首行中心吸到画面中心
        snapX = true
      }
      if (baseCy !== null && Math.abs(baseCy + p0dy + ddy - targetCy) < snapDoc) {
        ddy = targetCy - baseCy - p0dy // 吸到该行所属字幕组的纵向中心（主字幕组即画面中心）
        snapY = true
      }
      centerGuideRef.current = { active: true, snapX, snapY }
      useProject.getState().setLineOffsetsFrom(originals, ddx, ddy)
    }
    const onUp = (): void => {
      centerGuideRef.current = { active: false, snapX: false, snapY: false }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const zoomButton = (factor: number): void => {
    const { w, h } = sizeRef.current
    zoomAt(w / 2, h / 2, factor)
  }

  /** 适配：选中视频则框全视频，否则铺满 artboard */
  const fitToContent = (): void => {
    const { w, h } = sizeRef.current
    const st = useProject.getState()
    const style = toRenderStyle(st.style)
    const clip = st.clips.find((c) => c.id === st.selectedClipId && c.kind === 'video')
    const r = clip ? getClipDrawRect(clip, style.width, style.height) : null
    if (r) {
      const minX = Math.min(0, r.x)
      const minY = Math.min(0, r.y)
      const uw = Math.max(style.width, r.x + r.w) - minX
      const uh = Math.max(style.height, r.y + r.h) - minY
      const zoom = clampZoom(Math.min(w / uw, h / uh) * 0.9)
      setView({ zoom, panX: (w - uw * zoom) / 2 - minX * zoom, panY: (h - uh * zoom) / 2 - minY * zoom })
    } else {
      setView(fitView(style.width, style.height, w, h))
    }
  }

  return (
    <div className="preview-wrap">
      <canvas
        ref={canvasRef}
        className="preview-canvas"
        style={{ cursor: hasSelection ? 'move' : 'default' }}
        onMouseDown={onMouseDown}
      />
      <div className="preview-zoom" title={t('preview.zoomHint')}>
        <button className="btn btn-sm" onClick={() => zoomButton(1 / 1.2)}>
          −
        </button>
        <span className="zoom-val">{zoomPct}%</span>
        <button className="btn btn-sm" onClick={() => zoomButton(1.2)}>
          +
        </button>
        <button className="btn btn-sm" onClick={fitToContent} title={t('preview.fitTitle')}>
          {t('preview.fit')}
        </button>
      </div>
    </div>
  )
}
