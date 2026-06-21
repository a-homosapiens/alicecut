import { validateManifest, textEffectToPreset, lineEffectToPreset, videoTransitionToImpl, type PluginManifest } from './core/effects/sdk'
import { registerTextEffect } from './core/effects'
import { registerVideoTransition } from './core/media'
import { probePluginInWorker, SandboxUnavailableError } from './pluginSandbox'

/**
 * 运行时装载第三方特效插件。
 *
 * 安全闸门：先把源码送进隔离 Worker 探针（全局遮蔽 + 硬超时 + 样本网格两跑），
 * 抓死循环 / 访问被禁全局 / 非确定性。通过后才在主世界 import 取得可用的实时函数。
 * Worker 不可用（node/vitest/headless）时降级为仅同步校验（见 docs/plugin-platform.md）。
 */
export interface LoadResult {
  manifest: PluginManifest
  /** 是否经过了 Worker 硬隔离闸门（false = 环境无 Worker，已降级软校验） */
  sandboxed: boolean
}

export async function loadPluginSource(src: string): Promise<LoadResult> {
  // 1) 硬隔离闸门（在主世界导入之前，先抓住死循环/逃逸）
  let sandboxed = false
  try {
    const report = await probePluginInWorker(src)
    sandboxed = true
    const fatal = report.issues.filter((i) => i.level === 'error')
    if (fatal.length > 0) {
      throw new Error('插件未通过隔离校验：\n' + fatal.map((i) => `• ${i.effect ? `[${i.effect}] ` : ''}${i.message}`).join('\n'))
    }
  } catch (err) {
    if (!(err instanceof SandboxUnavailableError)) throw err
    // 环境无 Worker：降级，靠后续同步校验兜底
    sandboxed = false
  }

  // 2) 主世界导入取得实时清单（apply 为真实函数，供注册使用）
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
  try {
    const mod = await import(/* @vite-ignore */ url)
    return { manifest: validateManifest(mod.default), sandboxed }
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

/** 安装插件的整行停靠式转场到注册表，返回登记的 {id,name} */
export function installLineEffects(manifest: PluginManifest): { id: string; name: string }[] {
  const added: { id: string; name: string }[] = []
  for (const def of manifest.lineTransitions ?? []) {
    registerTextEffect(lineEffectToPreset(def))
    added.push({ id: def.id, name: def.name })
  }
  return added
}

/** 安装插件的视频转场到注册表，返回登记的 {id,name} */
export function installVideoTransitions(manifest: PluginManifest): { id: string; name: string }[] {
  const added: { id: string; name: string }[] = []
  for (const def of manifest.videoTransitions ?? []) {
    registerVideoTransition(videoTransitionToImpl(def))
    added.push({ id: def.id, name: def.name })
  }
  return added
}

/**
 * 安装插件全部能力。文字+整行特效进特效选择器（pickerEffects），
 * 视频转场进时间轴转场菜单（videoTransitions），分别返回供 UI 登记。
 */
export function installPlugin(manifest: PluginManifest): {
  pickerEffects: { id: string; name: string }[]
  videoTransitions: { id: string; name: string }[]
} {
  return {
    pickerEffects: [...installTextEffects(manifest), ...installLineEffects(manifest)],
    videoTransitions: installVideoTransitions(manifest)
  }
}
