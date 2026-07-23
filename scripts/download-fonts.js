/**
 * 下载字体资产：三款首装字体进入 public/fonts/，其余进入 font-assets/ 供 GitHub 按需下载。
 * 运行：npm run fonts
 * 失败不影响使用——应用会回退到系统字体。
 */
const { writeFile, mkdir, copyFile, readdir } = require('fs/promises')
const { existsSync } = require('fs')
const path = require('path')

const FONTS_DIR = path.join(__dirname, '..', 'public', 'fonts')
const ASSETS_DIR = path.join(__dirname, '..', 'font-assets')
const STARTER_FILES = new Set(['SmileySans-Oblique.ttf', 'NotoSansSC[wght].ttf', 'Inter[opsz,wght].ttf'])

/** wordshub/free-font 仓库（免费商用字体合集）里的文件 → raw 下载地址 */
const FREE_FONT_RAW = 'https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/'

const FONTS = [
  {
    name: '霞鹜文楷 LXGW WenKai（SIL OFL）',
    file: 'LXGWWenKai-Medium.ttf',
    url: 'https://github.com/lxgw/LxgwWenKai/releases/download/v1.522/LXGWWenKai-Medium.ttf'
  },
  {
    name: '得意黑 Smiley Sans（SIL OFL）',
    file: 'SmileySans-Oblique.ttf',
    url: 'https://github.com/atelier-anchor/smiley-sans/releases/download/v2.0.1/smiley-sans-v2.0.1.zip',
    zipEntry: 'SmileySans-Oblique.ttf'
  },
  // ---- 庞门正道系列（免费商用） ----
  {
    name: '庞门正道标题体',
    file: 'PangmenZhengdaoBiaoti.ttf',
    url: FREE_FONT_RAW + encodeURI('中文/庞门正道字体系列/庞门正道标题体.ttf')
  },
  {
    name: '庞门正道粗书体',
    file: 'PangmenZhengdaoCushu.ttf',
    url: FREE_FONT_RAW + encodeURI('中文/庞门正道字体系列/庞门正道粗书体.ttf')
  },
  {
    name: '庞门正道轻松体',
    file: 'PangmenZhengdaoQingsong.otf',
    url: FREE_FONT_RAW + encodeURI('中文/庞门正道字体系列/庞门正道轻松体.otf')
  },
  // ---- 站酷系列（免费商用） ----
  {
    name: '站酷高端黑',
    file: 'ZcoolGaoduanhei.ttf',
    url: FREE_FONT_RAW + encodeURI('中文/站酷字体系列/ 站酷高端黑.ttf') // 仓库里文件名带前导空格
  },
  {
    name: '站酷酷黑体',
    file: 'ZcoolKuhei.ttf',
    url: FREE_FONT_RAW + encodeURI('中文/站酷字体系列/站酷酷黑体.ttf')
  },
  {
    name: '站酷快乐体',
    file: 'ZcoolKuaile.ttf',
    url: FREE_FONT_RAW + encodeURI('中文/站酷字体系列/站酷快乐体.ttf')
  },
  {
    name: '站酷文艺体',
    file: 'ZcoolWenyi.ttf',
    url: FREE_FONT_RAW + encodeURI('中文/站酷字体系列/站酷文艺体.ttf')
  },
  {
    name: '站酷小薇LOGO体',
    file: 'ZcoolXiaoweiLogo.otf',
    url: FREE_FONT_RAW + encodeURI('中文/站酷字体系列/站酷小薇LOGO体.otf')
  },
  {
    name: '站酷庆科黄油体',
    file: 'ZcoolQingkeHuangyou.ttf',
    url: FREE_FONT_RAW + encodeURI('中文/站酷字体系列/站酷庆科黄油体.ttf')
  },
  // ---- 其他免费商用 ----
  {
    name: '江西拙楷',
    file: 'JiangxiZhuokai.ttf',
    url: FREE_FONT_RAW + encodeURI('中文/其他字体/江西拙楷.ttf')
  },
  {
    name: '锐字真言体',
    file: 'RuiziZhenyan.ttf',
    url: FREE_FONT_RAW + encodeURI('中文/其他字体/锐字真言体.ttf')
  },
  // ---- 书法/繁体行书 ----
  {
    name: '正风毛笔 Masa Font（SIL OFL）',
    file: 'MasaFont-Regular.ttf',
    url: 'https://raw.githubusercontent.com/max32002/masafont/master/tw/MasaFont-Regular.ttf'
  },
  {
    name: '崇羲篆体（CC BY-ND 3.0 TW）',
    file: 'ChongxiSeal.otf',
    url: 'https://xiaoxue.iis.sinica.edu.tw/chongxi/files/chongxi_seal.zip',
    zipEntry: 'chongxi_seal.otf'
  },
  { name: '瀞ノグリッチ黑体 H1', file: 'ToronoGlitchGothic-H1.otf', url: 'https://raw.githubusercontent.com/amazusa/ToronoGlitch/master/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%83%81%E9%BB%92%E4%BD%93/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%83%81%E9%BB%92%E4%BD%93H1.otf' },
  { name: '瀞ノグリッチ黑体 H2', file: 'ToronoGlitchGothic-H2.otf', url: 'https://raw.githubusercontent.com/amazusa/ToronoGlitch/master/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%83%81%E9%BB%92%E4%BD%93/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%83%81%E9%BB%92%E4%BD%93H2.otf' },
  { name: '瀞ノグリッチ黑体 H3', file: 'ToronoGlitchGothic-H3.otf', url: 'https://raw.githubusercontent.com/amazusa/ToronoGlitch/master/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%83%81%E9%BB%92%E4%BD%93/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%81%A1%E9%BB%92%E4%BD%93H3.otf' },
  { name: '瀞ノグリッチ黑体 H4', file: 'ToronoGlitchGothic-H4.otf', url: 'https://raw.githubusercontent.com/amazusa/ToronoGlitch/master/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%83%81%E9%BB%92%E4%BD%93/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%83%81%E9%BB%92%E4%BD%93H4.otf' },
  { name: '瀞ノグリッチ明朝 H1', file: 'ToronoGlitchMincho-H1.otf', url: 'https://raw.githubusercontent.com/amazusa/ToronoGlitch/master/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%83%81%E6%98%8E%E6%9C%9D/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%83%81%E6%98%8E%E6%9C%9DH1.otf' },
  { name: '瀞ノグリッチ明朝 H2', file: 'ToronoGlitchMincho-H2.otf', url: 'https://raw.githubusercontent.com/amazusa/ToronoGlitch/master/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%83%81%E6%98%8E%E6%9C%9D/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%81%A1%E6%98%8E%E6%9C%9DH2.otf' },
  { name: '瀞ノグリッチ明朝 H3', file: 'ToronoGlitchMincho-H3.otf', url: 'https://raw.githubusercontent.com/amazusa/ToronoGlitch/master/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%83%81%E6%98%8E%E6%9C%9D/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%83%81%E6%98%8E%E6%9C%9DH3.otf' },
  { name: '瀞ノグリッチ明朝 H4', file: 'ToronoGlitchMincho-H4.otf', url: 'https://raw.githubusercontent.com/amazusa/ToronoGlitch/master/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%83%81%E6%98%8E%E6%9C%9D/%E7%80%9E%E3%83%8E%E3%82%B0%E3%83%AA%E3%83%83%E3%81%A1%E6%98%8E%E6%9C%9DH4.otf' },
  // ---- 思源/Noto 中文正文与标题（Google Fonts，SIL OFL） ----
  {
    name: '思源黑体 SC Noto Sans SC（SIL OFL）',
    file: 'NotoSansSC[wght].ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf'
  },
  {
    name: '思源宋体 SC Noto Serif SC（SIL OFL）',
    file: 'NotoSerifSC[wght].ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf'
  },
  // ---- 英文字幕与标题（Google Fonts，SIL OFL） ----
  {
    name: 'Inter（SIL OFL）',
    file: 'Inter[opsz,wght].ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf'
  },
  {
    name: 'Anton（SIL OFL）',
    file: 'Anton-Regular.ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf'
  },
  {
    name: 'Fredoka（SIL OFL）',
    file: 'Fredoka[wdth,wght].ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/fredoka/Fredoka%5Bwdth%2Cwght%5D.ttf'
  },
  {
    name: 'Playfair Display（SIL OFL）',
    file: 'PlayfairDisplay[wght].ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf'
  },
  // Correctly URI-encode the Japanese repository paths.
  ...['瀞ノグリッチ黒体', '瀞ノグリッチ明朝'].flatMap((dir, di) => [1, 2, 3, 4].map((v) => ({
    name: `${dir} H${v}`,
    file: `${di === 0 ? 'ToronoGlitchGothic' : 'ToronoGlitchMincho'}-H${v}.otf`,
    url: `https://raw.githubusercontent.com/amazusa/ToronoGlitch/master/${encodeURIComponent(dir)}/${encodeURIComponent(`${dir}H${v}.otf`)}`
  })))
]

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/** 极简 zip 解包：按文件名找第一个匹配条目（store/deflate） */
async function extractFromZip(zipBuf, entryName) {
  const { inflateRawSync } = require('zlib')
  // 遍历 local file header（签名 PK\x03\x04）
  let off = 0
  while (off + 30 <= zipBuf.length) {
    if (zipBuf.readUInt32LE(off) !== 0x04034b50) break
    const method = zipBuf.readUInt16LE(off + 8)
    const compSize = zipBuf.readUInt32LE(off + 18)
    const nameLen = zipBuf.readUInt16LE(off + 26)
    const extraLen = zipBuf.readUInt16LE(off + 28)
    const name = zipBuf.toString('utf8', off + 30, off + 30 + nameLen)
    const dataStart = off + 30 + nameLen + extraLen
    if (name.endsWith(entryName)) {
      const data = zipBuf.subarray(dataStart, dataStart + compSize)
      return method === 0 ? Buffer.from(data) : inflateRawSync(data)
    }
    off = dataStart + compSize
  }
  throw new Error(`zip 中未找到 ${entryName}`)
}

async function main() {
  await mkdir(FONTS_DIR, { recursive: true })
  await mkdir(ASSETS_DIR, { recursive: true })

  // Make every already-present optional font usable by the local renderer,
  // including manually added CJK fonts that are not in the download catalog.
  for (const file of await readdir(ASSETS_DIR)) {
    if (!/\.(?:ttf|otf|woff2?)$/i.test(file)) continue
    const publicDest = path.join(FONTS_DIR, file)
    if (!existsSync(publicDest)) await copyFile(path.join(ASSETS_DIR, file), publicDest)
  }

  for (const f of FONTS) {
    const bundled = STARTER_FILES.has(f.file)
    const dest = path.join(bundled ? FONTS_DIR : ASSETS_DIR, f.file)
    const publicDest = path.join(FONTS_DIR, f.file)
    if (existsSync(dest)) {
      if (!existsSync(publicDest)) {
        await copyFile(dest, publicDest)
        console.log(`已存在并启用: ${f.file}`)
      } else {
        console.log(`已存在，跳过: ${f.file}`)
      }
      continue
    }
    process.stdout.write(`下载 ${f.name} ... `)
    try {
      let buf = await fetchBuffer(f.url)
      if (f.zipEntry) buf = await extractFromZip(buf, f.zipEntry)
      await writeFile(dest, buf)
      if (!bundled) await writeFile(publicDest, buf)
      console.log(`OK (${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
    } catch (err) {
      console.log(`失败: ${err.message}（应用会回退系统字体，可稍后重试）`)
    }
  }
}

main()
