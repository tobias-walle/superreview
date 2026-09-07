# Superreview

A dense Git review workspace, launched from the command line. Continuous unified or split diffs, file tree, Catppuccin Mocha/Latte, Markdown comments and replies, viewed checkpoints, and immutable review submissions.

[![Superreview in Catppuccin Mocha: split diff with word highlights, file tree, viewed progress and Markdown review feedback.](docs/images/superreview-desktop.jpg)](docs/images/superreview-desktop.jpg)

_The sample repository, shown in split view._

## Develop and test

```sh
pnpm install --frozen-lockfile
pnpm dev --help
pnpm build
node dist-cli/superreview.mjs --help
pnpm test
pnpm lint
pnpm format:check
```

`pnpm dev` rebuilds and launches Superreview against the current Git worktree. Pass CLI options directly, for example `pnpm dev --no-open main...HEAD`.

For day-to-day development, build and globally link the CLI from this checkout:

```sh
pnpm link:global
```

The link follows this checkout. Run `pnpm build` after source changes. To test the standalone package instead:

```sh
pnpm --dir dist-cli pack --pack-destination ..
pnpm add --global ./superreview-0.2.1.tgz
```

- [CLI workflows and local folder format](docs/CLI.md)
- [Architecture and extension boundaries](docs/ARCHITECTURE.md)
- [Release verification](docs/TESTING.md)

The CLI bundles a Vite SPA and serves it from a loopback-only Node server. Captured repository contents and review history stay local. GitHub/GitLab sync and guided review artifacts are future extension points.

## Research and choices

| Layer           | Choice                                                    | Reason                                                                                                                                   |
| --------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Line diff       | Git `--diff-algorithm=histogram`                          | Uses low-occurrence common lines as anchors, extending patience. A sound default for readable code review. Git's default is still Myers. |
| Word alignment  | JavaScript port of delta's weighted Levenshtein alignment | Insertion/deletion cost 2, gap-open penalty 1, insertion → deletion → equal tie order. Matches delta's grouping preference.              |
| Tokenization    | Unicode word tokens; grapheme tokens between words        | Mirrors delta's default `\w+` approach and preserves original text.                                                                      |
| Line pairing    | Delta-style greedy homolog pairing                        | Only apply word highlights to similar changed lines; show dissimilar lines as whole additions/deletions.                                 |
| Structural diff | Deferred                                                  | Difftastic compares syntax structure; useful later as an optional mode, but needs parser/language handling and a different data model.   |
| UI              | React, shadcn/Radix primitives, CSS tokens                | Portable view components with direct theme tokens. No dependency on a terminal renderer.                                                 |

Primary sources, checked 2026-09-06:

- [Git diff algorithms](https://git-scm.com/docs/git-diff)
- [delta overview](https://github.com/dandavison/delta)
- [delta alignment source](https://github.com/dandavison/delta/blob/main/src/align.rs)
- [delta edit inference source](https://github.com/dandavison/delta/blob/main/src/edits.rs)
- [Difftastic](https://difftastic.wilfred.me.uk/)
- [Catppuccin palette](https://github.com/catppuccin/catppuccin)

This is a port of delta's core alignment algorithm, not the delta binary. Line-pair similarity uses grapheme counts rather than terminal cell widths for non-ASCII text. It uses a 0.6 distance threshold. Extremely long token comparisons fall back to line-only highlighting above one million alignment cells. Production parity needs full delta golden fixtures, terminal-width parity, configurable tokenization, and benchmarks.

## Source layout

`lib/review` contains domain rules; `adapters` contains Git, filesystem, HTTP server, and browser HTTP adapters; `cli` contains the entry point. The Vite SPA lives in `client`, `hooks`, and `components/review`. Diff parsing, worker models, and delta-derived word matching live in `lib/diff`.

See `THIRD_PARTY_NOTICES.md` for licenses.
