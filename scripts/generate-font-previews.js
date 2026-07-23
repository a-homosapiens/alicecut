/**
 * Generate lightweight font catalog previews without shipping/loading every font at startup.
 * Run with: npm run font-previews
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, readdirSync, readFileSync, writeFileSync } = require('fs')
const { basename, join } = require('path')
const { pathToFileURL } = require('url')

const ROOT = join(__dirname, '..')
const FONT_DIR = join(ROOT, 'public', 'fonts')
const ASSET_DIR = join(ROOT, 'font-assets')
const OUT_DIR = join(ROOT, 'public', 'font-previews')
const SOURCE = readFileSync(join(ROOT, 'src', 'fonts.ts'), 'utf8')
const WIDTH = 300
const HEIGHT = 72

const metadata = new Map(
  [...SOURCE.matchAll(/\{\s*family:\s*'([^']+)'[\s\S]{0,300}?label:\s*'([^']+)'[\s\S]{0,300}?file:\s*'([^']+\.(?:ttf|otf))'/gi)]
    .map((match) => [match[3], { family: match[1], label: match[2] }])
)
const entries = [FONT_DIR, ASSET_DIR].flatMap((directory) => readdirSync(directory)
  .filter((file) => /\.(?:ttf|otf)$/i.test(file))
  .map((file) => ({
    file,
    path: join(directory, file),
    family: metadata.get(file)?.family ?? basename(file, file.slice(file.lastIndexOf('.'))),
    label: metadata.get(file)?.label ?? basename(file, file.slice(file.lastIndexOf('.')))
  })))

function htmlFor(entry) {
  const fontUrl = pathToFileURL(entry.path).href
  // Latin-only fonts can render an all-Chinese catalog label as a blank image.
  // Use their English family name so the preview always demonstrates real glyphs.
  const previewText = entry.label.includes('英文') ? entry.family : entry.label
  const safeLabel = previewText.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
  return `<!doctype html><meta charset="utf-8"><style>
    @font-face{font-family:PreviewFont;src:url("${fontUrl}")}
    html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:transparent}
    body{display:flex;align-items:center;justify-content:center;color:#f4f2ff;font:400 29px PreviewFont,sans-serif;
      text-shadow:0 1px 3px #000;white-space:nowrap}
  </style><span>${safeLabel}</span>`
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  mkdirSync(OUT_DIR, { recursive: true })
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true, webSecurity: false }
  })

  let generated = 0
  for (const entry of entries) {
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlFor(entry))}`)
      await win.webContents.executeJavaScript('document.fonts.ready')
      const image = await win.webContents.capturePage()
      writeFileSync(join(OUT_DIR, basename(entry.file).replace(/\.(?:ttf|otf)$/i, '.png')), image.toPNG())
      generated += 1
    } catch (error) {
      console.warn(`skip ${entry.file}: ${error.message}`)
    }
  }
  win.destroy()
  console.log(`generated ${generated}/${entries.length} font previews`)
  app.exit(generated === entries.length ? 0 : 1)
})
