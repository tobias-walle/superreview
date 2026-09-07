# Development

- Use Node 22.13+ and pnpm. Keep `pnpm-lock.yaml` synchronized with `package.json`.
- Read `DESIGN.md` for UI changes; `docs/ARCHITECTURE.md` for review/storage changes.
- Avoid unexplained numeric literals and arithmetic in components. Name layout constants, prefer CSS custom properties for related dimensions, and document values tied to virtualization, accessibility or platform behavior.
- Keep review rules in `lib/review/` independent of React, Git, filesystem and browser APIs. Put I/O in `adapters/`; coordinate UI through `ReviewClient` and hooks. Add a boundary only when a concrete consumer needs it.
- Preserve append-only events, ordered writes, immutable submissions and snapshots, and optimistic concurrency. Never rewrite old feedback to match new code.
- Viewed state requires matching content evidence. Overscan is not viewed coverage. Keep large diffs virtualized and avoid worker rebuilds for comment-only changes.
- Use `pnpm check` for the cached full suite. Use `pnpm check -- <filter>` for a focused check and `--force --verbose` when full successful output is needed. Add regression tests for changed behavior, not copied implementation details.
- For UI changes, check both themes, narrow mobile, unified/split, dialogs and keyboard use with the environment's supported browser workflow. Report checks that could not run.
- `pnpm dev` rebuilds and runs the CLI against the current worktree. `pnpm build` creates the standalone CLI and its bundled Vite SPA. Do not edit generated bundles.
- Keep `skills/superreview/SKILL.md` small. Full agent instructions live in `skill-data/review.md` and ship through `superreview skill read`; update them when commands change.
- Never commit credentials or local review data.
