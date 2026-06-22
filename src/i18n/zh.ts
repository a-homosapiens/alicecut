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
  'topbar.audioSuffix': '· {n} 条',

  // 内置文字特效显示名（键 = effect.<id>；插件特效无键，回退其自带 name）
  'effect.pop': '逐字弹出',
  'effect.punch': '缩放冲击',
  'effect.slide': '滑动错落',
  'effect.typewriter': '打字机',
  'effect.glow': '发光渐显',
  'effect.karaoke': '卡拉OK高亮',
  'effect.highlightBox': '跳动高亮块',
  'effect.bounce': '弹跳',
  'effect.streak': '残影滑入',
  'effect.wobble': '飘摆',
  'effect.wipe': '横向擦入',
  'effect.iris': '圆形展开',
  'effect.clockWipe': '钟摆扫入',
  'effect.flip': '翻转切换',
  'effect.flip-bottom': '翻转·底对齐',
  'effect.rise': '上移切换',

  // 内置视频转场显示名（键 = vtrans.<id>）
  'vtrans.fade': '淡入淡出',
  'vtrans.slideL': '左滑',
  'vtrans.slideR': '右滑',
  'vtrans.slideU': '上滑',
  'vtrans.slideD': '下滑',
  'vtrans.zoom': '缩放',
  'vtrans.wipeL': '左擦',
  'vtrans.wipeR': '右擦'
} as const
