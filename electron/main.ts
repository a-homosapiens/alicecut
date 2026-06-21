import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { createReadStream } from 'fs'
import { access, readFile, stat, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { Readable } from 'stream'
import { registerExportHandlers } from './exporter'
import { parseExportArg, prepareJob, registerHeadlessHandlers } from './headless'
import { readLrcText } from './lrcFile'
import { buildMenu, loadLocale, saveLocale, type Locale } from './menu'

const exportJobPath = parseExportArg(process.argv)
// 无头导出走软件渲染，CI/无 GPU 环境也能跑
if (exportJobPath) app.disableHardwareAcceleration()

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
      title: '导入歌词/字幕文件',
      filters: [{ name: '歌词/字幕', extensions: ['lrc', 'srt', 'vtt', 'txt'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    const path = filePaths[0]
    return { path, name: basename(path), text: await readLrcText(path) }
  })

  // 音/视频只返回路径，渲染进程经 media:// 协议流式读取
  ipcMain.handle('file:openAudio', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '导入音频文件',
      filters: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths.map((path) => ({ path, name: basename(path) }))
  })

  ipcMain.handle('file:openVideo', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '导入视频文件',
      filters: [{ name: '视频', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths.map((path) => ({ path, name: basename(path) }))
  })

  ipcMain.handle('file:openImage', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择背景图片',
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    return { path: filePaths[0], name: basename(filePaths[0]) }
  })

  ipcMain.handle('file:openFont', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '导入字体文件',
      filters: [{ name: '字体', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    const path = filePaths[0]
    const buf = await readFile(path)
    return { path, name: basename(path).replace(/\.[^.]+$/, ''), data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
  })

  ipcMain.handle('file:saveProject', async (_e, json: string, defaultName: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '保存工程',
      defaultPath: defaultName,
      filters: [{ name: '动态歌词工程', extensions: ['dlv.json'] }]
    })
    if (canceled || !filePath) return null
    await writeFile(filePath, json, 'utf-8')
    return filePath
  })

  ipcMain.handle('file:saveSrt', async (_e, text: string, defaultName: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出字幕',
      defaultPath: defaultName,
      filters: [{ name: 'SRT 字幕', extensions: ['srt'] }]
    })
    if (canceled || !filePath) return null
    await writeFile(filePath, text, 'utf-8')
    return filePath
  })

  ipcMain.handle('file:openPlugin', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '导入特效插件',
      filters: [{ name: '特效插件', extensions: ['mjs', 'js'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    return {
      path: filePaths[0],
      name: basename(filePaths[0]),
      text: await readFile(filePaths[0], 'utf-8')
    }
  })

  ipcMain.handle('file:openProject', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '打开工程',
      filters: [{ name: '动态歌词工程', extensions: ['json'] }],
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
      title: '导出视频',
      defaultPath: defaultName,
      filters: [{ name: 'MP4 视频', extensions: ['mp4'] }]
    })
    return canceled ? null : filePath
  })
}

app.whenReady().then(async () => {
  registerMediaProtocol()
  registerExportHandlers()

  if (exportJobPath) {
    // 无头导出：准备任务 → 隐藏窗口跑渲染 → headless:done 里退出
    try {
      const payload = await prepareJob(exportJobPath)
      registerHeadlessHandlers(payload)
      console.log(`[export] job: ${exportJobPath}`)
      createWindow(true)
    } catch (err) {
      console.error(`[export] 任务文件无效: ${err instanceof Error ? err.message : err}`)
      app.exit(1)
    }
    return
  }

  registerHeadlessHandlers(null)
  registerFileHandlers()
  const win = createWindow(false)
  registerLocaleHandlers(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(false)
  })
})

/** 语言：主进程持有持久化值与原生菜单；切换时重建菜单（更新选中态与菜单文案）并通知渲染进程 */
function registerLocaleHandlers(win: BrowserWindow): void {
  let currentLocale = loadLocale()
  const apply = (locale: Locale): void => {
    currentLocale = locale
    saveLocale(locale)
    buildMenu(locale, apply)
    if (!win.isDestroyed()) win.webContents.send('app:locale-changed', locale)
  }
  buildMenu(currentLocale, apply)
  // 页面加载后把当前语言推给渲染进程，使 UI 与持久化值一致
  win.webContents.on('did-finish-load', () => win.webContents.send('app:locale-changed', currentLocale))
  ipcMain.handle('app:get-locale', () => currentLocale)
  // 供未来应用内切换器使用（菜单切换走 click→apply，不经此处）
  ipcMain.handle('app:set-locale', (_e, locale: Locale) => apply(locale))
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
