/**
 * 下载内置开源中文字体到 public/fonts/（不进 git 仓库）。
 * 运行：npm run fonts
 * 失败不影响使用——应用会回退到系统字体。
 */
const { writeFile, mkdir } = require('fs/promises')
const { existsSync } = require('fs')
const path = require('path')

const FONTS_DIR = path.join(__dirname, '..', 'public', 'fonts')

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
  }
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
  for (const f of FONTS) {
    const dest = path.join(FONTS_DIR, f.file)
    if (existsSync(dest)) {
      console.log(`已存在，跳过: ${f.file}`)
      continue
    }
    process.stdout.write(`下载 ${f.name} ... `)
    try {
      let buf = await fetchBuffer(f.url)
      if (f.zipEntry) buf = await extractFromZip(buf, f.zipEntry)
      await writeFile(dest, buf)
      console.log(`OK (${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
    } catch (err) {
      console.log(`失败: ${err.message}（应用会回退系统字体，可稍后重试）`)
    }
  }
}

main()
