/**
 * AliceCut — Effect Plugin SDK (api = 1)
 * AliceCut · 特效插件公开契约
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
   * Declarative geometric reveal (a clip mask `apply` cannot express): during
   * the enter window the line is revealed by an animated clip region — `wipe`
   * (rectangle sweep), `iris` (circle grows), or `clockWipe` (angular sweep).
   * Pair with `appearAtLineStart: true` (whole line present, mask reveals it).
   * Your `apply` still runs (often just return {} for identity, or add motion).
   */
  reveal?: 'wipe' | 'iris' | 'clockWipe'
  /**
   * Declarative motion-blur trail: while a char moves, draw `count` fading
   * ghosts sampled at earlier times. `stepMs` spaces the ghosts; `decay` (0..1)
   * fades them. Host clamps count to 12 and stepMs to [1,200].
   */
  trail?: { count: number; stepMs: number; decay?: number }
  /** Declarative: draw a rounded highlight box behind the current word that
   *  springs word-to-word (TikTok-style). */
  wordBox?: boolean
  /**
   * Pure, synchronous, deterministic. Called once per character per frame.
   * Must return quickly (it runs thousands of times). Return a PartialCharFx.
   */
  apply(args: TextFxArgs, m: PluginHelpers): PartialCharFx
}

/** Arguments passed to a line transition's `enterFrom`/`pose`. */
export interface LineFxArgs {
  /** Line index; direction is often taken from its parity for continuity. */
  lineId: number
  width: number
  height: number
  fontSize: number
  intensity: number
  /**
   * Un-scaled bounding boxes (canvas px) per depth: `blocks[0]` is the current
   * center line, `blocks[d]` is the d-th docked older line. Use these to dock
   * lines flush against each other regardless of their actual size.
   */
  blocks: { w: number; h: number }[]
}

/** Whole-line transform (about the canvas center). Return only what you change. */
export type PartialLineFx = Partial<{
  dx: number
  dy: number
  scale: number
  rotate: number
  alpha: number
  blur: number
}>

/**
 * A whole-line docking transition (`unit: 'line'`). The new line enters center
 * stage; older lines don't vanish — they scale/rotate and dock (stacked above /
 * stood at the side) as history. When a new line enters, every line eases from
 * `pose(depth-1)` to `pose(depth)`, and the new line from `enterFrom` to
 * `pose(0)`. `enterFrom`/`pose` are pure functions of LineFxArgs.
 */
export interface LineEffectDef {
  id: string
  name: string
  /** Enter animation duration, ms. */
  enterDurationMs: number
  /** How many docked older lines to keep (deeper ones fade out). Host clamps 0..6. */
  maxDepth: number
  /** The entering line's start pose. */
  enterFrom(args: LineFxArgs, m: PluginHelpers): PartialLineFx
  /** Pose of the depth-th line; depth 0 is the current center line. */
  pose(depth: number, args: LineFxArgs, m: PluginHelpers): PartialLineFx
}

/** A whole-clip video transition transform. Return only what you change. */
export type PartialVideoFx = Partial<{
  /** 0..1 opacity. */
  alpha: number
  /** translate as a fraction of canvas width/height. */
  dxFrac: number
  dyFrac: number
  /** extra scale multiplied onto the clip's own scale. */
  scale: number
  /** wipe mask revealing `reveal` (0..1) from a side; null = no clip. */
  wipe: { dir: 'L' | 'R' | 'U' | 'D'; reveal: number } | null
}>

/**
 * A video transition (enter/leave). `in(p)`: p goes 0→1 (1 = fully in place).
 * `out(p)`: p goes 1→0 (1 = still whole, 0 = gone). Pure functions returning
 * PartialVideoFx. A transition *between two clips* is done by overlapping the
 * second clip's start before the first ends and giving it an `in` transition.
 */
export interface VideoTransitionDef {
  id: string
  name: string
  in(p: number, m: PluginHelpers): PartialVideoFx
  out(p: number, m: PluginHelpers): PartialVideoFx
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
  /** Whole-line docking transitions contributed by this plugin. */
  lineTransitions?: LineEffectDef[]
  /** Video transitions (enter/leave) contributed by this plugin. */
  videoTransitions?: VideoTransitionDef[]
}

/** Convenience type for `export default definePlugin({...})`-style authoring. */
export declare function definePlugin(manifest: PluginManifest): PluginManifest
