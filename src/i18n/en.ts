import type { zh } from './zh'

/** English strings. Keys must match zh exactly (type-checked below). */
export const en: Record<keyof typeof zh, string> = {
  'topbar.title': 'Dynamic Lyrics',
  'topbar.importLyrics': 'Import Lyrics',
  'topbar.importVideo': 'Import Video',
  'topbar.importAudio': 'Import Audio',
  'topbar.importPlugin': 'Import Plugin',
  'topbar.openProject': 'Open Project',
  'topbar.saveProject': 'Save Project',
  'topbar.exportSrt': 'Export Subtitles',
  'topbar.exportVideo': 'Export Video',
  'topbar.videoSuffix': '· {n} clips',
  'topbar.audioSuffix': '· {n} tracks'
}
