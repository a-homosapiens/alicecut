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
  'topbar.audioSuffix': '· {n} tracks',

  // Built-in text effect display names (key = effect.<id>; plugins fall back to their own name)
  'effect.pop': 'Pop In',
  'effect.punch': 'Punch',
  'effect.slide': 'Slide Stagger',
  'effect.typewriter': 'Typewriter',
  'effect.glow': 'Glow Fade',
  'effect.karaoke': 'Karaoke',
  'effect.highlightBox': 'Highlight Box',
  'effect.bounce': 'Bounce',
  'effect.streak': 'Streak In',
  'effect.wobble': 'Wobble',
  'effect.wipe': 'Wipe In',
  'effect.iris': 'Iris',
  'effect.clockWipe': 'Clock Wipe',
  'effect.flip': 'Flip',
  'effect.flip-bottom': 'Flip (Bottom)',
  'effect.rise': 'Rise',

  // Built-in video transition display names (key = vtrans.<id>)
  'vtrans.fade': 'Fade',
  'vtrans.slideL': 'Slide Left',
  'vtrans.slideR': 'Slide Right',
  'vtrans.slideU': 'Slide Up',
  'vtrans.slideD': 'Slide Down',
  'vtrans.zoom': 'Zoom',
  'vtrans.wipeL': 'Wipe Left',
  'vtrans.wipeR': 'Wipe Right'
}

