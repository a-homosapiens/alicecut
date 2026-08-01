# AliceCut Development Diary

This is a chronological engineering diary for noteworthy product changes, debugging findings, and validation work. Add new entries at the top and keep implementation details concise enough to remain useful during later regressions.

## 2026-08-01 — Freeze frames, transition timing, caption continuity, and UI density

### Freeze-frame editing

- Added **Freeze Frame (3s)** for a selected video clip at the red playhead.
- The operation captures the exact source time, splits the clip, inserts a three-second static-frame video segment, and ripples later video on the same layer by three seconds.
- Audio and other video layers remain in place. The inserted segment is selected automatically and the complete operation is one undoable edit.
- Forward, reversed, trimmed, and looped source clips use the correct source frame.
- Frozen segments remain paused on one source frame during preview and use exact seeking during export.
- Frozen-frame timing survives project save/load and is validated when a project file is opened.

### Video transition reliability and duration

- Fixed a one-frame background/white flash at adjacent video transitions. Reassigning `HTMLMediaElement.currentTime` at the exact junction was starting a fresh Chromium seek and temporarily discarding the already decoded incoming frame; playback now preserves a correctly pre-rolled frame.
- Corrected video Fade timing. Fade opacity had been passed through cubic ease-out, making a three-second fade look almost complete after about one second. Fade is now linear: one-third opacity at one second, one-half at 1.5 seconds, and fully visible at three seconds.
- The linear Fade rule is shared by standalone fade-in, fade-out, adjacent-clip junction preview, and export. Motion-based transitions retain easing.

### Rise and Flip caption continuity

- `rise`, `flip`, and `flip-bottom` captions now remain visibly parked after their segment ends until the next caption in that caption track starts.
- The final caption in each track still disappears at its authored end.
- This is a rendering rule only: stored caption end times and exported SRT/LRC timing are unchanged.
- A held caption remains clickable in the preview canvas, and render fingerprints use the same visibility rule as the renderer.

### Denser editor panels

- Halved the vertical gap between style panels from 18px to 9px.
- Reduced font-choice rows from 58px to 40px, trimmed vertical padding from 6px to 2px, and retained a legible 34px preview area.

### Documentation and verification

- Updated the README and manual for Freeze Frame and parking-caption gap behavior.
- Added regression coverage for freeze timing, reverse sources, same-layer ripple behavior, undo, project-file validation, static preview playback, junction frame preservation, linear three-second fades, final-caption behavior, and render-fingerprint parity.
- Verification at the end of the work: 430 tests passed, TypeScript type checking passed, and the production Electron/Vite build passed.
