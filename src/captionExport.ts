import type { CaptionTrack, LrcLine } from './core/types'
import { serializeSrt } from './core/subtitles'

export interface CaptionExportDocument {
  srt: string
  defaultName: string
  cueCount: number
}

export function captionLinesForTrack(lines: readonly LrcLine[], trackId: number): LrcLine[] {
  return lines.filter((line) => line.kind !== 'text' && (line.trackId ?? 0) === trackId)
}

export function nonEmptyCaptionTracks(lines: readonly LrcLine[], tracks: readonly CaptionTrack[]): CaptionTrack[] {
  const populated = new Set(
    lines
      .filter((line) => line.kind !== 'text' && line.text.trim().length > 0)
      .map((line) => line.trackId ?? 0)
  )
  return tracks.filter((track) => populated.has(track.id))
}

export function preferredCaptionTrackId(
  lines: readonly LrcLine[],
  tracks: readonly CaptionTrack[],
  selectedIds: readonly number[]
): number | null {
  const available = new Set(tracks.map((track) => track.id))
  const selected = new Set(
    lines
      .filter((line) => line.kind !== 'text' && selectedIds.includes(line.id))
      .map((line) => line.trackId ?? 0)
  )
  if (selected.size === 1) {
    const id = [...selected][0]
    if (available.has(id)) return id
  }
  return tracks[0]?.id ?? null
}

function safeCaptionFileName(track: CaptionTrack, fallback: string): string {
  const source = track.name.trim() || track.lrcName || fallback
  const withoutCaptionExtension = source.replace(/\.(?:lrc|srt|vtt|txt)$/i, '')
  const safe = withoutCaptionExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
  const safeFallback = fallback.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'subtitles'
  return `${safe || safeFallback}.srt`
}

/** Build an SRT from the supplied live project lines, never from the originally imported file. */
export function buildCaptionExport(
  lines: readonly LrcLine[],
  track: CaptionTrack,
  fallbackName: string
): CaptionExportDocument | null {
  const currentLines = captionLinesForTrack(lines, track.id)
  const srt = serializeSrt(currentLines)
  if (!srt) return null
  return {
    srt,
    defaultName: safeCaptionFileName(track, fallbackName),
    cueCount: currentLines.filter((line) => line.text.trim().length > 0).length
  }
}
