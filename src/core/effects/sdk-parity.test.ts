import { describe, expect, it } from 'vitest'
// Published, dependency-free contract (what authors code against):
import type {
  PartialCharFx as PubPartialCharFx,
  TextFxArgs as PubTextFxArgs,
  PluginHelpers as PubHelpers,
  TextEffectDef as PubTextEffectDef,
  PluginManifest as PubManifest
} from '../../../plugin-sdk/effect-plugin'
// Host implementation (source of truth):
import {
  validateManifest,
  textEffectToPreset,
  sanitizeCharFx,
  HELPERS,
  type PartialCharFx,
  type TextFxArgs,
  type PluginHelpers,
  type TextEffectDef,
  type PluginManifest
} from './sdk'

/**
 * Keeps plugin-sdk/effect-plugin.d.ts in exact sync with src/core/effects/sdk.ts.
 * If the host contract changes without updating the published .d.ts (or vice
 * versa), these compile-time assertions fail under `npm run typecheck`.
 */

// Bidirectional assignability => structurally identical.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
function assignableBothWays<A, B>(_a: Exact<A, B> extends true ? true : never): void {}

// These three must match exactly between published and host.
assignableBothWays<PubPartialCharFx, PartialCharFx>(true)
assignableBothWays<PubTextFxArgs, TextFxArgs>(true)
assignableBothWays<PubHelpers, PluginHelpers>(true)
// Effect def matches exactly too.
assignableBothWays<PubTextEffectDef, TextEffectDef>(true)
// Manifest: published `api: 1` is intentionally narrower than host `api: number`,
// so we only require a published manifest to be a valid host manifest.
const _manifestAssignable: PluginManifest = {} as PubManifest
void _manifestAssignable

describe('SDK parity (published .d.ts ↔ host sdk.ts)', () => {
  it('a manifest authored to the published contract is accepted by the host', () => {
    const plugin: PubManifest = {
      api: 1,
      name: 'Parity',
      version: '1.0.0',
      author: 'test',
      textEffects: [
        {
          id: 'parity.demo',
          name: 'Demo',
          unit: 'char',
          enterDurationMs: 300,
          apply: (a, m) => ({ dy: (1 - m.easeOutCubic(a.enterT)) * 40, alpha: m.clamp01(a.enterT) })
        }
      ]
    }
    const validated = validateManifest(plugin)
    expect(validated.name).toBe('Parity')
    expect(validated.textEffects).toHaveLength(1)
  })

  it('helpers expose exactly the documented surface', () => {
    expect(Object.keys(HELPERS).sort()).toEqual(
      ['clamp01', 'easeOutBack', 'easeOutCubic', 'lerp', 'noise', 'spring'].sort()
    )
  })

  it('apply output flows through the documented merge+clamp', () => {
    const def: PubTextEffectDef = {
      id: 'parity.clamp',
      name: 'Clamp',
      unit: 'char',
      enterDurationMs: 200,
      apply: () => ({ alpha: 9, scale: -3, dy: 12 })
    }
    const preset = textEffectToPreset(def as TextEffectDef)
    const fx = preset.apply({
      unitIndex: 0,
      unitCount: 1,
      charIndexInUnit: 0,
      enterT: 1,
      timeInLine: 0,
      lineDuration: 1000,
      unitStart: 0,
      unitEnd: 500,
      intensity: 1,
      rand: () => 0.5
    })
    expect(fx.alpha).toBe(1) // clamped
    expect(fx.scale).toBe(0) // clamped
    expect(fx.dy).toBe(12) // passed through
  })

  it('sanitizeCharFx documents identity defaults', () => {
    const fx: PartialCharFx = {}
    expect(sanitizeCharFx(fx)).toMatchObject({ dx: 0, dy: 0, scale: 1, alpha: 1, highlight: 0 })
  })
})
