# Plan: GPU-Resident Export via WebCodecs (Frame-Sink Fork)

Status: H.264 path implemented 2026-07-18; HEVC WebCodecs remains deferred

Implemented outcome: the frame-sink fork, Annex B H.264 copy-mux path, GPU-backed
Canvas, queue backpressure, headless `gpu:true` opt-in, raw fallback, and focused
tests are landed in the working tree. The current dispatch intentionally limits
WebCodecs to H.264; HEVC and ProRes remain on FFmpeg rawvideo. On the reference
1080×1920@30 8-second jobs, static export improved 15.429s → 5.826s (62.2%) and
video export improved 20.592s → 11.329s (45.0%). Static software/WebCodecs
output measured SSIM 0.996893 with matching duration, fps, dimensions, and audio.

## 1. Problem

The current export pipeline moves every uncompressed frame across the GPU/CPU
boundary multiple times. With a background video and a hardware encoder the
worst case is:

```
GPU (video decode) → CPU (canvas, willReadFrequently forces software raster)
→ CPU copy (getImageData) → CPU copy (IPC structured clone)
→ CPU copy (ffmpeg stdin pipe) → GPU (NVENC/QSV/AMF upload)
```

At 1080p30 that is ~8.3 MB × 4–5 touches per frame ≈ >1 GB/s of memory
traffic for pixels that start and end on the GPU. The `willReadFrequently`
canvas also forces all compositing (video `drawImage`, `shadowBlur` glow,
`ctx.filter` blur) onto the CPU raster path.

## 2. Target architecture

Only the tail end of the pipeline forks. Frame production (video seek/wait,
`renderFrame`, progress, cancellation) stays single-path; what happens after
a frame exists on the canvas is abstracted behind a **frame sink**:

```
runExport (shared: seek videos → renderFrame → per-frame loop)
   └─ FrameSink interface
       ├─ RawFrameSink       getImageData → IPC → ffmpeg -f rawvideo → x264/prores/hw encode
       └─ WebCodecsFrameSink VideoFrame(canvas) → VideoEncoder(hw) → IPC (KB chunks) → ffmpeg -c:v copy mux
```

On the WebCodecs path the uncompressed frame never leaves the GPU:
decode → composite → encode all stay GPU-resident, and only the compressed
bitstream (~10–50 KB/frame, ~200× smaller) crosses IPC. ffmpeg remains the
single muxer, and the entire audio filter graph
(`atrim/atempo/aloop/afade/adelay/amix`) is untouched in both modes.

## 3. Dispatch rule

Use `WebCodecsFrameSink` only when **all** of the following hold; otherwise
fall back silently to `RawFrameSink` with a `console.warn` (same convention
as `resolveEncoder` in `electron/exporter.ts`):

1. `encode.codec !== 'prores'` — WebCodecs cannot produce ProRes.
2. `videoFrameMode !== 'exact'` — preserves the byte-identical-rerun
   guarantee (DESIGN.md §2); hardware encoders do not promise byte-stable
   output across runs. `'fast'` already trades determinism for speed, so
   gating on it is philosophically consistent.
3. `encode.hwAccel === 'auto'` — keeps the default `'software'` config
   byte-identical to today's output; no silent behavior change for existing
   users/jobs.
4. `VideoEncoder.isConfigSupported({ hardwareAcceleration: 'prefer-hardware', … })`
   resolves supported (probed per codec, cached like `encoderCache`).

Chromium's software WebCodecs fallback (OpenH264) is markedly worse than
x264 `-crf 18`, so "no hardware" falls back to the existing raw pipeline,
never to WebCodecs-software.

## 4. Phases

### Phase 1 — Extract the sink interface (pure refactor, ~0.5 day)

- New `src/export/frameSink.ts`:

  ```ts
  interface FrameSink {
    start(): Promise<void>
    submit(canvas, frameIndex, tMs): Promise<void>   // owns backpressure
    finish(): Promise<{ code: number; log: string }>
    cancel(): Promise<void>
  }
  ```

- Move `getImageData` + `exportFrame` IPC + the `MAX_INFLIGHT` window out of
  `src/exportRunner.ts` into `RawFrameSink`. `runExport` gains a `sink`
  parameter and loses direct `window.desktop.export*` calls.
- Canvas creation must move to *after* sink selection:
  `willReadFrequently: true` is only wanted for the raw sink; the WebCodecs
  sink needs a GPU-backed canvas. The sink supplies canvas context options.
- **Exit criterion:** GUI and headless exports are byte-identical to before.

### Phase 2 — Main process learns to mux instead of encode (~0.5 day)

- Extend `ExportOptions` (`electron/exporter.ts`) with
  `videoInput: { kind: 'rawvideo' } | { kind: 'annexb'; codec: 'h264' | 'hevc' }`.
- New pure `buildMuxArgs` in `electron/exporterCore.ts` (unit-testable next
  to `buildVideoArgs`):
  - Input side: `-f h264|hevc -framerate <fps> -i pipe:0`. Annex B carries
    no timestamps; CFR from `-framerate` matches what rawvideo does today.
  - Output side: `-c:v copy` instead of encode args; keep `-t`,
    `-movflags +faststart`, audio graph and `-map` logic as-is.
  - HEVC-in-mp4: add `-tag:v hvc1` (QuickTime/Apple compatibility).
- `export:frame` IPC handler unchanged — it just writes bytes; chunks are
  simply ~200× smaller.
- Tests for `buildMuxArgs` in `electron/exporterCore.test.ts`.

### Phase 3 — `WebCodecsFrameSink` (~1–1.5 days)

New `src/export/webcodecsSink.ts`; pure config-mapping parts in a separate
DOM-free module for unit testing.

- **Encoder config:**
  - Codec string: `avc1.<profile><level>` for h264 (High profile, level
    computed from width×height×fps, e.g. `avc1.640028` for 1080p30, higher
    for 4K); `hvc1.1.6.L<level>.B0` for hevc.
  - `avc: { format: 'annexb' }` / `hevc: { format: 'annexb' }` so ffmpeg can
    ingest the stream directly.
  - `latencyMode: 'quality'`, `hardwareAcceleration: 'prefer-hardware'`.
- **Quality tiers:** WebCodecs is bitrate-driven (no CRF). Reuse the
  bits-per-pixel approach already proven for VideoToolbox
  (`exporterCore.ts` VT tables): `bitrate = w·h·fps·bpp` with a
  fast/balanced/quality bpp table per codec. Starting points:
  h264 ≈ 0.07 / 0.10 / 0.14, hevc × 0.6. Tune in Phase 5.
- **Frame loop (`submit`):**
  - `new VideoFrame(canvas, { timestamp: n * 1e6 / fps, duration: 1e6 / fps })`
  - `encoder.encode(frame, { keyFrame: n % (2 * fps) === 0 })` — 2 s GOP so
    players can seek.
  - `frame.close()` immediately after encode.
  - Backpressure: `while (encoder.encodeQueueSize > 4) await 'dequeue' event`
    — replaces `MAX_INFLIGHT` naturally.
- **Output callback:** copy each `EncodedVideoChunk` into a `Uint8Array`,
  forward through the existing `exportFrame` IPC. Chunk order is guaranteed
  by the encoder.
- **`finish`:** `await encoder.flush()` → `encoder.close()` → `exportEnd`.
- **`cancel`:** `encoder.close()` → `exportCancel`.
- **Errors:** the encoder `error` callback rejects the in-flight `submit`,
  so `runExport`'s existing catch path cleans up.
- Dispatch helper `chooseSink(encode, videoFrameMode)` implementing §3,
  with the `isConfigSupported` result cached per codec.

### Phase 4 — Headless opt-in (~0.5 day)

- `electron/main.ts` currently calls `app.disableHardwareAcceleration()` for
  every `--export` run (CI / GPU-less compatibility), which kills this path
  in CLI mode.
- Add an opt-in job field (e.g. `"gpu": true` in job.json, parsed in
  `electron/headless.ts`) that skips the disable. Default stays software so
  CI/xvfb keeps working unchanged.
- No extra renderer logic needed: with the GPU off,
  `isConfigSupported(prefer-hardware)` fails and dispatch rule 4 falls back
  by itself.
- Document in MANUAL.md job-file table.

### Phase 5 — Validation & tuning (~1–1.5 days)

- **Correctness:** export the sample project both ways; `ffprobe` checks
  (codec, resolution, fps, duration, `hvc1` tag, faststart) — extend the
  existing e2e smoke pattern.
- **Quality tuning:** A/B the bpp table against the x264 tiers on 2–3 real
  projects (text-on-video, text-only); adjust until visually equivalent per
  tier.
- **Speed measurement:** wall-clock old vs. new on a video-background
  project; record the number in DESIGN.md.
- **Fallback matrix by hand:** prores → raw; `exact` → raw;
  `hwAccel:'software'` → raw; headless without `gpu:true` → raw;
  `isConfigSupported` forced false → raw with warning.
- Update DESIGN.md §6 (pipeline diagram gains the sink fork) and the §9
  decision table.

## 5. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Driver produces broken output (e.g. NVENC on old drivers) | User sets `hwAccel: 'software'`, which routes to the raw path by dispatch rule 3 — escape hatch already exists |
| Quality tier mismatch vs. x264 CRF tiers | Phase 5 tuning; worst case ship conservative (higher) bitrates |
| Dual-sink maintenance burden | `FrameSink` is 4 methods; the shared ~90 % (frame production) stays single-path; raw sink remains the permanent fallback |
| Byte-determinism guarantees | `'exact'` mode always uses the raw sink (rule 2); defaults unchanged (rule 3) |

## 6. Relationship to other optimizations

Independent quick wins that land **before** Phase 1 without conflict, and
make the raw sink (i.e. every fallback case) faster too:

- **Duplicate-frame skip** ✅ *landed 2026-07-05* (`renderFingerprint` in
  `src/core/render.ts` + skip logic in `runExport`): frames whose fingerprint
  (all time-dependent draw state) matches the previous frame resend the cached
  buffer, skipping seek/render/readback. Verified byte-identical output on the
  扬州慢 example; wall clock 3m07 → 2m47 (~11%). The modest gain confirms IPC +
  x264 encode of every (even duplicate) frame is the dominant cost on text-only
  projects — exactly what this plan's compressed-bitstream path removes.
- **Static text-layer cache:** with a video background, render the (usually
  static) text layer — including expensive `shadowBlur`/glow — once per
  steady-state segment into an offscreen canvas and `drawImage` it over the
  video each frame; re-render only while an enter/exit animation is active.

Recommended pre-work regardless of this plan: add per-stage timers to
`runExport` (video wait / render / readback / IPC, accumulated ms logged
once at the end) to confirm which stage dominates for text-only vs.
video-background projects.
