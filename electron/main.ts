import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { createReadStream } from 'fs'
import { access, readFile, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join, resolve } from 'path'
import { Readable } from 'stream'
import { registerExportHandlers } from './exporter'
import {
  hasExportArg,
  hasSaveProjectArg,
  parseExportArg,
  parseSaveProjectArg,
  prepareJob,
  registerHeadlessHandlers
} from './headless'
import { readLrcText } from './lrcFile'
import { buildMenu, loadLocale, saveLocale, type Locale } from './menu'
import { registerConvertHandlers } from './convert'

/** 当前界面语言（registerLocaleHandlers 维护）；文件对话框文案据此本地化 */
let currentLocale: Locale = 'zh'

/** 主进程文件对话框文案（与渲染进程 i18n 分开，主进程自包含） */
const DIALOG: Record<Locale, Record<string, string>> = {
  zh: {
    openLrcTitle: '导入歌词/字幕文件', lyricFilter: '歌词/字幕',
    openAudioTitle: '导入音频文件', audioFilter: '音频',
    openVideoTitle: '导入视频文件', videoFilter: '视频',
    openImageTitle: '选择背景图片', imageFilter: '图片',
    openFontTitle: '导入字体文件', fontFilter: '字体',
    saveProjectTitle: '保存工程', projectFilter: '动态歌词工程',
    saveSrtTitle: '导出字幕', srtFilter: 'SRT 字幕',
    openPluginTitle: '导入特效插件', pluginFilter: '特效插件',
    openProjectTitle: '打开工程',
    saveVideoTitle: '导出视频', mp4Filter: 'MP4 视频',
    openLanguageTitle: '安装语言包', saveLanguageTitle: '导出语言模板', languageFilter: '语言包',
    windowTitle: '动态歌词视频生成器'
  },
  en: {
    openLrcTitle: 'Import lyrics / subtitles', lyricFilter: 'Lyrics / Subtitles',
    openAudioTitle: 'Import audio', audioFilter: 'Audio',
    openVideoTitle: 'Import video', videoFilter: 'Video',
    openImageTitle: 'Choose background image', imageFilter: 'Images',
    openFontTitle: 'Import font', fontFilter: 'Fonts',
    saveProjectTitle: 'Save project', projectFilter: 'Dynamic Lyrics Project',
    saveSrtTitle: 'Export subtitles', srtFilter: 'SRT Subtitles',
    openPluginTitle: 'Import effect plugin', pluginFilter: 'Effect Plugin',
    openProjectTitle: 'Open project',
    saveVideoTitle: 'Export video', mp4Filter: 'MP4 Video',
    openLanguageTitle: 'Install language pack', saveLanguageTitle: 'Export language template', languageFilter: 'Language pack',
    windowTitle: 'Dynamic Lyrics — Video Maker'
  }
}
const dlg = (k: string): string => DIALOG[currentLocale][k] ?? k

const exportRequested = hasExportArg(process.argv)
const exportJobPath = parseExportArg(process.argv)
const saveProjectRequested = hasSaveProjectArg(process.argv)
const saveProjectJobPath = parseSaveProjectArg(process.argv)
const headlessJobPath = exportJobPath ?? saveProjectJobPath
const headlessRequested = exportRequested || saveProjectRequested
// 无头导出走软件渲染，CI/无 GPU 环境也能跑
if (headlessRequested) app.disableHardwareAcceleration()

// media:// 自定义协议：渲染进程用它流式读取本地音视频（支持 seek），无需把大文件读进内存
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } }
])

const MEDIA_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

/**
 * media:///D:/dir/a.mp4 → 按本地文件流式响应。
 * 必须自己实现 Range（206）：<video> seek 到任意位置全靠它，
 * 不支持的话播放头一离开文件开头解码器就卡死在 seeking。
 */
function registerMediaProtocol(): void {
  protocol.handle('media', async (req) => {
    try {
      const path = decodeURIComponent(new URL(req.url).pathname).replace(/^\//, '')
      const { size } = await stat(path)
      const mime = MEDIA_MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
      const range = req.headers.get('range')?.match(/bytes=(\d+)-(\d*)/)
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
      return new Response(stream, {
        status: range ? 206 : 200,
        headers: {
          'Content-Type': mime,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
        }
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

function createWindow(headless: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: !headless,
    title: '动态歌词视频生成器',
    backgroundColor: '#16161c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      backgroundThrottling: false
    }
  })

  // 无头导出隐藏菜单栏；GUI 显示原生菜单（含语言切换）
  win.setMenuBarVisibility(headless ? false : true)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/** 打开文件并把内容读给渲染进程（渲染进程无 Node 权限） */
function registerFileHandlers(): void {
  ipcMain.handle('file:openLrc', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: dlg('openLrcTitle'),
      filters: [{ name: dlg('lyricFilter'), extensions: ['lrc', 'srt', 'vtt', 'txt'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    const path = filePaths[0]
    return { path, name: basename(path), text: await readLrcText(path) }
  })

  // 音/视频只返回路径，渲染进程经 media:// 协议流式读取
  ipcMain.handle('file:openAudio', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: dlg('openAudioTitle'),
      filters: [{ name: dlg('audioFilter'), extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths.map((path) => ({ path, name: basename(path) }))
  })

  ipcMain.handle('file:openVideo', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: dlg('openVideoTitle'),
      filters: [
        { name: dlg('videoFilter'), extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'flv', 'wmv', 'ts', 'mpg', 'mpeg', '3gp'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths.map((path) => ({ path, name: basename(path) }))
  })

  ipcMain.handle('file:openImage', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: dlg('openImageTitle'),
      filters: [{ name: dlg('imageFilter'), extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    return { path: filePaths[0], name: basename(filePaths[0]) }
  })

  ipcMain.handle('file:openFont', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: dlg('openFontTitle'),
      filters: [{ name: dlg('fontFilter'), extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    const path = filePaths[0]
    const buf = await readFile(path)
    return { path, name: basename(path).replace(/\.[^.]+$/, ''), data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
  })

  ipcMain.handle('file:saveProject', async (_e, json: string, defaultName: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: dlg('saveProjectTitle'),
      defaultPath: defaultName,
      filters: [{ name: dlg('projectFilter'), extensions: ['dlv.json'] }]
    })
    if (canceled || !filePath) return null
    await writeFile(filePath, json, 'utf-8')
    return filePath
  })

  ipcMain.handle('file:saveSrt', async (_e, text: string, defaultName: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: dlg('saveSrtTitle'),
      defaultPath: defaultName,
      filters: [{ name: dlg('srtFilter'), extensions: ['srt'] }]
    })
    if (canceled || !filePath) return null
    await writeFile(filePath, text, 'utf-8')
    return filePath
  })

  ipcMain.handle('file:openPlugin', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: dlg('openPluginTitle'),
      filters: [{ name: dlg('pluginFilter'), extensions: ['mjs', 'js'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    return {
      path: filePaths[0],
      name: basename(filePaths[0]),
      text: await readFile(filePaths[0], 'utf-8')
    }
  })

  ipcMain.handle('file:openLanguage', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: dlg('openLanguageTitle'),
      filters: [{ name: dlg('languageFilter'), extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    return { path: filePaths[0], name: basename(filePaths[0]), text: await readFile(filePaths[0], 'utf-8') }
  })

  ipcMain.handle('file:saveLanguageTemplate', async (_e, text: string, defaultName: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: dlg('saveLanguageTitle'),
      defaultPath: defaultName,
      filters: [{ name: dlg('languageFilter'), extensions: ['json'] }]
    })
    if (canceled || !filePath) return null
    await writeFile(filePath, text, 'utf-8')
    return filePath
  })

  ipcMain.handle('file:openProject', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: dlg('openProjectTitle'),
      filters: [{ name: dlg('projectFilter'), extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    return {
      path: filePaths[0],
      name: basename(filePaths[0]),
      text: await readFile(filePaths[0], 'utf-8')
    }
  })

  // 工程载入时检查媒体文件是否还在原路径
  ipcMain.handle('file:exists', async (_e, path: string) => {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('file:saveVideoPath', async (_e, defaultName: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: dlg('saveVideoTitle'),
      defaultPath: defaultName,
      filters: [{ name: dlg('mp4Filter'), extensions: ['mp4'] }]
    })
    return canceled ? null : filePath
  })
}

app.whenReady().then(async () => {
  registerMediaProtocol()
  registerExportHandlers()

  if (headlessRequested) {
    // 无头模式（导出视频 / 保存工程 / 两者兼得）
    try {
      if (saveProjectRequested && !saveProjectJobPath) {
        throw new Error('--save-project requires a job.json path')
      }
      if (exportRequested && !exportJobPath) {
        throw new Error('--export requires a job.json path')
      }
      const jobPath = headlessJobPath
      if (!jobPath) throw new Error('headless mode requires --export job.json or --save-project job.json')
      const payload = await prepareJob(jobPath)
      // 根据命令行参数决定行为
      payload.renderVideo = !!exportJobPath
      if (saveProjectJobPath) {
        // .dlv.json 输出到 job 文件同目录，文件名取自 LRC
        const base = payload.lrcName.replace(/\.[^.]+$/, '')
        payload.projectOutPath = resolve(dirname(resolve(jobPath)), `${base}.dlv.json`)
      }
      if (payload.renderVideo && !payload.outPath) {
        throw new Error('job.out 缺失：--export 模式必须指定输出 mp4 路径')
      }
      registerHeadlessHandlers(payload)
      console.log(`[headless] job: ${jobPath}`)
      createWindow(true)
    } catch (err) {
      console.error(`[headless] 任务文件无效: ${err instanceof Error ? err.message : err}`)
      app.exit(1)
    }
    return
  }

  registerHeadlessHandlers(null)
  registerFileHandlers()
  registerConvertHandlers()
  const win = createWindow(false)
  registerLocaleHandlers(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(false)
  })
})

/**
 * 语言切换改在应用内（渲染进程为权威源）。主进程只用 currentLocale 本地化自己的
 * 菜单文案/文件对话框/窗口标题；渲染进程切换时经 app:set-locale 告知，插件语言
 * （非内置 zh/en）则主进程文案回退英文。
 */
function registerLocaleHandlers(win: BrowserWindow): void {
  currentLocale = loadLocale()
  const apply = (locale: Locale): void => {
    currentLocale = locale
    saveLocale(locale)
    buildMenu(locale)
    if (!win.isDestroyed()) win.setTitle(dlg('windowTitle'))
  }
  apply(currentLocale)
  ipcMain.handle('app:get-locale', () => currentLocale)
  ipcMain.handle('app:set-locale', (_e, locale: string) => apply(locale === 'zh' || locale === 'en' ? locale : 'en'))
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
