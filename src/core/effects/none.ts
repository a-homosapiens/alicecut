import { IDENTITY_FX, type EffectPreset } from './types'

/** Explicitly keep text at its resting pose for the whole In/Out window. */
export const none: EffectPreset = {
  id: 'none',
  name: 'None',
  picker: 'both',
  enterDuration: 1,
  layoutVariant: 'center',
  unit: 'line',
  appearAtLineStart: true,
  apply: () => IDENTITY_FX
}
