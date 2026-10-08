# Test guided reviews

## Automated checks

```sh
pnpm check
```

Use `pnpm check -- review` for the review/CLI/component regression suite. Use `pnpm check -- --force --verbose` to rerun everything and see successful output.

## Prepare a saved review

Build the current CLI, then capture a small comparison with at least two changed files:

```sh
pnpm build
node dist-cli/superreview.mjs create --name "Guided smoke test" --json
```

Keep the returned `reviewId` and `snapshotId`. The following examples use `superreview` for the built CLI. From this checkout, replace it with `node dist-cli/superreview.mjs`, or run `pnpm link:global` first.

```sh
superreview guide inspect <review-id> --snapshot <snapshot-id> --json
```

Have an external agent prepare a guide using the version-matched Superreview skill, or author the schema-1 bundle described in [CLI usage](CLI.md#guided-reviews). Put the bundle outside the worktree. Use two chunks, with a shared file split into old/new ranges if possible. Explicitly assign every captured change and link every target in Markdown. Include a small Mermaid flowchart with a prose explanation.

```sh
superreview guide validate <review-id> --bundle /tmp/review-guide --json
superreview threads <review-id> --json
superreview guide import <review-id> --bundle /tmp/review-guide \
  --expected-sequence <sequence-from-threads> \
  --request-id smoke-guide-1 --author "Smoke-test agent" --json
superreview open <review-id>
```

Opening restores the saved snapshot, even if the worktree has changed since capture. It should select the latest valid matching published guide without another flag.

## Check the workspace

- Select both chunks. Each has its own file tree. Tree order, diff order, file counter and J/K navigation agree. Navigation stops at the ends.
- For a partial/shared file, check original line numbers, omission boundaries and **Open full file**. **All files** shows the complete comparison.
- Toggle the read checkbox beside a chunk, change chunks and reload. The confirmation persists only for that guide revision. It does not mark skipped file ranges viewed, resolve comments or submit feedback.
- Switch unified/split and show/hide deletions. Inspect old-side targets and comments. A comment outside the chunk opens the original full snapshot rather than a renumbered excerpt.
- Start a comment draft, change scopes and return. Text and anchors remain intact. Check comments overview, History and submission dialogs.
- Read through the complete explanation, switch layout and return to the chunk. The explanation remains one continuous text block through navigation and comment-only updates.
- Check both themes and a narrow mobile viewport. Chunk selection belongs in the files drawer. Explanations and diagrams must not cause page-wide overflow. Use Tab, Space and J/K to exercise keyboard controls.

## Check publication and failures

1. While the workspace is open, edit only the explanation and publish with a new request ID and current sequence. The open workspace must not switch guide or scope. Reloading chooses the new revision, with no inherited chunk read confirmations.
2. Remove an old-side replacement target or another changed range. Validation must fail and name the omitted path, side and range, even when the file has other targets.
3. Remove a whole-file target for a binary or mode-only change. Validation must fail rather than omitting the marker from coverage.
4. Try a broken internal link, duplicate ID, escaping content path or unsafe Mermaid directive. Validation must fail with useful diagnostics. A harmless Mermaid syntax error may publish, but must show a visible rendering error while leaving prose and the diff usable.
5. Retry an unchanged import with the same request ID. It must not append another revision. Change the bundle and retry that ID, or use a stale sequence with a new ID. Both must fail without overwriting history.
6. Refresh after changing code. The old guide must not explain the new snapshot or carry its confirmations forward. Use the explicit previous-guide snapshot action to inspect the old guide with its original code, then return to the current snapshot.

Validation itself must not change the review sequence, checkpoints, threads, submissions or chunk read state.

Physical iOS/Android and host-specific browser launching still need platform testing. Browser automation in a Linux sandbox is not a substitute for those checks.
