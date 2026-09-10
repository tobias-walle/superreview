# Architecture

Superreview uses a small ports-and-adapters boundary. The shared review rules do not import React, Git, Node filesystem APIs, or browser storage. There is no dependency-injection framework, database abstraction language, or event bus.

| Layer               | Modules                                                                     | Responsibility                                                                   |
| ------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Review core         | `lib/review/types.ts`, `core.ts`, `markdown.ts`                             | Review identity, events, immutable submission decisions, replay, Markdown export |
| Boundary validation | `lib/review/validation.ts`                                                  | Validate commands and drafts arriving at the local HTTP boundary                 |
| Local adapters      | `adapters/node/`                                                            | Git capture, content objects, JSONL durability, serialized local HTTP API        |
| Browser adapter     | `adapters/browser/client.ts`                                                | HTTP transport to the loopback CLI server                                        |
| UI coordination     | `hooks/use-review-session.tsx`, `use-comments.ts`, `use-review-progress.ts` | Queue writes, coordinate drafts, selection, progress and errors                  |
| UI                  | `client/app.tsx`, `components/review/`                                      | Diff workspace, tree, editors, submission dialogs and history                    |
| Entry points        | `cli/`, `client/`                                                           | Headless review commands, terminal output, and standalone Vite browser bundle    |

`ReviewClient` is the UI's single application port. Commands produce complete, serializable events through `decide`. `evolve` applies an event deterministically and checks ordering. Adapters supply clocks, IDs, persistence, and captured Git content. The local server owns the write queue and repository lock; the UI queue preserves command order and expected sequence checks reject stale tabs. JSONL events are flushed before success. Submitted Markdown is stored with the immutable event, so later formatting changes cannot alter an old export.

Snapshots are separate from events. They hold the exact displayed diff and a manifest of before/after content objects and modes. Content fingerprints exclude commit IDs, timestamps, and context-window formatting. The worker uses those fingerprints for local files. Viewed checkpoints use full before/after evidence. The since-reviewed view may compare against the last reviewed after-object only if the original base object and mode match. A changed base deliberately requires the complete comparison again. Anchors preserve side, range, original excerpt, fingerprint, and snapshot ID. Unmapped anchors remain in the overview and are distinct from resolved threads.

Messages can have a human or agent author. The author type is stored separately from the display name. Old events without author data stay valid and render as an unknown legacy author. Headless comment and reply commands use the active server queue when available. Otherwise, they use the same repository lock and `JsonlStore` command path as the server. Stable request IDs make retries idempotent. Snapshot validation rejects stale or invented comment locations.

The CLI binds the loopback server and opens the browser before starting an initial capture. `/api/session` exposes capturing, ready, and error states, so the browser shell remains responsive while Git work runs asynchronously. Capture batches tree/index metadata and object reads, stores exact content evidence, and runs one histogram directory diff over opaque temporary names. Only the completed immutable snapshot becomes an append-only event.

The bundled SPA retains its virtual diff worker and block cache. The worker publishes file models progressively and shares one bounded word-diff budget across the capture, allowing the first file to render without preparing every later file first. Code rows and file-tree entries are virtualized; viewport coverage excludes overscan. A shared folder-grouped display order maps back to original snapshot indices, so navigation and diff order match the tree without changing worker keys, comment anchors or viewed evidence. Submitting a comment changes review state without replacing the snapshot or rebuilding the diff worker. Submission history renders only when requested. The core and adapters can be extracted as packages later if a second consumer actually needs that split.

## Future seams

Review identity reserves optional remote provider/repository/request metadata. A future sync adapter should map local thread/message/revision and submission IDs to provider IDs, with explicit delivery states and idempotency keys. Local submission and remote delivery are separate facts. There is no authentication or remote write code now.

A future guide can live in `reviews/<id>/guide.md` and reference immutable snapshots, files, ranges, and threads. It should be an artifact prepared by an external skill/harness. No model client or guide engine belongs in this release.

## Tests

`pnpm test:review` runs core, filesystem, Git fixture, and HTTP/CLI lifecycle tests. `pnpm build` bundles an installable CLI without runtime package dependencies. Diff, word matching, coverage, and comment-anchor verification scripts remain in place. The browser acceptance checklist covers commenting, submission history, persistence, themes, and mobile use. See `docs/TESTING.md` for the verification record.

## Sources and choices

- [Alistair Cockburn: Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture): isolate application rules from external technology through purposeful ports.
- [Martin Fowler: Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html): test domain and adapter boundaries thoroughly; use browser tests for important user journeys.
- [Git diff documentation](https://git-scm.com/docs/git-diff): endpoint vs merge-base comparisons and histogram diff.
- [Node filesystem documentation](https://nodejs.org/api/fs.html): serialize writes explicitly and flush durable records.
- [JSON Lines](https://jsonlines.org/): one UTF-8 JSON value per newline.
- [Command Line Interface Guidelines](https://clig.dev/) and [NO_COLOR](https://no-color.org/): readable plain output, restrained color, predictable machine output.

These are design references, not a reason to add layers without a concrete consumer.
