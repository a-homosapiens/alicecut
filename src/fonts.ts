export interface FontOption {
  family: string
  label: string
  previewUrl?: string
  builtin?: boolean
  bundled?: boolean
}

interface BuiltinFont extends FontOption {
  file: string
  weight?: string
}

/** Windows 常见中文字体（系统自带，无需下载） */
export const SYSTEM_FONTS: FontOption[] = [
  { family: 'Microsoft YaHei', label: '微软雅黑' },
  { family: 'SimHei', label: '黑体' },
  { family: 'KaiTi', label: '楷体' },
  { family: 'DengXian', label: '等线' },
  { family: 'SimSun', label: '宋体' },
  { family: 'Impact', label: 'Impact（西文）' }
]

const FONT_ASSET_BASE = (
  import.meta.env.VITE_FONT_ASSET_BASE_URL ??
  'https://media.githubusercontent.com/media/a-homosapiens/alicecut/main/font-assets'
).replace(/\/$/, '')

const repoFontUrl = (file: string): string => `${FONT_ASSET_BASE}/${encodeURIComponent(file)}`

/**
 * 内置字体目录。preview 图片很小，始终随应用提供；字体文件只在用户选择时加载。
 * downloadUrl 用于未随安装包提供字体文件的发行方式，file 则兼容开发环境/npm run fonts。
 */
const BUILTIN_FONTS: BuiltinFont[] = [
  {
    family: 'Smiley Sans', label: '得意黑', file: 'SmileySans-Oblique.ttf', bundled: true
  },
  {
    family: 'LXGW WenKai', label: '霞鹜文楷', file: 'LXGWWenKai-Medium.ttf'
  },
  { family: '庞门正道标题体', label: '庞门正道标题体', file: 'PangmenZhengdaoBiaoti.ttf' },
  { family: '庞门正道粗书体', label: '庞门正道粗书体', file: 'PangmenZhengdaoCushu.ttf' },
  { family: '庞门正道轻松体', label: '庞门正道轻松体', file: 'PangmenZhengdaoQingsong.otf' },
  { family: '站酷高端黑', label: '站酷高端黑', file: 'ZcoolGaoduanhei.ttf' },
  { family: '站酷酷黑体', label: '站酷酷黑体', file: 'ZcoolKuhei.ttf' },
  { family: '站酷快乐体', label: '站酷快乐体', file: 'ZcoolKuaile.ttf' },
  { family: '站酷文艺体', label: '站酷文艺体', file: 'ZcoolWenyi.ttf' },
  { family: '站酷小薇LOGO体', label: '站酷小薇LOGO体', file: 'ZcoolXiaoweiLogo.otf' },
  { family: '站酷庆科黄油体', label: '站酷庆科黄油体', file: 'ZcoolQingkeHuangyou.ttf' },
  { family: '江西拙楷', label: '江西拙楷', file: 'JiangxiZhuokai.ttf' },
  { family: '锐字真言体', label: '锐字真言体', file: 'RuiziZhenyan.ttf' },
  { family: 'Masa Font', label: '正风毛笔（行书）', file: 'MasaFont-Regular.ttf', weight: '400' },
  { family: 'Chongxi Seal', label: '崇羲篆体（11,596 字）', file: 'ChongxiSeal.otf', weight: '400' },
  { family: 'Onryou', label: '音量（和风装饰）', file: 'Onryou.ttf', weight: '400' },
  { family: 'Jinghua Lao Song', label: '京華老宋体', file: 'JinghuaLaoSong.ttf', weight: '400' },
  { family: 'Huiwen Ming', label: '匯文明朝體', file: 'HuiwenMing.otf', weight: '400' },
  { family: 'Zhaohua Title B', label: '朝華標題B', file: 'ZhaohuaTitleB.ttf', weight: '400' },
  { family: 'Zhaohua Typewriter', label: '朝華打字機', file: 'ZhaohuaTypewriter.ttf', weight: '400' },
  ...([1, 2, 3, 4] as const).map((v): BuiltinFont => ({
    family: `Torono Glitch Gothic H${v}`, label: `瀞ノグリッチ黑体 H${v}`,
    file: `ToronoGlitchGothic-H${v}.otf`, weight: '400'
  })),
  ...([1, 2, 3, 4] as const).map((v): BuiltinFont => ({
    family: `Torono Glitch Mincho H${v}`, label: `瀞ノグリッチ明朝 H${v}`,
    file: `ToronoGlitchMincho-H${v}.otf`, weight: '400'
  })),
  {
    family: 'Noto Sans SC', label: '思源黑体 SC（可变字重）', file: 'NotoSansSC[wght].ttf', weight: '100 900', bundled: true
  },
  {
    family: 'Noto Serif SC', label: '思源宋体 SC（可变字重）', file: 'NotoSerifSC[wght].ttf', weight: '200 900'
  },
  {
    family: 'Inter', label: 'Inter（英文可变字重）', file: 'Inter[opsz,wght].ttf', weight: '100 900', bundled: true
  },
  {
    family: 'Anton', label: 'Anton（英文窄体标题）', file: 'Anton-Regular.ttf', weight: '400'
  },
  {
    family: 'Fredoka', label: 'Fredoka（英文圆润）', file: 'Fredoka[wdth,wght].ttf', weight: '300 700'
  },
  {
    family: 'Playfair Display', label: 'Playfair Display（英文编辑衬线）', file: 'PlayfairDisplay[wght].ttf', weight: '400 900'
  }
]

/** 本地安装后预载全部中文/CJK 字体；西文字体仍按选择时加载。 */
const LOCAL_CJK_FAMILIES = new Set(
  BUILTIN_FONTS
    .filter((font) => !['Inter', 'Anton', 'Fredoka', 'Playfair Display'].includes(font.family))
    .map((font) => font.family)
)

export const BUILTIN_FONT_OPTIONS: FontOption[] = BUILTIN_FONTS.map((font) => ({
  family: font.family,
  label: font.label,
  builtin: true,
  bundled: font.bundled,
  previewUrl: `./font-previews/${font.file.replace(/\.(?:ttf|otf)$/i, '.png')}`
}))

const DB_NAME = 'alicecut-fonts'
const STORE_NAME = 'font-files'
const DB_VERSION = 1
const registeredFamilies = new Set<string>()
const IMPORTED_FONT_LIST_KEY = 'alicecut-imported-fonts-v1'
const importedCacheKey = (family: string): string => `imported:${family}`

function importedFamilies(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(IMPORTED_FONT_LIST_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
  } catch {
    return []
  }
}

function openFontDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readCachedFont(family: string): Promise<ArrayBuffer | null> {
  const db = await openFontDb()
  return new Promise<ArrayBuffer | null>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(family)
    request.onsuccess = () => resolve(request.result instanceof ArrayBuffer ? request.result : null)
    request.onerror = () => reject(request.error)
  }).finally(() => db.close())
}

async function writeCachedFont(family: string, data: ArrayBuffer): Promise<void> {
  const db = await openFontDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(data, family)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function registerFont(font: BuiltinFont, data: ArrayBuffer): Promise<void> {
  if (registeredFamilies.has(font.family)) return
  const face = new FontFace(font.family, data, font.weight ? { weight: font.weight } : undefined)
  await face.load()
  document.fonts.add(face)
  registeredFamilies.add(font.family)
}

async function fetchFont(font: BuiltinFont): Promise<ArrayBuffer> {
  const local = await fetch(`./fonts/${font.file}`)
  if (local.ok) return local.arrayBuffer()
  if (font.bundled) throw new Error(`Bundled font is missing: ${font.label}`)
  return window.desktop.downloadFont(repoFontUrl(font.file))
}

/** 下载（或读取随应用提供的文件）、持久缓存并注册一个字体。 */
export async function installBuiltinFont(family: string): Promise<void> {
  const font = BUILTIN_FONTS.find((item) => item.family === family)
  if (!font) return
  const cached = await readCachedFont(family)
  const data = cached ?? await fetchFont(font)
  await registerFont(font, data)
  if (!cached) await writeCachedFont(family, data)
}

/** 启动时只恢复用户已经安装过的字体，不下载新字体。 */
export async function restoreInstalledFonts(): Promise<Set<string>> {
  const installed = new Set<string>()
  await Promise.all(BUILTIN_FONTS.map(async (font) => {
    let data = await readCachedFont(font.family).catch(() => null)
    if (!data && (font.bundled || LOCAL_CJK_FAMILIES.has(font.family))) {
      const local = await fetch(`./fonts/${font.file}`).catch(() => null)
      if (local?.ok) data = await local.arrayBuffer()
    }
    if (!data) return
    await registerFont(font, data)
    installed.add(font.family)
  }))
  return installed
}

/** 无头导出兼容：恢复缓存，并尝试加载本地 npm run fonts 产生的字体文件。 */
export async function loadBuiltinFonts(): Promise<FontOption[]> {
  const loaded: FontOption[] = []
  for (const font of BUILTIN_FONTS) {
    try {
      let data = await readCachedFont(font.family).catch(() => null)
      if (!data) {
        const response = await fetch(`./fonts/${font.file}`)
        if (!response.ok) throw new Error(String(response.status))
        data = await response.arrayBuffer()
      }
      await registerFont(font, data)
      loaded.push({ family: font.family, label: font.label, builtin: true })
    } catch {
      // 本地文件不存在时跳过，回落系统字体。
    }
  }
  return loaded
}

/** 用户导入 ttf/otf：注册到 document.fonts，返回可用的 font-family。 */
export async function registerImportedFont(name: string, data: ArrayBuffer): Promise<FontOption> {
  const face = new FontFace(name, data)
  await face.load()
  document.fonts.add(face)
  registeredFamilies.add(name)
  await writeCachedFont(importedCacheKey(name), data)
  const families = [...new Set([name, ...importedFamilies()])]
  localStorage.setItem(IMPORTED_FONT_LIST_KEY, JSON.stringify(families))
  return { family: name, label: `${name}（导入）` }
}

/** Restore user-imported font binaries and picker entries after relaunch. */
export async function restoreImportedFonts(): Promise<FontOption[]> {
  const restored: FontOption[] = []
  for (const family of importedFamilies()) {
    try {
      const data = await readCachedFont(importedCacheKey(family))
      if (!data) continue
      const face = new FontFace(family, data)
      await face.load()
      document.fonts.add(face)
      registeredFamilies.add(family)
      restored.push({ family, label: `${family}（导入）` })
    } catch {
      // One corrupt font must not prevent the rest of the editor from starting.
    }
  }
  return restored
}
