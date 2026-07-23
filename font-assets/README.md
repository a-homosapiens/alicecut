# Optional font assets

This directory contains AliceCut fonts that are downloaded only when a user
selects them. The three starter fonts shipped with the application live in
`public/fonts/`; preview images live in `public/font-previews/`.

Font binaries in both locations are managed by Git LFS. Keep every filename in
sync with `src/fonts.ts`, then run `npm run font-previews` and the test suite.
Do not optimize, subset, rename, or otherwise modify a third-party font unless
its license explicitly permits that change.

Upstream projects and licensing notes are documented in the root README. Before
adding or redistributing another font, verify its license and retain any required
copyright notice.
