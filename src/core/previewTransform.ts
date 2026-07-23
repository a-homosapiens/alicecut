export interface PreviewPoint {
  x: number
  y: number
}

export interface PreviewViewTransform {
  zoom: number
  panX: number
  panY: number
}

export interface PreviewTextTransform {
  width: number
  height: number
  globalDx: number
  globalDy: number
  globalRotate: number
}

export const MIN_EDITABLE_FONT_SIZE = 8
export const MAX_EDITABLE_FONT_SIZE = 4000
const FONT_SIZE_SLIDER_STEPS = 1000

/** Logarithmic slider mapping keeps both normal and poster-scale sizes usable. */
export function fontSizeToSliderPosition(fontSize: number): number {
  const size = Math.min(MAX_EDITABLE_FONT_SIZE, Math.max(MIN_EDITABLE_FONT_SIZE, fontSize))
  return (Math.log(size / MIN_EDITABLE_FONT_SIZE) / Math.log(MAX_EDITABLE_FONT_SIZE / MIN_EDITABLE_FONT_SIZE)) * FONT_SIZE_SLIDER_STEPS
}

export function sliderPositionToFontSize(position: number): number {
  const p = Math.min(FONT_SIZE_SLIDER_STEPS, Math.max(0, position)) / FONT_SIZE_SLIDER_STEPS
  return Math.round(MIN_EDITABLE_FONT_SIZE * Math.pow(MAX_EDITABLE_FONT_SIZE / MIN_EDITABLE_FONT_SIZE, p))
}

export function documentToPreviewPoint(
  point: PreviewPoint,
  view: PreviewViewTransform,
  text: PreviewTextTransform
): PreviewPoint {
  const cx = text.width / 2
  const cy = text.height / 2
  const rad = (text.globalRotate * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = point.x - cx
  const dy = point.y - cy
  const x = cx + text.globalDx + dx * cos - dy * sin
  const y = cy + text.globalDy + dx * sin + dy * cos
  return { x: x * view.zoom + view.panX, y: y * view.zoom + view.panY }
}

export function previewToDocumentPoint(
  point: PreviewPoint,
  view: PreviewViewTransform,
  text: PreviewTextTransform
): PreviewPoint {
  const transformedX = (point.x - view.panX) / view.zoom
  const transformedY = (point.y - view.panY) / view.zoom
  const cx = text.width / 2
  const cy = text.height / 2
  const dx = transformedX - cx - text.globalDx
  const dy = transformedY - cy - text.globalDy
  const rad = (-text.globalRotate * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

export function previewDeltaToDocument(
  deltaX: number,
  deltaY: number,
  view: PreviewViewTransform,
  text: PreviewTextTransform
): PreviewPoint {
  const x = deltaX / view.zoom
  const y = deltaY / view.zoom
  const rad = (-text.globalRotate * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

export function scaledFontSize(original: number, startDistance: number, currentDistance: number): number {
  if (!Number.isFinite(startDistance) || startDistance <= 0) return Math.round(original)
  const linearRatio = currentDistance / startDistance
  // Keep ordinary resizing predictable, then accelerate growth so the window
  // edge does not become an accidental font-size limit on a fitted canvas.
  const ratio = linearRatio <= 2 ? linearRatio : 2 * Math.exp((currentDistance - startDistance * 2) / 120)
  return Math.round(Math.min(MAX_EDITABLE_FONT_SIZE, Math.max(MIN_EDITABLE_FONT_SIZE, original * ratio)))
}
