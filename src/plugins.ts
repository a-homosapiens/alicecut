import { validateManifest, textEffectToPreset, type PluginManifest } from './core/effects/sdk'
import { registerTextEffect } from './core/effects'

/**
 * 运行时装载第三方特效插件（原型）：把插件源码当 ES module 经 blob URL 动态 import，
 * 取其默认导出清单并校验。注意：此为软装载，尚未做全局遮蔽/硬沙箱（见 docs/plugin-platform.md）。
 */
export async function loadPluginSource(src: string): Promise<PluginManifest> {
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
  try {
    const mod = await import(/* @vite-ignore */ url)
    return validateManifest(mod.default)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 安装插件的文字特效到注册表，返回登记的 {id,name}（供选择器展示） */
export function installTextEffects(manifest: PluginManifest): { id: string; name: string }[] {
  const added: { id: string; name: string }[] = []
  for (const def of manifest.textEffects ?? []) {
    registerTextEffect(textEffectToPreset(def))
    added.push({ id: def.id, name: def.name })
  }
  return added
}
