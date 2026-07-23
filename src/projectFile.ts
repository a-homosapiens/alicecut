import { useProject } from './store/project'
import type { CaptionTrack, ImageAsset, LrcLine, LrcMeta } from './core/types'
import type { MediaClip } from './core/media'
import type { StyleState } from './store/project'

type State = ReturnType<typeof useProject.getState>

export interface ProjectFileData {
  version: number
  meta: LrcMeta
  lines: LrcLine[]
  style: StyleState
  lrcName: string | null
  tracks: CaptionTrack[]
  images: ImageAsset[]
  clips: (Partial<MediaClip> & Pick<MediaClip, 'kind' | 'path' | 'name' | 'start' | 'sourceDuration'>)[]
  projectDurationSec: number | null
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function finite(value: unknown, label: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}

function parseMeta(value: unknown, label: string): LrcMeta {
  const raw = value === undefined ? {} : record(value, label)
  const meta: LrcMeta = { offset: finite(raw.offset, `${label}.offset`, 0) }
  for (const key of ['title', 'artist', 'album'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') throw new Error(`${label}.${key} must be a string`)
    if (typeof raw[key] === 'string') meta[key] = raw[key]
  }
  return meta
}

/** Validate the complete file before the live editor is mutated. */
export function parseProjectData(value: unknown): ProjectFileData {
  const root = record(value, 'project')
  const version = root.version === undefined ? 1 : finite(root.version, 'version')
  if (!Number.isInteger(version) || version < 1 || version > 6) {
    throw new Error(`Unsupported project version: ${String(root.version)}`)
  }
  if (!Array.isArray(root.lines)) throw new Error('lines must be an array')
  const lines = root.lines.map((raw, index) => {
    const line = record(raw, `lines[${index}]`)
    const id = finite(line.id, `lines[${index}].id`)
    const start = finite(line.start, `lines[${index}].start`)
    const end = finite(line.end, `lines[${index}].end`)
    if (!Number.isInteger(id) || start < 0 || end <= start || typeof line.text !== 'string' || !Array.isArray(line.words)) {
      throw new Error(`Invalid caption at lines[${index}]`)
    }
    if (line.kind !== undefined && line.kind !== 'text') throw new Error(`Invalid kind at lines[${index}]`)
    const words = line.words.map((rawWord, wordIndex) => {
      const word = record(rawWord, `lines[${index}].words[${wordIndex}]`)
      if (typeof word.text !== 'string' || !Array.isArray(word.chars) || (word.leading !== undefined && typeof word.leading !== 'string')) throw new Error(`Invalid word at lines[${index}].words[${wordIndex}]`)
      const wordStart = finite(word.start, `lines[${index}].words[${wordIndex}].start`)
      const wordEnd = finite(word.end, `lines[${index}].words[${wordIndex}].end`)
      if (wordEnd < wordStart) throw new Error(`Invalid word timing at lines[${index}].words[${wordIndex}]`)
      const chars = word.chars.map((rawChar, charIndex) => {
        const char = record(rawChar, `lines[${index}].words[${wordIndex}].chars[${charIndex}]`)
        if (typeof char.text !== 'string') throw new Error(`Invalid character at lines[${index}].words[${wordIndex}].chars[${charIndex}]`)
        const charStart = finite(char.start, `lines[${index}].words[${wordIndex}].chars[${charIndex}].start`)
        const charEnd = finite(char.end, `lines[${index}].words[${wordIndex}].chars[${charIndex}].end`)
        if (charEnd < charStart) throw new Error(`Invalid character timing at lines[${index}].words[${wordIndex}].chars[${charIndex}]`)
        return char
      })
      return { ...word, start: wordStart, end: wordEnd, chars }
    })
    return { ...line, id, start, end, words } as unknown as LrcLine
  })
  const meta = parseMeta(root.meta, 'meta')
  const style = record(root.style, 'style') as unknown as StyleState
  const trackValues = (root.tracks ?? [])
  const imageValues = (root.images ?? [])
  if (!Array.isArray(trackValues) || !Array.isArray(imageValues)) throw new Error('tracks and images must be arrays')
  const tracks = trackValues.map((raw, index) => {
    const track = record(raw, `tracks[${index}]`)
    const id = finite(track.id, `tracks[${index}].id`)
    if (!Number.isInteger(id) || id < 1) throw new Error(`Invalid track id at tracks[${index}]`)
    return {
      id,
      name: typeof track.name === 'string' ? track.name : '',
      lrcName: typeof track.lrcName === 'string' ? track.lrcName : null,
      meta: parseMeta(track.meta, `tracks[${index}].meta`),
      offsetY: finite(track.offsetY, `tracks[${index}].offsetY`, 0),
      visible: typeof track.visible === 'boolean' ? track.visible : true
    } as CaptionTrack
  })
  const images = imageValues.map((raw, index) => {
    const image = record(raw, `images[${index}]`)
    const id = finite(image.id, `images[${index}].id`)
    if (!Number.isInteger(id) || typeof image.path !== 'string' || !image.path) throw new Error(`Invalid image at images[${index}]`)
    return { id, path: image.path, name: typeof image.name === 'string' ? image.name : image.path } as ImageAsset
  })

  let clipValues: unknown[] = []
  if (Array.isArray(root.clips)) clipValues = root.clips
  else if (typeof root.audioPath === 'string') {
    clipValues = [{ kind: 'audio', path: root.audioPath, name: root.audioPath, start: 0, sourceDuration: 0 }]
  } else if (root.clips !== undefined) throw new Error('clips must be an array')
  const clips = clipValues.map((raw, index) => {
    const clip = record(raw, `clips[${index}]`)
    if ((clip.kind !== 'audio' && clip.kind !== 'video') || typeof clip.path !== 'string' || !clip.path) {
      throw new Error(`Invalid media at clips[${index}]`)
    }
    for (const key of ['sourceIn', 'sourceOut', 'speed', 'layer', 'tx', 'ty', 'scale', 'rotate', 'fadeInMs', 'fadeOutMs', 'volume'] as const) {
      if (clip[key] !== undefined && (typeof clip[key] !== 'number' || !Number.isFinite(clip[key]))) {
        throw new Error(`clips[${index}].${key} must be a finite number`)
      }
    }
    return {
      ...clip,
      kind: clip.kind,
      path: clip.path,
      name: typeof clip.name === 'string' ? clip.name : clip.path,
      sourcePath: typeof clip.sourcePath === 'string' ? clip.sourcePath : clip.path,
      offline: clip.offline === true,
      start: finite(clip.start, `clips[${index}].start`, 0),
      sourceDuration: finite(clip.sourceDuration, `clips[${index}].sourceDuration`, 0)
    } as ProjectFileData['clips'][number]
  })
  const duration = root.projectDurationSec
  if (duration !== undefined && duration !== null && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0)) {
    throw new Error('projectDurationSec must be a positive finite number')
  }
  return {
    version,
    meta,
    lines,
    style,
    lrcName: typeof root.lrcName === 'string' ? root.lrcName : null,
    tracks,
    images,
    clips,
    projectDurationSec: duration == null ? null : duration
  }
}

/** Build the portable project-file structure; runtime clip ids are regenerated on load. */
export function serializeProject(state: State): object {
  return {
    version: 6,
    meta: state.meta,
    lines: state.lines,
    style: state.style,
    lrcName: state.lrcName,
    tracks: state.tracks,
    images: state.images,
    projectDurationSec: state.projectDurationSec,
    clips: state.clips.map(({ id: _id, ...clip }) => clip)
  }
}
