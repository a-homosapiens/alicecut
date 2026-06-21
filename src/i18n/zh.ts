/**
 * 中文文案（source of truth）。其他语言的字典须含相同的键；
 * 缺失键回退到本文件。占位符用 {name} 形式，由 translate 插值。
 */
export const zh = {
  // 顶栏
  'topbar.title': '动态歌词',
  'topbar.importLyrics': '导入歌词',
  'topbar.importVideo': '导入视频',
  'topbar.importAudio': '导入音频',
  'topbar.importPlugin': '导入插件',
  'topbar.openProject': '打开工程',
  'topbar.saveProject': '保存工程',
  'topbar.exportSrt': '导出字幕',
  'topbar.exportVideo': '导出视频',
  'topbar.videoSuffix': '· {n} 段',
  'topbar.audioSuffix': '· {n} 条'
} as const
