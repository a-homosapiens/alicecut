/**
 * Dynamic Caption — Effect Plugin SDK (api = 1)
 * 动态歌词 · 特效插件公开契约
 *
 * Standalone, dependency-free type declarations for authoring third-party
 * text-effect plugins. A plugin is an ES module whose `default` export is a
 * `PluginManifest`. The host validates the manifest, runs each effect in an
 * isolation probe, then registers it so it appears in the effect picker and
 * renders identically in preview and export.
 *
 * This file is the published, machine-readable contract. It is kept in exact
 * sync with the host implementation in `src/core/effects/sdk.ts`
 * (guarded by `src/core/effects/sdk-parity.test.ts`). Author against THIS file.
 *
 * See `plugin-sdk/README.md` for the contributor guide (coordinate system,
 * units, timing, determinism rules, validation, and import).
 */

/**
 * Pure helpers handed to `apply` as its second argument. Use these instead of
 * reaching for host globals — plugins must be pure and deterministic.
 */
export interface PluginHelpers {
  /** Clamp to [0, 1]. */
  clamp01(t: number): number
  /** Linear interpolate: a + (b - a) * t. */
  lerp(a: number, b: number, t: number): number
  /** Ease-out cubic: fast start, gentle stop. */
  easeOutCubic(t: number): number
  /** Ease-out back: overshoots past 1 then settles (a little "pop"). */
  easeOutBack(t: number): number
  /** Underdamped spring 0→1 with a few decaying bounces (peak ~1.12). */
  spring(t: number): number
  /** Smooth deterministic value noise in [-1, 1], continuous over `x`. */
  noise(seed: number, x: number): number
}

/**
 * The transform a plugin returns for one character at one frame. Every field
 * is optional — return only what you change; the host merges over identity and
 * clamps to safe ranges. Identity = { dx:0, dy:0, scale:1, rotate:0, alpha:1,
 * blur:0, glow:0, highlight:0, skewX:0, skewY:0 }.
 *
 * Units:
 * - dx, dy     : canvas pixels (translation; +x right, +y down)
 * - scale      : multiplier (1 = unchanged; clamped to >= 0)
 * - rotate     : radians
 * - alpha      : 0..1 opacity (clamped)
 * - blur       : pixels (>= 0; >0 applies a blur)
 * - glow       : pixels (>= 0; >0 applies a colored glow using style.glowColor)
 * - highlight  : 0..1 blend toward style.highlightColor (clamped)
 * - skewX,skewY: shear, in radians-ish magnitude
 */
export type PartialCharFx = Partial<{
  dx: number
  dy: number
  scale: number
  rotate: number
  alpha: number
  blur: number
  glow: number
  highlight: number
  skewX: number
  skewY: number
}>

/**
 * Arguments passed to `apply` for one character at one frame. All times are in
 * milliseconds, relative to the line start unless noted.
 */
export interface TextFxArgs {
  /** Index of the animation unit (char or word) within the line. */
  unitIndex: number
  /** Total animation units in the line. */
  unitCount: number
  /** Index of this character within its unit (0 for word/char-per-unit). */
  charIndexInUnit: number
  /** Enter progress 0..1 (linear, un-eased; stays 1 after the unit has entered). */
  enterT: number
  /** Milliseconds since the line started. */
  timeInLine: number
  /** Total line duration, ms. */
  lineDuration: number
  /** This unit's start, ms relative to line start (for karaoke "current word"). */
  unitStart: number
  /** This unit's end, ms relative to line start. */
  unitEnd: number
  /** User intensity slider; 1 is the default. Scale your motion by this. */
  intensity: number
  /**
   * Deterministic random in [0, 1). Seeded per line and stable across frames:
   * the SAME key returns the SAME value every frame. This is the ONLY source of
   * randomness allowed — never use Math.random()/Date/performance.
   */
  rand(key: number): number
}

/** One text effect contributed by a plugin. */
export interface TextEffectDef {
  /** Globally unique id; namespace it, e.g. "alice.wave". */
  id: string
  /** Display name shown in the effect picker. */
  name: string
  /** Animation unit: per character or per word. */
  unit: 'char' | 'word'
  /** Per-unit enter animation duration, ms (e.g. 300). */
  enterDurationMs: number
  /** If true, all chars appear at line start together (karaoke-style). */
  appearAtLineStart?: boolean
  /**
   * Pure, synchronous, deterministic. Called once per character per frame.
   * Must return quickly (it runs thousands of times). Return a PartialCharFx.
   */
  apply(args: TextFxArgs, m: PluginHelpers): PartialCharFx
}

/** A plugin's default export. */
export interface PluginManifest {
  /** Contract version. Must be 1. */
  api: 1
  /** Plugin name. */
  name: string
  /** Optional semver string. */
  version?: string
  /** Optional author handle. */
  author?: string
  /** Text effects contributed by this plugin. */
  textEffects?: TextEffectDef[]
}

/** Convenience type for `export default definePlugin({...})`-style authoring. */
export declare function definePlugin(manifest: PluginManifest): PluginManifest
