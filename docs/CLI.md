# Superreview

A local Git review workspace with Catppuccin Mocha and Latte themes, continuous virtualized diffs, line and range comments, replies, viewed checkpoints, and permanent submission history.

Requires Node.js 22.13+ and Git. Install the CLI from npm:

```sh
npm install --global @tobias-walle/superreview
cd your-repository
superreview
```

For day-to-day development, globally link the CLI from this checkout:

```sh
pnpm install --frozen-lockfile
pnpm link:global
```

The link follows the checkout. Run `pnpm build` after source changes. To test the standalone package instead:

```sh
pnpm build
pnpm --dir dist-cli pack --pack-destination ..
pnpm add --global ./tobias-walle-superreview-*.tgz
```

The CLI opens a browser and binds to a random port on 127.0.0.1. Keep the terminal running. Ctrl+C stops the server; your review remains saved. Use `--no-open` to print the URL without opening a browser, or `--port 4317` for a fixed port.

```sh
superreview                         # HEAD vs working tree; staged + unstaged + untracked
superreview main                    # main vs working tree
superreview main..feature           # endpoint comparison
superreview main...feature          # merge-base comparison
superreview main feature            # endpoint comparison
superreview --cached                 # HEAD vs index
superreview --cached main            # main vs index
superreview -- src/app.ts            # literal repository-relative paths
superreview --new --name "Auth pass" # another independent review
superreview --review <id> main...HEAD # full branch comparison in an existing review
superreview list
superreview open <id>                # exact saved snapshot; Refresh explicitly recaptures
superreview archive <id>
superreview reopen <id>
superreview export <id> --submission 1
```

Review IDs are stable. Working-tree and HEAD comparisons on the same branch/worktree resume its latest active review. Explicit comparisons against another branch have their own binding. Use `superreview --review <id> main...HEAD` to attach a different comparison to a chosen review. `open` restores the captured diff even after the source branch changes or disappears. Archive keeps history and can be reversed. Linked worktrees keep their own `.superreview` directory.

Use `--json` for machine-readable output. Diagnostics go to stderr. Color follows the terminal and `NO_COLOR`; override it with `--color=always` or `--color=never`.

## Reviewing your agent's work

Run `superreview`, read changes, and save line comments. Files become viewed after every chunk has been visible, or through the checkbox. Submit a review when a feedback round is ready. The success dialog offers **Copy as Markdown** to hand feedback to your agent. Continue editing, then refresh or run the CLI again. Unchanged file evidence stays viewed. **Since reviewed** shows only remaining changes and compares changed files against their reviewed content when the base is compatible.

A changed comparison base triggers a conservative full review. A file reviewed only against HEAD is not proof that older commits on the branch were reviewed. Manual unviewing remains in force for that exact file version until you re-enable automatic tracking or mark it viewed.

## Reviewing a colleague's work

Fetch and check out the branch using Git, then run `superreview main...HEAD`. Review, comment, and submit a local round. Copy the submission from its success dialog or **History** at any later time. After new commits arrive, run the same command to capture them and retain unchanged evidence. GitHub/GitLab authentication, fetching PRs, and publishing feedback are not implemented in this release.

## Feedback rounds

Saved comments, replies, edits, deletions, and resolution changes remain pending until submitted. A submission freezes all changed threads, including their conversation context, summary, original code excerpts, and snapshot IDs. Editing a submitted comment produces pending feedback for the next round; it never rewrites the previous round. Unfinished editor drafts are excluded and clearly called out before submission. Submitting does not mark files viewed or resolve threads.

## Local storage

| Path under `.superreview/`         | Purpose                                                 |
| ---------------------------------- | ------------------------------------------------------- |
| `config.json`                      | Store schema and defaults                               |
| `reviews/<id>/review.json`         | Stable identity and repository/comparison binding       |
| `reviews/<id>/events.jsonl`        | Ordered, append-only review events                      |
| `reviews/<id>/snapshots/<id>.json` | Immutable captured diffs, references, content manifests |
| `reviews/<id>/drafts.json`         | Replaceable unfinished editor drafts                    |
| `objects/<sha256>`                 | Deduplicated original file bytes                        |
| `cache/`                           | Rebuildable data; safe to remove                        |
| `writer.lock/`                     | One process owns writes for this worktree               |

The CLI adds `.superreview` to the repository's local Git exclude file. It does not edit source files or the index. Back up the entire folder to preserve history. No remote service receives your code.

Interrupted final JSONL writes are preserved in an `interrupted-*.jsonl` file and removed from the active log on recovery. Corrupt middle records fail visibly. Only one server writes at a time; close it before running another CLI writer. Multiple browser tabs detect stale updates and ask for a reload rather than overwrite feedback.

Renames currently appear as deletion and addition. Merge conflicts must be resolved before capture. Binary files, mode-only changes, and submodule pointer changes have file-level review markers; they do not offer text line comments. Word-level matching follows the delta approach, with bounded fallback for pathological lines. Git histogram generates the line diff. Very large captures use disk objects and virtualized rendering; the current capture adapter still holds each text diff in memory.

## Agent skill

Install the small discovery skill from your local Superreview source checkout:

```sh
pnpm dlx skills add /path/to/superreview --skill superreview
```

The CLI package also includes the discovery skill. After a global CLI install:

```sh
pnpm dlx skills add "$(pnpm root -g)/@tobias-walle/superreview" --skill superreview
```

Choose your harness in the installer. Add `--global` to install for all projects. The skill installer does not install the Superreview executable.

The agent loads current instructions with `superreview skill read` (or `--json`). This works offline and outside Git without creating files. The installed `skills/superreview/SKILL.md` is only a discovery entrypoint; `skill-data/review.md` ships with the CLI, so upgrades update the full instructions together with the commands.

This follows the [agent-browser runtime skill strategy](https://agent-browser.dev/skills) and the [Skills CLI local-source format](https://github.com/vercel-labs/skills).
