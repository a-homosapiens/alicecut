import { useEffect, useRef } from 'react'
import { useProject, toRenderStyle, RESOLUTIONS } from '../store/project'
import { renderFrame, getLineBlockRect } from '../core/render'
import { getTime, tick } from '../playback'

/** 选中行编辑框（虚线框 + 角标），只画在预览上，不进导出 */
function drawSelectionOverlay(ctx: CanvasRenderingContext2D, tMs: number): void {
  const st = useProject.getState()
  if (st.selectedIds.length === 0 || st.playing) return
  const style = toRenderStyle(st.style)
  const sel = new Set(st.selectedIds)
  ctx.save()
  ctx.strokeStyle = '#818cf8'
  ctx.lineWidth = Math.max(2, style.width / 450)
  ctx.setLineDash([12, 8])
  for (const line of st.lines) {
    if (!sel.has(line.id)) continue
    // 只框当前时间点可见的行，拖动才有所见即所得
    if (tMs < line.start || tMs >= line.end) continue
    const r = getLineBlockRect(ctx, line, style)
    if (!r) continue
    const pad = style.fontSize * 0.25
    ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2)
  }
  ctx.restore()
}

/** 预览画布：内部分辨率 = 项目分辨率，CSS 缩放适配窗口；rAF 驱动渲染 */
export function PreviewCanvas(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const aspect = useProject((s) => s.style.aspect)
  const hasSelection = useProject((s) => s.selectedIds.length > 0)
  const res = RESOLUTIONS[aspect]

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
        if (canvas.width !== style.width) canvas.width = style.width
        if (canvas.height !== style.height) canvas.height = style.height
        const tMs = getTime() * 1000
        renderFrame(ctx, st.lines, st.meta, style, tMs)
        drawSelectionOverlay(ctx, tMs)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  /** 选中状态下在画布上拖拽 = 平移选中行的画面位置 */
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return
    const st = useProject.getState()
    if (st.selectedIds.length === 0 || st.playing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const startX = e.clientX
    const startY = e.clientY
    const sel = new Set(st.selectedIds)
    const originals = st.lines
      .filter((l) => sel.has(l.id))
      .map((l) => ({ id: l.id, dx: l.dx, dy: l.dy }))

    const onMove = (ev: MouseEvent): void => {
      useProject
        .getState()
        .setLineOffsetsFrom(originals, (ev.clientX - startX) * scaleX, (ev.clientY - startY) * scaleY)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="preview-wrap">
      <canvas
        ref={canvasRef}
        className="preview-canvas"
        width={res.width}
        height={res.height}
        style={{ aspectRatio: `${res.width} / ${res.height}`, cursor: hasSelection ? 'move' : 'default' }}
        onMouseDown={onMouseDown}
      />
    </div>
  )
}
