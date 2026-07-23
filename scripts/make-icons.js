/**
 * 由 resources/icon.svg 生成应用图标位图（窗口/任务栏/安装包用）：
 *   resources/icon.png  512×512
 *   resources/icon.ico  16/24/32/48/64/128/256 多尺寸
 *
 * 用 Electron 自己的 Chromium 光栅化 SVG，不引入 sharp/svg2png 之类的新依赖。
 * 运行：npm run icons
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const { readFileSync, writeFileSync, mkdirSync, rmSync } = require('fs')
const { join } = require('path')
const { tmpdir } = require('os')

const RES = join(__dirname, '..', 'resources')
const MASTER = 512
// 小尺寸换用简化版（无刻度、更粗的线）：ico 允许每个尺寸放不同的图
const SMALL_SIZES = [16, 24, 32]
const LARGE_SIZES = [48, 64, 128, 256]

/** 把若干 PNG buffer 打包成 .ico（Vista+ 允许目录项直接内嵌 PNG） */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)

  const dir = Buffer.alloc(16 * entries.length)
  // 图像数据紧跟在头 + 目录之后
  let offset = header.length + dir.length
  entries.forEach((e, i) => {
    const p = i * 16
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, p) // 256 记作 0
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, p + 1)
    dir.writeUInt8(0, p + 2) // 调色板数
    dir.writeUInt8(0, p + 3) // reserved
    dir.writeUInt16LE(1, p + 4) // color planes
    dir.writeUInt16LE(32, p + 6) // bits per pixel
    dir.writeUInt32LE(e.png.length, p + 8)
    dir.writeUInt32LE(offset, p + 12)
    offset += e.png.length
  })

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

app.disableHardwareAcceleration()

/**
 * 把一个 SVG 文件光栅化成 MASTER×MASTER 的 nativeImage（带 alpha）。
 * 复用同一个窗口：透明离屏窗口销毁后再新建会 ERR_FAILED，一个窗口连着换页面则没问题。
 */
async function rasterize(win, svgFile) {
  const svg = readFileSync(join(RES, svgFile), 'utf-8')
  const html = `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;background:transparent}svg{display:block;width:${MASTER}px;height:${MASTER}px}</style>
    ${svg}`
  const htmlPath = join(tmpdir(), `alicecut-icon-${Date.now()}-${svgFile}.html`)
  writeFileSync(htmlPath, html, 'utf-8')

  await win.loadFile(htmlPath)
  // 等一帧，确保渐变/描边都已绘制
  await new Promise((r) => setTimeout(r, 400))

  const shot = await win.webContents.capturePage()
  if (shot.isEmpty()) throw new Error(`capturePage 返回空图像: ${svgFile}`)
  rmSync(htmlPath, { force: true })
  // capturePage 给的是物理像素：显示器有缩放时会大于 MASTER，统一缩回标称尺寸
  return shot.resize({ width: MASTER, height: MASTER, quality: 'best' })
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: MASTER,
    height: MASTER,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true }
  })

  const master = await rasterize(win, 'icon.svg')
  const small = await rasterize(win, 'icon-small.svg')
  win.destroy()

  const png = (img, size) => img.resize({ width: size, height: size, quality: 'best' }).toPNG()

  mkdirSync(RES, { recursive: true })
  writeFileSync(join(RES, 'icon.png'), master.toPNG())
  // 渲染进程的 favicon（vite 会把 public/ 原样拷进产物）；resources/icon.svg 仍是唯一源头
  const PUB = join(__dirname, '..', 'public')
  mkdirSync(PUB, { recursive: true })
  writeFileSync(join(PUB, 'icon.png'), png(master, 256))

  const entries = [
    ...SMALL_SIZES.map((size) => ({ size, png: png(small, size) })),
    ...LARGE_SIZES.map((size) => ({ size, png: png(master, size) }))
  ]
  writeFileSync(join(RES, 'icon.ico'), buildIco(entries))

  console.log(`icon.png ${master.getSize().width}×${master.getSize().height}`)
  console.log(`icon.ico 简化版 ${SMALL_SIZES.join('/')} + 完整版 ${LARGE_SIZES.join('/')}`)
  app.exit(0)
})
