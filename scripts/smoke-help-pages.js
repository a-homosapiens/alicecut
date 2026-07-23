const { app, BrowserWindow } = require('electron')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

async function inspectPage(file, query) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    const url = pathToFileURL(file)
    if (query) url.hash = new URLSearchParams(query).toString()
    await win.loadURL(url.toString())
    return await win.webContents.executeJavaScript(`({
      title: document.title,
      stepCount: document.querySelectorAll('.step').length,
      version: document.querySelector('#app-version')?.textContent ?? '',
      company: document.querySelector('.company-copy.lead')?.textContent ?? '',
      website: document.querySelector('a')?.href ?? '',
      images: [...document.images].map((image) => ({
        complete: image.complete,
        width: image.naturalWidth,
        height: image.naturalHeight
      })),
      background: getComputedStyle(document.body).backgroundColor
    })`)
  } finally {
    win.destroy()
  }
}

app.whenReady().then(async () => {
  // Keep one application window alive while the page windows are created and
  // destroyed sequentially, matching AliceCut's always-open editor window.
  const host = new BrowserWindow({ show: false })
  const rendererRootIndex = process.argv.indexOf('--renderer-root')
  const renderer = rendererRootIndex >= 0
    ? resolve(process.argv[rendererRootIndex + 1])
    : resolve(__dirname, '../out/renderer')
  let help
  let about
  try {
    help = await inspectPage(resolve(renderer, 'help/quick-start.html'))
    about = await inspectPage(resolve(renderer, 'help/about.html'), { version: '0.1.0-test' })
  } finally {
    host.destroy()
  }

  if (help.title !== 'AliceCut Help' || help.stepCount !== 6) {
    throw new Error(`Quick-start page content is incomplete: ${JSON.stringify(help)}`)
  }
  if (about.title !== 'About AliceCut' || about.version !== 'v0.1.0-test') {
    throw new Error(`About page did not render the supplied version: ${JSON.stringify(about)}`)
  }
  if (!about.company.includes('of Homo sapiens, by Homo sapiens, and for Homo sapiens')) {
    throw new Error(`About page company description is missing: ${JSON.stringify(about)}`)
  }
  if (about.website !== 'https://www.artificialhomosapiens.com/') {
    throw new Error(`About page website is incorrect: ${JSON.stringify(about)}`)
  }
  for (const result of [help, about]) {
    if (result.images.length === 0 || result.images.some((image) => !image.complete || image.width === 0 || image.height === 0)) {
      throw new Error(`A local help image failed to load: ${JSON.stringify(result)}`)
    }
    if (result.background === 'rgba(0, 0, 0, 0)') {
      throw new Error(`Help page stylesheet did not load: ${JSON.stringify(result)}`)
    }
  }

  process.stdout.write('Help page smoke test passed.\n')
  app.quit()
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
  app.exit(1)
  process.exit(1)
})
