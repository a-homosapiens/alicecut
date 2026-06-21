# Dynamic Caption — Effect Plugin SDK (api 1)

Write a **text effect**, drop it into the app, use it. This document is the
complete contract an author — human or agent — needs. Nothing else is required.

- **Types:** [`effect-plugin.d.ts`](./effect-plugin.d.ts) (standalone, dependency-free)
- **Manifest schema:** [`manifest.schema.json`](./manifest.schema.json)
- **Starter:** [`template.mjs`](./template.mjs)
- **Validate:** `node scripts/validate-plugin.ts your-plugin.mjs`

---

## 1. What a plugin is

A plugin is an **ES module** whose `default` export is a `PluginManifest`:

```js
export default {
  api: 1,
  name: 'My Effect Pack',
  version: '1.0.0',
  author: 'you',
  textEffects: [ /* one or more TextEffectDef */ ]
}
```

Each effect supplies a pure function `apply(args, m)` that the renderer calls
**once per character, per frame**, and which returns how that character is
transformed at that moment. The same function drives both the live preview and
the exported video — so it must be **deterministic**.

## 2. The `apply` contract

```js
apply(args, m) {
  // args: timing + position for this char at this frame  (TextFxArgs)
  // m:    pure helper functions                          (PluginHelpers)
  return { /* PartialCharFx — only the fields you change */ }
}
```

Return **only the fields you change**. The host merges your result over the
identity transform and clamps everything to safe ranges, so a missing field
means "unchanged" and an out-of-range or `NaN` value can never corrupt a frame.

Identity = `{ dx:0, dy:0, scale:1, rotate:0, alpha:1, blur:0, glow:0, highlight:0, skewX:0, skewY:0 }`.

## 3. Output fields — `PartialCharFx` (coordinate system & units)

The canvas origin is top-left; **+x is right, +y is down**. Each character is
transformed about its own center.

| Field      | Unit                | Default | Notes |
|------------|---------------------|---------|-------|
| `dx`       | canvas pixels       | 0       | horizontal translate (+ = right) |
| `dy`       | canvas pixels       | 0       | vertical translate (+ = down) |
| `scale`    | multiplier          | 1       | clamped to ≥ 0 |
| `rotate`   | **radians**         | 0       | about the char center |
| `alpha`    | 0..1                | 1       | opacity (clamped) |
| `blur`     | pixels (≥ 0)        | 0       | > 0 applies a blur |
| `glow`     | pixels (≥ 0)        | 0       | > 0 applies a glow in `style.glowColor` |
| `highlight`| 0..1                | 0       | blend toward `style.highlightColor` (karaoke) |
| `skewX`    | radians-ish shear   | 0       | horizontal shear |
| `skewY`    | radians-ish shear   | 0       | vertical shear |

Scale your motion by `args.intensity` (the user's intensity slider; 1 = default)
so users can dial your effect up and down.

### 3.1 Declarative capabilities (masks, trails, word box)

Some host render features can't be expressed by a per-character transform.
Request them with **declarative fields on the effect** (data, not code) — the
host renders them; your `apply` still runs alongside.

| Field | Type | Effect |
|-------|------|--------|
| `reveal` | `'wipe' \| 'iris' \| 'clockWipe'` | geometric clip-mask reveal over the enter window: rectangle sweep / circle grow / angular sweep |
| `trail` | `{ count, stepMs, decay? }` | motion-blur: `count` fading ghosts at earlier times (`stepMs` apart; `decay` 0..1). Host clamps `count`≤12, `stepMs`∈[1,200] |
| `wordBox` | `boolean` | rounded highlight box behind the current word, springing word-to-word (TikTok style) |

```js
// A masked iris reveal — the whole line is present and the mask opens it.
{
  id: 'you.iris', name: 'Iris In', unit: 'char',
  enterDurationMs: 520, appearAtLineStart: true,
  reveal: 'iris',
  apply() { return {} } // identity: let the clip mask do the reveal
}
```

Notes:
- Pair `reveal` with `appearAtLineStart: true` so the whole line is present and
  the mask sweeps over it (otherwise chars also gate in by their own timing).
- An unknown `reveal` value is dropped (not silently treated as `wipe`).
- These fields are static — they add no executable surface, so they pass the
  isolation gate untouched.

### 3.2 Whole-line docking transitions (`lineTransitions`)

For transitions where the **whole line** moves as a block and older lines stay
on screen as docked history (stacked above / stood at the side), use a
`LineEffectDef` in the manifest's `lineTransitions` array instead of a per-char
`apply`. Two pure functions return a `PartialLineFx` (`dx, dy, scale, rotate,
alpha, blur` — transform about the canvas center):

- `enterFrom(args, m)` — the entering line's start pose (it eases to `pose(0)`).
- `pose(depth, args, m)` — pose of the depth-th line; **`depth: 0` is the
  current center line** (return `{}` for identity), deeper = older docked lines.

`args` is `LineFxArgs`: `{ lineId, width, height, fontSize, intensity, blocks }`.
`blocks[d]` is the **un-scaled bounding box** `{w, h}` of the d-th line — use it
to dock lines flush against each other regardless of size. `maxDepth` sets how
many docked lines to keep (host clamps 0..6; deeper lines should fade out).

```js
// manifest: { api:1, name:'…', lineTransitions: [ … ] }
{
  id: 'you.stackUp', name: 'Stack Up', enterDurationMs: 460, maxDepth: 3,
  enterFrom: ({ height, intensity }) => ({ dy: height*0.2*intensity, scale: 0.6, alpha: 0 }),
  pose(depth, { fontSize, intensity, blocks }, m) {
    if (depth === 0) return {}                     // current line: center
    const s = 0.45 + 0.3*intensity
    const h = (d) => blocks[Math.min(d, blocks.length-1)].h
    let dy = -(h(0)/2 + fontSize*0.4)              // dock above the center line
    for (let k=1;k<depth;k++) dy -= h(k)*s + fontSize*0.4
    dy -= h(depth)*s/2
    return { dy, scale: s, alpha: depth>3 ? 0 : m.clamp01(1 - depth*0.3) }
  }
}
```

Same determinism rule applies (no `Math.random`/`Date`; the validator runs
`enterFrom`/`pose` twice). See `examples/plugin-lines.mjs`.

### 3.3 Video transitions (`videoTransitions`)

Plugins can also contribute **video** clip transitions (the enter/leave effects
in a timeline clip's 转场 menu). Provide `in`/`out` pure functions returning a
`PartialVideoFx`:

| Field | Unit | Meaning |
|-------|------|---------|
| `alpha` | 0..1 | clip opacity |
| `dxFrac`, `dyFrac` | fraction of canvas w/h | translate the whole clip |
| `scale` | multiplier | extra scale on top of the clip's own |
| `wipe` | `{ dir:'L'\|'R'\|'U'\|'D', reveal:0..1 } \| null` | clip-mask reveal from a side |

- `in(p, m)` — enter: `p` goes 0→1 (1 = fully in place).
- `out(p, m)` — leave: `p` goes 1→0 (1 = still whole, 0 = gone).

```js
// manifest: { api:1, name:'…', videoTransitions: [ … ] }
{
  id: 'you.punchIn', name: '冲入',
  in:  (p, m) => ({ alpha: m.clamp01(p*1.5), scale: 1.6 - 0.6*m.easeOutCubic(p) }),
  out: (p)    => ({ alpha: p, scale: 1 + 0.4*(1-p) })
}
```

A **transition between two clips** (e.g. A→B crossfade) is done by overlapping
clip B's start before A ends and giving B an `in` transition — the same model as
the built-ins (see the app manual). See `examples/plugin-video.mjs`.

## 4. Input fields — `TextFxArgs` (timing & position)

All times are **milliseconds**; `timeInLine`, `unitStart`, `unitEnd` are
relative to the line's start.

| Field              | Meaning |
|--------------------|---------|
| `unitIndex`        | index of this unit (char or word) within the line |
| `unitCount`        | number of units in the line |
| `charIndexInUnit`  | index of this char within its unit |
| `enterT`           | **enter progress 0..1**, linear; stays `1` after the unit has entered |
| `timeInLine`       | ms since the line started |
| `lineDuration`     | total line duration, ms |
| `unitStart`        | this unit's start, ms (for karaoke "current word") |
| `unitEnd`          | this unit's end, ms |
| `intensity`        | user intensity; multiply your motion by this |
| `rand(key)`        | deterministic random in [0,1) (see §6) |

**`enterT` vs `timeInLine`:** use `enterT` for the one-time entrance animation
(0 → 1 over `enterDurationMs`); use `timeInLine` for continuous/looping motion
that lasts the whole line (e.g. a sine wobble). For karaoke-style "current word"
highlighting, set `appearAtLineStart: true` and compare `timeInLine` against
`unitStart`/`unitEnd`.

## 5. Helpers — `m` (`PluginHelpers`)

Prefer these over writing your own; they match the host's built-ins exactly.

| Helper | Description |
|--------|-------------|
| `m.clamp01(t)`            | clamp to [0,1] |
| `m.lerp(a, b, t)`         | linear interpolate |
| `m.easeOutCubic(t)`       | fast start, gentle stop |
| `m.easeOutBack(t)`        | overshoot past 1 then settle |
| `m.spring(t)`             | underdamped spring 0→1 with bounces |
| `m.noise(seed, x)`        | smooth value noise in [-1,1], continuous in `x` |

`Math.sin`, `Math.cos`, etc. are fine to use directly.

## 6. Determinism — the one hard rule

The renderer must paint the **same frame** in preview and export. Therefore
`apply` must be a **pure function of its arguments**:

- ❌ **Never** call `Math.random()`, `Date.now()`, `new Date()`, or `performance.now()`.
- ❌ No network, DOM, storage, timers, or async.
- ✅ For randomness, use **`args.rand(key)`** — seeded per line, and **stable
  across frames** (the same `key` returns the same value every frame). Vary
  `key` by `unitIndex`/`charIndexInUnit` to decorrelate characters.

The validator runs every effect twice and rejects any non-deterministic output,
so a stray `Math.random()` fails before the plugin is ever imported.

## 7. Examples

A continuous wobble (uses `timeInLine` + `noise`):

```js
{
  id: 'you.wobble', name: 'Wobble', unit: 'char', enterDurationMs: 300,
  apply(a, m) {
    const seed = a.unitIndex * 31 + a.charIndexInUnit * 7 + 1
    const x = a.timeInLine / 600
    return {
      dy: m.noise(seed, x) * 6 * a.intensity,
      rotate: m.noise(seed + 99, x) * 0.05 * a.intensity,
      alpha: m.clamp01(a.enterT * 2)
    }
  }
}
```

A per-word spring drop (uses `enterT` + `spring`):

```js
{
  id: 'you.drop', name: 'Drop', unit: 'word', enterDurationMs: 600,
  apply(a, m) {
    const s = m.spring(m.clamp01(a.enterT))
    return { dy: (1 - s) * -60 * a.intensity, scale: 0.6 + 0.4 * s, alpha: m.clamp01(a.enterT * 3) }
  }
}
```

## 8. Validate, then import

1. **Validate** (catches non-determinism, NaN/range, throws, slow code, and
   banned globals — and prints sample output):

   ```
   node scripts/validate-plugin.ts your-plugin.mjs
   ```
   Exit code `0` = pass, `1` = failed. Fix every ✗ before sharing.

2. **Import** in the app: top bar → **导入插件 (Import plugin)** → pick your
   `.mjs`. The app re-validates and runs the plugin through an **isolation
   probe** (a Worker with shadowed globals and a hard timeout) before
   registering it. On success it appears in the 特效 (Effects) picker tagged
   「插件」, and works in both preview and export.

## 9. Safety model (what the host does for you)

- **Merge + clamp:** your `PartialCharFx` is merged over identity and clamped
  (`alpha`/`highlight` → [0,1], `scale`/`blur`/`glow` → ≥ 0, `NaN`/`Infinity` →
  safe defaults). You cannot crash a frame.
- **Catch:** a throwing `apply` falls back to identity for that character.
- **Isolation probe:** at import time the plugin is exercised in a Worker with
  `Date`/`Math.random`/`performance`/`fetch`/`document`/`window` shadowed and a
  timeout, so an infinite loop or a global-access attempt is caught at the gate.

> Per-frame execution still happens in the host realm (the renderer is
> synchronous), so the probe is a **gate**, not a perfect in-process jail.
> Full per-frame isolation (a synchronous QuickJS-WASM isolate) is the planned
> next step. Until then, only import plugins you have validated and trust.

## 10. Versioning

`api: 1` is the current contract. Breaking changes bump `api`; the host rejects
manifests whose `api` it doesn't support. New optional fields may be added
within `api: 1` without breaking existing plugins.
