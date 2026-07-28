---
name: alicecut-development
description: Develop, debug, review, test, package, or document AliceCut, the caption-first Electron video editor. Use for work involving caption timing and manipulation, media clips, preview/export parity, project files, headless jobs, the command console, Electron IPC, Windows packaging, or beta-release readiness in this repository.
---

# AliceCut development

## Orient before changing code

- Read `README.md` for product scope and `docs/DESIGN.md` for architecture before broad changes.
- Read the relevant parts of `docs/MANUAL.md` for existing user-visible behavior.
- Search with `rg` before editing, and preserve unrelated working-tree changes.

## Respect the architecture

- Keep deterministic, DOM-free logic in `src/core/` and cover it with Vitest tests.
- Keep project-state mutations in `src/store/project.ts`.
- Route filesystem access, dialogs, process spawning, and FFmpeg through `electron/`. Expose only typed IPC through `electron/preload.ts`.
- Keep GUI and headless behavior aligned through `src/projectCommand.ts` and `src/exportRunner.ts`.
- Preserve preview, export, and headless-render parity unless a documented performance tradeoff requires otherwise.
- Treat caption tracks independently by `trackId`; use `kind: 'text'` for standalone text elements.
- Preserve portable project paths and backward-compatible defaults and validation when adding persisted fields.
- Never silently discard offline media, unsupported project data, or failed operations. Show actionable errors.

## Implement cross-cutting features

1. Update core types and pure functions first.
2. Add store actions, defaults, and project parsing or serialization.
3. Thread data through headless jobs, commands, and export paths when applicable.
4. Update the React UI and both `src/i18n/en.ts` and `src/i18n/zh.ts`.
5. Update the README, manual, design notes, and local Help page for user-visible behavior.
6. Test relevant edge cases such as trim, split, loop, speed, reverse, transitions, missing files, save cancellation, and installed-Windows path behavior.

## Verify changes

On Windows, use `npm.cmd` because PowerShell may block `npm.ps1`:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

For installer-related changes, also run the applicable Windows distribution command from `package.json`. Do not treat the web build alone as installer verification.

Before handoff or commit, run `git diff --check`, inspect `git status`, and state exactly which checks passed.

## Keep Git and releases safe

- Do not overwrite or discard user changes outside the requested scope.
- Keep `samples/` ignored and `examples/` tracked.
- Attribute repository commits to `a-homosapiens <hello@artificialhomosapiens.com>` and do not add AI co-author trailers.
- Do not push, publish an installer, or create a release unless the user explicitly requests it.
