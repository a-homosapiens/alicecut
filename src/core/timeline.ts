/** Convert a horizontal click inside a timeline segment to project time. */
export function segmentClickTimeSec(
  startMs: number,
  endMs: number,
  clientX: number,
  segmentLeftPx: number,
  pxPerSec: number
): number {
  if (!Number.isFinite(pxPerSec) || pxPerSec <= 0) return startMs / 1000

  const clickedMs = startMs + ((clientX - segmentLeftPx) / pxPerSec) * 1000
  return Math.min(endMs, Math.max(startMs, clickedMs)) / 1000
}

/** Layers to render, lowest first (layer 0 on top); optionally add one empty drop target below them (at the bottom). */
export function visibleTimelineLayers(occupiedLayers: number[], showExtraDropLayer: boolean, maxLayer: number): number[] {
  if (occupiedLayers.length === 0) return []

  const highestOccupied = Math.min(maxLayer, Math.max(0, ...occupiedLayers))
  const highestVisible = showExtraDropLayer ? Math.min(maxLayer, highestOccupied + 1) : highestOccupied
  return Array.from({ length: highestVisible + 1 }, (_, index) => index)
}
