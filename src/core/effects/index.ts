import type { EffectPreset } from './types'
import { pop } from './pop'
import { typewriter } from './typewriter'
import { slide } from './slide'
import { punch } from './punch'
import { glow } from './glow'
import { flip, flipBottom } from './flip'
import { rise } from './rise'
import { karaoke } from './karaoke'
import { highlightBox } from './highlightBox'
import { bounce } from './bounce'
import { wobble } from './wobble'
import { streak } from './streak'
import { wipe, iris, clockWipe } from './reveals'

/** 内置特效（第一方） */
export const EFFECTS: EffectPreset[] = [
  pop,
  punch,
  slide,
  typewriter,
  glow,
  karaoke,
  highlightBox,
  bounce,
  streak,
  wobble,
  wipe,
  iris,
  clockWipe,
  flip,
  flipBottom,
  rise
]

/** 第三方插件特效注册表（运行时导入注入） */
const pluginRegistry = new Map<string, EffectPreset>()

/** 注册（或覆盖）一个插件特效 */
export function registerTextEffect(preset: EffectPreset): void {
  pluginRegistry.set(preset.id, preset)
}

/** 当前已注册的插件特效 */
export function pluginEffects(): EffectPreset[] {
  return [...pluginRegistry.values()]
}

export function getEffect(id: string): EffectPreset {
  return pluginRegistry.get(id) ?? EFFECTS.find((e) => e.id === id) ?? pop
}

export type { EffectPreset, CharFx, FxArgs, LineFx, LineFxArgs, LineTransition } from './types'
