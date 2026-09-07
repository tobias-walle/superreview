# Verification

## Automated checks

Run the complete cached check set with:

```sh
pnpm check
```

Independent checks run in parallel. Successful output is one summary line, unchanged inputs use `.check-cache/`, and full command output is shown only for failures. Use `pnpm check -- --force --verbose` to bypass the cache and inspect successful output. Positional filters select a subset, for example `pnpm check -- lint` or `pnpm check -- test`.

The individual checks are:

- `pnpm format:check`: Oxfmt formatting verification.
- `pnpm lint`: Oxlint correctness checks, including React rules.
- `pnpm typecheck`: TypeScript without emitting files.
- `pnpm build` followed by `pnpm test:review`: builds the distribution and tests review rules, filesystem and Git adapters, the local HTTP API, CLI lifecycle, packaged skills, and component rendering.
- `pnpm test:diff`: tests diff parsing, word matching, viewed coverage, comment anchors, and the bounded large-diff model.
- `pnpm test:ui`: checks Vite SPA assets and retained UI primitives.
- `pnpm test`: builds once, then runs the review, diff, and UI suites.

## Browser verification

For UI changes, launch the built CLI against a temporary Git repository and check both themes, unified and split views, narrow mobile layout, dialogs, and keyboard controls. The server must remain bound to `127.0.0.1`. Report browser checks that the environment cannot run.

Physical iOS, Android, Windows, and macOS launch behavior require platform-specific verification.
