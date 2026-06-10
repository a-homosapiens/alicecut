import type { EffectPreset } from './types'
import { pop } from './pop'
import { typewriter } from './typewriter'
import { slide } from './slide'
import { punch } from './punch'
import { glow } from './glow'
import { flip, flipBottom } from './flip'
import { rise } from './rise'

export const EFFECTS: EffectPreset[] = [pop, punch, slide, typewriter, glow, flip, flipBottom, rise]

export function getEffect(id: string): EffectPreset {
  return EFFECTS.find((e) => e.id === id) ?? pop
}

export type { EffectPreset, CharFx, FxArgs, LineFx, LineFxArgs, LineTransition } from './types'
