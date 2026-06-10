export interface FontOption {
  family: string
  label: string
}

/** Windows 常见中文字体（系统自带，无需打包） */
export const SYSTEM_FONTS: FontOption[] = [
  { family: 'Microsoft YaHei', label: '微软雅黑' },
  { family: 'SimHei', label: '黑体' },
  { family: 'KaiTi', label: '楷体' },
  { family: 'DengXian', label: '等线' },
  { family: 'SimSun', label: '宋体' },
  { family: 'Impact', label: 'Impact（西文）' }
]

/** 内置开源字体：放在 public/fonts 下，缺文件时静默跳过 */
const BUILTIN_FONTS: { family: string; label: string; url: string }[] = [
  { family: 'Smiley Sans', label: '得意黑', url: './fonts/SmileySans-Oblique.ttf' },
  { family: 'LXGW WenKai', label: '霞鹜文楷', url: './fonts/LXGWWenKai-Medium.ttf' }
]

export async function loadBuiltinFonts(): Promise<FontOption[]> {
  const loaded: FontOption[] = []
  for (const f of BUILTIN_FONTS) {
    try {
      const res = await fetch(f.url)
      if (!res.ok) continue
      const face = new FontFace(f.family, await res.arrayBuffer())
      await face.load()
      document.fonts.add(face)
      loaded.push({ family: f.family, label: f.label })
    } catch {
      // 字体文件不存在时跳过，回落系统字体
    }
  }
  return loaded
}

/** 用户导入 ttf/otf：注册到 document.fonts，返回可用的 font-family */
export async function registerImportedFont(name: string, data: ArrayBuffer): Promise<FontOption> {
  const family = name
  const face = new FontFace(family, data)
  await face.load()
  document.fonts.add(face)
  return { family, label: `${name}（导入）` }
}
