import { describe, expect, it } from 'vitest'
import {
  documentToPreviewPoint,
  fontSizeToSliderPosition,
  previewDeltaToDocument,
  previewToDocumentPoint,
  scaledFontSize,
  sliderPositionToFontSize
} from './previewTransform'

const view = { zoom: 0.5, panX: 20, panY: 30 }
const text = { width: 1080, height: 1920, globalDx: 40, globalDy: -20, globalRotate: 30 }

describe('preview text transforms', () => {
  it('round-trips points through view and global text transforms', () => {
    const source = { x: 370, y: 880 }
    const preview = documentToPreviewPoint(source, view, text)
    const restored = previewToDocumentPoint(preview, view, text)
    expect(restored.x).toBeCloseTo(source.x)
    expect(restored.y).toBeCloseTo(source.y)
  })

  it('converts screen drag deltas back through zoom and rotation', () => {
    const delta = previewDeltaToDocument(50, 0, view, { ...text, globalRotate: 90 })
    expect(delta.x).toBeCloseTo(0)
    expect(delta.y).toBeCloseTo(-100)
  })
})

describe('scaledFontSize', () => {
  it('scales proportionally and clamps to editable limits', () => {
    expect(scaledFontSize(80, 100, 150)).toBe(120)
    expect(scaledFontSize(80, 100, 1)).toBe(8)
    expect(scaledFontSize(400, 100, 200)).toBe(800)
    expect(scaledFontSize(80, 100, 500)).toBeGreaterThan(1900)
    expect(scaledFontSize(1000, 100, 1000)).toBe(4000)
  })

  it('maps the full font-size range to a usable logarithmic slider', () => {
    expect(sliderPositionToFontSize(0)).toBe(8)
    expect(sliderPositionToFontSize(1000)).toBe(4000)
    expect(sliderPositionToFontSize(fontSizeToSliderPosition(88))).toBeCloseTo(88, 0)
  })
})
