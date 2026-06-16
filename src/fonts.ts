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

/** 内置开源/免费商用字体：放在 public/fonts 下（npm run fonts 下载），缺文件时静默跳过 */
const BUILTIN_FONTS: { family: string; label: string; url: string }[] = [
  { family: 'Smiley Sans', label: '得意黑', url: './fonts/SmileySans-Oblique.ttf' },
  { family: 'LXGW WenKai', label: '霞鹜文楷', url: './fonts/LXGWWenKai-Medium.ttf' },
  { family: '庞门正道标题体', label: '庞门正道标题体', url: './fonts/PangmenZhengdaoBiaoti.ttf' },
  { family: '庞门正道粗书体', label: '庞门正道粗书体', url: './fonts/PangmenZhengdaoCushu.ttf' },
  { family: '庞门正道轻松体', label: '庞门正道轻松体', url: './fonts/PangmenZhengdaoQingsong.otf' },
  { family: '站酷高端黑', label: '站酷高端黑', url: './fonts/ZcoolGaoduanhei.ttf' },
  { family: '站酷酷黑体', label: '站酷酷黑体', url: './fonts/ZcoolKuhei.ttf' },
  { family: '站酷快乐体', label: '站酷快乐体', url: './fonts/ZcoolKuaile.ttf' },
  { family: '站酷文艺体', label: '站酷文艺体', url: './fonts/ZcoolWenyi.ttf' },
  { family: '站酷小薇LOGO体', label: '站酷小薇LOGO体', url: './fonts/ZcoolXiaoweiLogo.otf' },
  { family: '站酷庆科黄油体', label: '站酷庆科黄油体', url: './fonts/ZcoolQingkeHuangyou.ttf' },
  { family: '江西拙楷', label: '江西拙楷', url: './fonts/JiangxiZhuokai.ttf' },
  { family: '锐字真言体', label: '锐字真言体', url: './fonts/RuiziZhenyan.ttf' }
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
