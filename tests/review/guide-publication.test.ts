import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, rm, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { capture, git } from "../../adapters/node/git";
import { JsonlStore, atomicJson } from "../../adapters/node/jsonl-store";
import { readGuideBundle } from "../../adapters/node/guide-bundle";
import { guideHash, guideValidationInput } from "../../adapters/node/guide-publication";
import { startServer } from "../../adapters/node/server";
import { importGuide, validateGuide } from "../../cli/guide-commands";
import { parseArgs } from "../../cli/args";
import { commandSchema } from "../../lib/review/validation";
import { emptyReview, pendingThreads } from "../../lib/review/core";
import { GUIDE_LIMITS, validateGuideBundle } from "../../lib/review/guide-validation";
import type { GuideBundle, GuideTarget } from "../../lib/review/guide";
import type { Snapshot } from "../../lib/review/types";

const comparison = { refs: [], paths: [], cached: false };
async function fixture(fn: (root: string, store: JsonlStore, snapshot: Snapshot) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "superreview-publication-"));
  try {
    git(root, ["init", "-b", "main"]);
    git(root, ["config", "user.name", "Test"]);
    git(root, ["config", "user.email", "test@example.com"]);
    await writeFile(
      join(root, "domain.ts"),
      "before\ncontext\nold business\ncontext\ntelemetry\ncontext\n",
    );
    await writeFile(join(root, "deploy.sh"), "eu\n");
    await writeFile(join(root, "deleted.ts"), "deleted\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "base"]);
    const store = new JsonlStore(join(root, ".superreview"), "review");
    await store.create({
      schema: 1,
      id: store.id,
      title: "Publication",
      created: 1,
      binding: { repository: root, worktree: root, branch: "main" },
    });
    await writeFile(
      join(root, "domain.ts"),
      "after\ncontext\nnew business\ncontext\nno telemetry\ncontext\n",
    );
    await writeFile(join(root, "deploy.sh"), "us\n");
    await rm(join(root, "deleted.ts"));
    await writeFile(join(root, "binary.bin"), Buffer.from([0, 0xff, 1]));
    const snapshot = await capture(root, comparison, store);
    await store.capture(snapshot);
    await fn(root, store, snapshot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function bundleFor(snapshot: Snapshot): GuideBundle {
  const targets: GuideTarget[] = snapshot.data.files.map((file, index) => ({
    id: `file-${index}`,
    kind: "file",
    path: file.path,
  }));
  return {
    manifest: {
      schema: 1,
      snapshotId: snapshot.id,
      chunks: [{ id: "changes", title: "Captured changes", content: "changes.md", targets }],
    },
    documents: {
      "changes.md": targets
        .map((target) => `[Inspect ${target.path}](superreview://target/${target.id})`)
        .join("\n"),
    },
  };
}
async function draft(root: string, bundle: GuideBundle) {
  const directory = join(root, "draft-guide");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "guide.json"), JSON.stringify(bundle.manifest));
  for (const [name, document] of Object.entries(bundle.documents))
    await writeFile(join(directory, name), document);
  return directory;
}

function rangedBundle(snapshot: Snapshot): GuideBundle {
  const bundle = bundleFor(snapshot);
  const chunk = bundle.manifest.chunks[0];
  chunk.targets = chunk.targets.filter((target) => target.path !== "domain.ts");
  for (const side of ["old", "new"] as const) {
    chunk.targets.push({
      id: `${side}-business`,
      kind: "range",
      path: "domain.ts",
      side,
      start: 1,
      end: 3,
    });
    chunk.targets.push({
      id: `${side}-shared`,
      kind: "range",
      path: "domain.ts",
      side,
      start: 3,
      end: 5,
    });
  }
  bundle.documents[chunk.content] = chunk.targets
    .map((target) => `[Inspect](superreview://target/${target.id})`)
    .join("\n");
  return bundle;
}

test("validator rejects unsafe Mermaid while leaving optional syntax errors to the renderer", async () =>
  fixture(async (_root, store, snapshot) => {
    const bundle = bundleFor(snapshot);
    const { bounds } = await guideValidationInput(store, bundle);
    const narrative = bundle.documents["changes.md"];
    const unsafeDiagrams = [
      "%%{init: {securityLevel: loose}}%%\nflowchart LR\n A --> B",
      'flowchart LR\n A --> B\n click A "https://example.invalid"',
      'flowchart LR\n A["<img src=x>"] --> B',
    ];
    for (const diagram of unsafeDiagrams) {
      bundle.documents["changes.md"] = `${narrative}\n\n\`\`\`mermaid\n${diagram}\n\`\`\``;
      const validation = validateGuideBundle(bundle, snapshot, bounds);
      assert.equal(validation.valid, false);
      assert.ok(validation.errors.some((error) => error.code === "UNSAFE_DIAGRAM"));
      await assert.rejects(
        store.importGuide(bundle, store.state.sequence, "unsafe-diagram", "Test agent"),
        /Guide validation failed/,
      );
    }
    assert.equal(store.state.guides.length, 0);

    bundle.documents["changes.md"] = `${narrative}\n\n\`\`\`mermaid\nflowchart LR\n A[\n\`\`\``;
    assert.equal(validateGuideBundle(bundle, snapshot, bounds).valid, true);
    bundle.documents["changes.md"] =
      `${narrative}\n\n\`\`\`\`markdown\n\`\`\`mermaid\n%%{init: {securityLevel: loose}}%%\n\`\`\`\n\`\`\`\``;
    assert.equal(validateGuideBundle(bundle, snapshot, bounds).valid, true);
  }));

test("validator unions overlapping ranges and reports exact omissions inside partially covered files", async () =>
  fixture(async (_root, store, snapshot) => {
    const bundle = rangedBundle(snapshot);
    const { bounds } = await guideValidationInput(store, bundle);
    const valid = validateGuideBundle(bundle, snapshot, bounds);
    assert.equal(valid.valid, true);
    const resolved = valid.resolvedTargets["old-business"];
    assert.equal(
      resolved.fileIndex,
      snapshot.data.files.findIndex((file) => file.path === "domain.ts"),
    );
    assert.equal(resolved.ranges[0].start.line, 1);
    assert.equal(resolved.ranges[0].end.line, 3);
    assert.equal(resolved.sourceObjects.old, snapshot.evidence["domain.ts"].before.object);
    const original = structuredClone(bundle);
    bundle.manifest.chunks[0].targets = bundle.manifest.chunks[0].targets.filter(
      (target) => !target.id.endsWith("shared"),
    );
    const omitted = validateGuideBundle(bundle, snapshot, bounds);
    assert.deepEqual(
      omitted.errors
        .filter((error) => error.code === "UNASSIGNED_CHANGE")
        .map(({ path, side, start, end }) => ({ path, side, start, end })),
      [
        { path: "domain.ts", side: "old", start: 5, end: 5 },
        { path: "domain.ts", side: "new", start: 5, end: 5 },
      ],
    );
    const newOnly = structuredClone(original);
    newOnly.manifest.chunks[0].targets = newOnly.manifest.chunks[0].targets.filter(
      (target) => target.kind !== "range" || target.side === "new",
    );
    assert.ok(
      validateGuideBundle(newOnly, snapshot, bounds).errors.some(
        (error) => error.code === "UNASSIGNED_CHANGE" && error.side === "old",
      ),
    );
    const context = structuredClone(original);
    context.manifest.chunks[0].targets = context.manifest.chunks[0].targets.map((target) =>
      target.kind === "range" ? { ...target, start: 2, end: 2 } : target,
    );
    assert.ok(
      validateGuideBundle(context, snapshot, bounds).errors.some(
        (error) => error.code === "UNASSIGNED_CHANGE",
      ),
    );
  }));

test("schema, identities, references, source bounds and Remaining position reject invalid guides", async () =>
  fixture(async (_root, store, snapshot) => {
    const good = rangedBundle(snapshot);
    const { bounds } = await guideValidationInput(store, good);
    const cases: [string, (bundle: GuideBundle) => void][] = [
      [
        "INVALID_SCHEMA",
        (bundle) => {
          Object.assign(bundle.manifest, { schema: 2 });
        },
      ],
      [
        "INVALID_SCHEMA",
        (bundle) => {
          Object.assign(bundle.manifest, { author: { kind: "human" } });
        },
      ],
      [
        "INVALID_SCHEMA",
        (bundle) => {
          Object.assign(bundle.manifest.chunks[0], { read: true });
        },
      ],
      [
        "DUPLICATE_CHUNK",
        (bundle) => {
          bundle.manifest.chunks.push(structuredClone(bundle.manifest.chunks[0]));
        },
      ],
      [
        "DUPLICATE_TARGET",
        (bundle) => {
          bundle.manifest.chunks[0].targets.push(bundle.manifest.chunks[0].targets[0]);
        },
      ],
      [
        "EMPTY_CONTENT",
        (bundle) => {
          bundle.documents["changes.md"] = " \n ";
        },
      ],
      [
        "BROKEN_TARGET_LINK",
        (bundle) => {
          bundle.documents["changes.md"] += "\n[broken](superreview://target/missing)";
        },
      ],
      [
        "UNKNOWN_PATH",
        (bundle) => {
          bundle.manifest.chunks[0].targets[0].path = "not-captured";
        },
      ],
      [
        "INVALID_RANGE",
        (bundle) => {
          const range = bundle.manifest.chunks[0].targets.find(
            (target) => target.kind === "range",
          )!;
          Object.assign(range, { end: 100 });
        },
      ],
      [
        "INVALID_RANGE",
        (bundle) => {
          const range = bundle.manifest.chunks[0].targets.find(
            (target) => target.kind === "range",
          )!;
          Object.assign(range, { start: 3, end: 1 });
        },
      ],
      [
        "INVALID_SCHEMA",
        (bundle) => {
          const range = bundle.manifest.chunks[0].targets.find(
            (target) => target.kind === "range",
          )!;
          Object.assign(range, { side: "other" });
        },
      ],
      [
        "REMAINING_NOT_LAST",
        (bundle) => {
          bundle.manifest.chunks[0].kind = "remaining";
          bundle.manifest.chunks.push({
            ...structuredClone(bundle.manifest.chunks[0]),
            id: "last",
            kind: undefined,
          });
        },
      ],
      [
        "SNAPSHOT_MISMATCH",
        (bundle) => {
          bundle.manifest.snapshotId = "other-snapshot";
        },
      ],
    ];
    for (const [code, change] of cases) {
      const bundle = structuredClone(good);
      change(bundle);
      const report = validateGuideBundle(bundle, snapshot, bounds);
      assert.equal(report.valid, false, code);
      assert.ok(
        report.errors.some((error) => error.code === code),
        `${code}: ${JSON.stringify(report.errors)}`,
      );
    }
    assert.equal(
      validateGuideBundle(good, { ...snapshot, captureView: undefined }, bounds).valid,
      false,
    );
    assert.equal(
      validateGuideBundle(good, { ...snapshot, captureView: "since-reviewed" }, bounds).valid,
      false,
    );
    const remaining = bundleFor(snapshot);
    remaining.manifest.chunks[0].kind = "remaining";
    assert.equal(validateGuideBundle(remaining, snapshot, bounds).valid, true);
    remaining.manifest.chunks[0].targets.pop();
    assert.ok(
      validateGuideBundle(remaining, snapshot, bounds).errors.some(
        (error) => error.code === "UNASSIGNED_FILE",
      ),
    );
  }));

test("binary, deletion and metadata markers require explicit whole-file targets", async () =>
  fixture(async (_root, store, snapshot) => {
    const bundle = bundleFor(snapshot);
    const { bounds } = await guideValidationInput(store, bundle);
    const chunk = bundle.manifest.chunks[0];
    const deleted = chunk.targets.find((target) => target.path === "deleted.ts")!;
    Object.assign(deleted, { kind: "range", side: "old", start: 1, end: 1 });
    const report = validateGuideBundle(bundle, snapshot, bounds);
    assert.ok(
      report.errors.some(
        (error) => error.path === "deleted.ts" && error.code === "UNASSIGNED_MARKER",
      ),
    );
    const binary = chunk.targets.find((target) => target.path === "binary.bin")!;
    Object.assign(binary, { kind: "range", side: "new", start: 1, end: 1 });
    assert.ok(
      validateGuideBundle(bundle, snapshot, bounds).errors.some(
        (error) => error.path === "binary.bin" && error.code === "INVALID_RANGE",
      ),
    );
  }));

test("narrative links use Markdown parsing, not code, images, HTML or unused definitions", async () =>
  fixture(async (_root, store, snapshot) => {
    const bundle = bundleFor(snapshot);
    const { bounds } = await guideValidationInput(store, bundle);
    const ids = bundle.manifest.chunks[0].targets.map((target) => target.id);
    const links = ids.map((id) => `[Inspect](superreview://target/${id})`).join("\n");
    for (const markdown of [
      "```md\n" + links + "\n```",
      "`" + links.replaceAll("\n", " ") + "`",
      links.replaceAll("[Inspect]", "![Inspect]"),
      ids.map((id) => `[${id}]: superreview://target/${id}`).join("\n"),
      ids.map((id) => `<a href="superreview://target/${id}">code</a>`).join("\n"),
    ]) {
      bundle.documents["changes.md"] = markdown;
      assert.ok(
        validateGuideBundle(bundle, snapshot, bounds).errors.some(
          (error) => error.code === "UNEXPLAINED_TARGET",
        ),
      );
    }
    bundle.documents["changes.md"] = ids
      .map((id) => `[Inspect][${id}]\n\n[${id}]: superreview://target/${id}\n`)
      .join("\n");
    assert.equal(validateGuideBundle(bundle, snapshot, bounds).valid, true);
    bundle.documents["changes.md"] += "\n[broken](superreview://other/file)";
    assert.ok(
      validateGuideBundle(bundle, snapshot, bounds).errors.some(
        (error) => error.code === "BROKEN_TARGET_LINK",
      ),
    );
  }));

test("bounded bundle reads enforce containment including manifest and content symlinks", async () =>
  fixture(async (root, _store, snapshot) => {
    const bundle = bundleFor(snapshot);
    const directory = await draft(root, bundle);
    assert.deepEqual(await readGuideBundle(directory), bundle);
    const outside = join(root, "outside.md");
    await writeFile(outside, "outside");
    await rm(join(directory, "changes.md"));
    await symlink(outside, join(directory, "changes.md"));
    await assert.rejects(readGuideBundle(directory), /escapes/);
    await rm(join(directory, "changes.md"));
    await mkdir(join(directory, "inside"));
    await writeFile(join(directory, "inside", "explanation.md"), bundle.documents["changes.md"]);
    await symlink("inside/explanation.md", join(directory, "changes.md"));
    assert.deepEqual(await readGuideBundle(directory), bundle);
    for (const content of [
      "../outside.md",
      outside,
      "a/../../outside.md",
      "a\\outside.md",
      "C:/outside.md",
    ]) {
      const manifest = structuredClone(bundle.manifest);
      manifest.chunks[0].content = content;
      await writeFile(join(directory, "guide.json"), JSON.stringify(manifest));
      await assert.rejects(readGuideBundle(directory), /bundle root/);
    }
    await writeFile(join(directory, "guide.json"), JSON.stringify(bundle.manifest));
    await rm(join(directory, "changes.md"));
    await symlink(root, join(directory, "escape"));
    const escaped = structuredClone(bundle.manifest);
    escaped.chunks[0].content = "escape/outside.md";
    await writeFile(join(directory, "guide.json"), JSON.stringify(escaped));
    await assert.rejects(readGuideBundle(directory), /escapes/);
    await rm(join(directory, "guide.json"));
    await writeFile(join(root, "outside.json"), JSON.stringify(bundle.manifest));
    await symlink(join(root, "outside.json"), join(directory, "guide.json"));
    await assert.rejects(readGuideBundle(directory), /escapes/);
  }));

test("reader and pure validator reject oversized and non-UTF8 content without silently dropping it", async () =>
  fixture(async (root, store, snapshot) => {
    const bundle = bundleFor(snapshot);
    const directory = await draft(root, bundle);
    await writeFile(join(directory, "changes.md"), Buffer.from([0xff]));
    await assert.rejects(readGuideBundle(directory), /UTF-8/);
    await writeFile(join(directory, "changes.md"), "x".repeat(GUIDE_LIMITS.documentBytes + 1));
    await assert.rejects(readGuideBundle(directory), /byte limit/);
    const { bounds } = await guideValidationInput(store, bundle);
    bundle.documents["changes.md"] += "x".repeat(GUIDE_LIMITS.documentBytes);
    assert.ok(
      validateGuideBundle(bundle, snapshot, bounds).errors.some(
        (error) => error.code === "RESOURCE_LIMIT",
      ),
    );
    await writeFile(join(directory, "guide.json"), " ".repeat(GUIDE_LIMITS.manifestBytes + 1));
    await assert.rejects(readGuideBundle(directory), /byte limit/);
  }));

test("validation is read-only and import revalidates exact bytes with agent provenance", async () =>
  fixture(async (root, store, snapshot) => {
    const bundle = bundleFor(snapshot);
    const directory = await draft(root, bundle);
    const eventPath = join(store.directory, "events.jsonl");
    const originalEvents = await readFile(eventPath);
    assert.equal(
      (await validateGuide({ root: store.root, reviewId: store.id, directory })).valid,
      true,
    );
    assert.deepEqual(await readFile(eventPath), originalEvents);
    assert.equal((await readdir(store.directory)).includes("guides"), false);
    await writeFile(join(directory, "changes.md"), "No narrative links");
    await assert.rejects(
      importGuide({
        root: store.root,
        reviewId: store.id,
        directory,
        authorName: "Robot",
        expectedSequence: store.state.sequence,
        requestId: "publication",
      }),
      /validation failed/,
    );
    assert.deepEqual(await readFile(eventPath), originalEvents);
    await writeFile(join(directory, "changes.md"), bundle.documents["changes.md"]);
    const result = await importGuide({
      root: store.root,
      reviewId: store.id,
      directory,
      authorName: "Robot",
      expectedSequence: store.state.sequence,
      requestId: "publication",
    });
    assert.equal(result.guide.author.kind, "agent");
    assert.equal(result.guide.author.name, "Robot");
    await store.load();
    const published = await store.guide(result.guide.id);
    assert.deepEqual(published.bundle, bundle);
    await writeFile(join(directory, "changes.md"), "Changed external draft");
    assert.deepEqual((await store.guide(result.guide.id)).bundle, bundle);
    const event = JSON.parse((await readFile(eventPath, "utf8")).trim().split("\n").at(-1)!);
    assert.equal(event.type, "guide-published");
    assert.equal(event.id, "publication");
    assert.equal(event.guide.bundle, undefined);
    assert.deepEqual(store.state.guideReads[result.guide.id], { changes: false });
  }));

test("expected sequence, conflicting request identities and identical uncertain retries are safe", async () =>
  fixture(async (_root, store, snapshot) => {
    const bundle = bundleFor(snapshot);
    const sequence = store.state.sequence;
    await assert.rejects(
      store.importGuide(bundle, sequence + 1, "stale", "Robot"),
      /review changed/,
    );
    assert.equal((await readdir(store.directory)).includes("guides"), false);
    const first = await store.importGuide(bundle, sequence, "request", "Robot");
    await store.execute(
      { type: "guide-read", guideId: first.guide.id, chunkId: "changes", read: true },
      store.state.sequence,
      "read-request",
    );
    const events = await readFile(join(store.directory, "events.jsonl"));
    const retry = await store.importGuide(structuredClone(bundle), sequence, "request", "Robot");
    assert.equal(retry.guide.id, first.guide.id);
    assert.deepEqual(await readFile(join(store.directory, "events.jsonl")), events);
    const modified = structuredClone(bundle);
    modified.documents["changes.md"] += "\nNew explanation";
    await assert.rejects(
      store.importGuide(modified, store.state.sequence, "request", "Robot"),
      /different content/,
    );
    await assert.rejects(
      store.importGuide(bundle, store.state.sequence, "request", "Other robot"),
      /different content/,
    );
    await assert.rejects(
      store.importGuide(bundle, store.state.sequence, "read-request", "Robot"),
      /different content/,
    );
    const reloaded = new JsonlStore(store.root, store.id);
    await reloaded.load();
    assert.equal(
      (await reloaded.importGuide(bundle, sequence, "request", "Robot")).guide.id,
      first.guide.id,
    );
    assert.deepEqual(reloaded.state, store.state);
  }));

test("read/unread confirmations are independent, revision-bound and historically replayable", async () =>
  fixture(async (_root, store, snapshot) => {
    const bundle = bundleFor(snapshot);
    const first = await store.importGuide(bundle, store.state.sequence, "first", "Robot");
    const before = structuredClone(store.state);
    const read = {
      type: "guide-read" as const,
      guideId: first.guide.id,
      chunkId: "changes",
      read: true,
    };
    // Read state is validated against the append-only descriptor. An unrelated
    // artifact I/O failure must not block this small serialized write.
    await rm(join(store.directory, "guides", `${first.guide.id}.json`));
    await store.execute(read, store.state.sequence, "read");
    assert.equal(store.state.guideReads[first.guide.id].changes, true);
    assert.deepEqual(store.state.checkpoints, before.checkpoints);
    assert.deepEqual(store.state.threads, before.threads);
    assert.deepEqual(store.state.submissions, before.submissions);
    assert.deepEqual(pendingThreads(store.state), []);
    assert.equal(store.state.snapshotId, snapshot.id);
    const event = JSON.parse(
      (await readFile(join(store.directory, "events.jsonl"), "utf8")).trim().split("\n").at(-1)!,
    );
    assert.equal(event.snapshotId, snapshot.id);
    await store.execute({ ...read, read: false }, store.state.sequence, "unread");
    assert.equal(store.state.guideReads[first.guide.id].changes, false);
    await store.execute(read, store.state.sequence, "read-again");
    bundle.documents["changes.md"] += "\nExplanation-only edit";
    const second = await store.importGuide(bundle, store.state.sequence, "second", "Robot");
    assert.deepEqual(store.state.guideReads[second.guide.id], { changes: false });
    assert.equal(store.state.guideReads[first.guide.id].changes, true);
    await store.capture({ ...snapshot, id: "later-snapshot" });
    await store.execute({ ...read, read: false }, store.state.sequence, "historical-unread");
    assert.equal(store.state.guideReads[first.guide.id].changes, false);
    await assert.rejects(
      store.execute({ ...read, chunkId: "unknown" }, store.state.sequence, "invalid-chunk"),
      /Unknown guide chunk/,
    );
    await assert.rejects(
      store.execute({ ...read, guideId: "unknown" }, store.state.sequence, "invalid-guide"),
      /not published/,
    );
    assert.equal(
      commandSchema.safeParse({ type: "guide-published", guide: first.guide }).success,
      false,
    );
    assert.equal(commandSchema.safeParse({ ...read, author: { kind: "human" } }).success, false);
    const replay = new JsonlStore(store.root, store.id);
    await replay.load();
    assert.deepEqual(replay.state, store.state);
  }));

test("failed append leaves only unadvertised immutable artifacts and retries publish safely", async () =>
  fixture(async (_root, store, snapshot) => {
    const bundle = bundleFor(snapshot);
    const append = store.append.bind(store);
    store.append = async () => {
      throw new Error("Interrupted append");
    };
    await assert.rejects(
      store.importGuide(bundle, store.state.sequence, "interrupted", "Robot"),
      /Interrupted/,
    );
    assert.deepEqual(store.state.guides, []);
    const files = await readdir(join(store.directory, "guides"));
    assert.equal(files.length, 1);
    const orphanId = files[0].replace(".json", "");
    await assert.rejects(store.guide(orphanId), /not published/);
    store.append = append;
    const result = await store.importGuide(bundle, store.state.sequence, "interrupted", "Robot");
    assert.notEqual(result.guide.id, orphanId);
    assert.equal((await store.guide(result.guide.id)).bundle.manifest.snapshotId, snapshot.id);
  }));

test("lazy loading detects artifact damage, descriptor mismatch and snapshot evidence drift", async () =>
  fixture(async (_root, store, snapshot) => {
    const result = await store.importGuide(
      bundleFor(snapshot),
      store.state.sequence,
      "publication",
      "Robot",
    );
    const artifactPath = join(store.directory, "guides", result.guide.id + ".json");
    const original = await readFile(artifactPath, "utf8");
    await writeFile(artifactPath, "{broken");
    await assert.rejects(store.guide(result.guide.id));
    await writeFile(artifactPath, original);
    const modified = JSON.parse(original);
    modified.bundle.documents["changes.md"] += "tampered";
    await writeFile(artifactPath, JSON.stringify(modified));
    await assert.rejects(store.guide(result.guide.id), /damaged/);
    await writeFile(artifactPath, original);
    const descriptor = store.state.guides[0];
    const originalSnapshotId = descriptor.snapshotId;
    descriptor.snapshotId = "other";
    await assert.rejects(store.guide(descriptor.id), /descriptor/);
    descriptor.snapshotId = originalSnapshotId;
    const drifted = structuredClone(snapshot);
    drifted.data.files.find((file) => file.path === "domain.ts")!.hunks[0].lines[0] = "-different";
    await atomicJson(join(store.directory, "snapshots", snapshot.id + ".json"), drifted);
    await assert.rejects(store.guide(descriptor.id), /references/);
    await atomicJson(join(store.directory, "snapshots", snapshot.id + ".json"), snapshot);
    await rm(artifactPath);
    await assert.rejects(store.guide(descriptor.id), /ENOENT/);
  }));

test("old reviews replay with empty guide state and ordinary sessions remain available after guide damage", async () =>
  fixture(async (root, store, snapshot) => {
    const legacy = new JsonlStore(store.root, store.id);
    await legacy.load();
    assert.deepEqual(legacy.state.guides, []);
    assert.deepEqual(legacy.state.guideReads, {});
    assert.deepEqual(emptyReview(legacy.state.identity).guideReads, {});
    const result = await store.importGuide(
      bundleFor(snapshot),
      store.state.sequence,
      "pub",
      "Robot",
    );
    await rm(join(store.directory, "guides", result.guide.id + ".json"));
    const { server, url } = await startServer({ store, root, comparison, web: root, port: 0 });
    try {
      const session = await (await fetch(`${url}/api/session`)).json();
      assert.equal(session.status, "ready");
      assert.equal(session.snapshot.id, snapshot.id);
      const damaged = await fetch(`${url}/api/guides/${result.guide.id}`);
      assert.equal(damaged.status, 404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }));

test("server queues publications, exposes lazy artifacts and forbids publication through UI commands", async () =>
  fixture(async (root, store, snapshot) => {
    const { server, url } = await startServer({ store, root, comparison, web: root, port: 0 });
    const post = (path: string, body: unknown) =>
      fetch(`${url}/api/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-superreview": "1" },
        body: JSON.stringify(body),
      });
    try {
      const bundle = bundleFor(snapshot);
      const envelope = {
        bundle,
        sequence: store.state.sequence,
        id: "first-http",
        authorName: "Robot",
      };
      const responses = await Promise.all([
        post("guides/import", envelope),
        post("guides/import", { ...envelope, id: "second-http" }),
      ]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
      const guide = store.state.guides[0];
      const artifact = await (await fetch(`${url}/api/guides/${guide.id}`)).json();
      assert.deepEqual(artifact.bundle, bundle);
      const injected = await post("commands", {
        sequence: store.state.sequence,
        id: "inject",
        command: { type: "guide-published", guide },
      });
      assert.equal(injected.status, 400);
      const authorInjection = await post("guides/import", {
        ...envelope,
        id: "inject-author",
        sequence: store.state.sequence,
        author: { kind: "human" },
      });
      assert.equal(authorInjection.status, 400);
      const read = await post("commands", {
        sequence: store.state.sequence,
        id: "http-read",
        command: { type: "guide-read", guideId: guide.id, chunkId: "changes", read: true },
      });
      assert.equal(read.status, 200);
      assert.equal((await read.json()).guideReads[guide.id].changes, true);
      await mkdir(join(store.root, "writer.lock"));
      await atomicJson(join(store.root, "writer.lock", "server.json"), { reviewId: store.id, url });
      const directory = await draft(root, bundle);
      const result = await importGuide({
        root: store.root,
        reviewId: store.id,
        directory,
        expectedSequence: store.state.sequence,
        requestId: "cli-active",
        authorName: "CLI Robot",
      });
      assert.equal(result.guide.author.name, "CLI Robot");
      assert.equal(store.state.guides.length, 2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }));

test("guide CLI validates with clean JSON, publishes with concurrency options and retries without writes", async () =>
  fixture(async (root, store, snapshot) => {
    const directory = await draft(root, bundleFor(snapshot));
    const cli = resolve("dist-cli/superreview.mjs");
    const run = (args: string[]) =>
      spawnSync(process.execPath, [cli, "guide", ...args], { cwd: root, encoding: "utf8" });
    const validated = run(["validate", store.id, "--bundle", directory, "--json", "--verbose"]);
    assert.equal(validated.status, 0, validated.stderr);
    assert.equal(JSON.parse(validated.stdout).valid, true);
    const imported = run([
      "import",
      store.id,
      "--bundle",
      directory,
      "--json",
      "--request-id",
      "packaged",
      "--expected-sequence",
      String(store.state.sequence),
      "--author",
      "CLI Robot",
    ]);
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(JSON.parse(imported.stdout).author.kind, "agent");
    const events = await readFile(join(store.directory, "events.jsonl"));
    const retry = run([
      "import",
      store.id,
      "--bundle",
      directory,
      "--json",
      "--request-id",
      "packaged",
      "--expected-sequence",
      String(store.state.sequence),
      "--author",
      "CLI Robot",
    ]);
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(JSON.parse(retry.stdout).guideId, JSON.parse(imported.stdout).guideId);
    assert.deepEqual(await readFile(join(store.directory, "events.jsonl")), events);
    await writeFile(join(directory, "changes.md"), "No links");
    const invalid = run(["validate", store.id, "--bundle", directory, "--json"]);
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stderr, "");
    assert.equal(JSON.parse(invalid.stdout).valid, false);
    const missingSequence = run([
      "import",
      store.id,
      "--bundle",
      directory,
      "--json",
      "--request-id",
      "missing-sequence",
    ]);
    assert.equal(missingSequence.status, 1);
    assert.match(JSON.parse(missingSequence.stderr).error, /--expected-sequence is required/);
    const conflict = run([
      "import",
      store.id,
      "--bundle",
      directory,
      "--json",
      "--request-id",
      "packaged",
      "--expected-sequence",
      String(store.state.sequence),
    ]);
    assert.equal(conflict.status, 1);
    assert.equal(conflict.stdout, "");
    assert.match(JSON.parse(conflict.stderr).error, /different content/);
    assert.equal(
      parseArgs(["guide", "import", "review", "--bundle", directory, "--expected-sequence", "2"])
        .command,
      "guide-import",
    );
    assert.throws(
      () => parseArgs(["guide", "validate", "review", "--bundle", directory, "HEAD"]),
      /does not accept Git/,
    );
    assert.throws(() => parseArgs(["guide", "import", "review"]), /--bundle/);
  }));

test("prototype-named chunk and target IDs cannot manufacture confirmations or lose resolution", async () =>
  fixture(async (_root, store, snapshot) => {
    const bundle = bundleFor(snapshot);
    const chunk = bundle.manifest.chunks[0];
    chunk.id = "constructor";
    chunk.targets[0].id = "__proto__";
    bundle.documents[chunk.content] = chunk.targets
      .map((target) => `[Inspect](superreview://target/${target.id})`)
      .join("\n");
    const { bounds } = await guideValidationInput(store, bundle);
    const report = validateGuideBundle(bundle, snapshot, bounds);
    assert.equal(report.valid, true);
    assert.equal(Object.hasOwn(report.resolvedTargets, "__proto__"), true);
    const imported = await store.importGuide(bundle, store.state.sequence, "prototype", "Robot");
    assert.equal(store.state.guideReads[imported.guide.id].constructor, false);
    await store.execute(
      { type: "guide-read", guideId: imported.guide.id, chunkId: "constructor", read: true },
      store.state.sequence,
      "prototype-read",
    );
    assert.equal(store.state.guideReads[imported.guide.id].constructor, true);
    const published = await store.guide(imported.guide.id);
    assert.equal(Object.hasOwn(published.resolvedTargets!, "__proto__"), true);
    const absentDocument = structuredClone(bundle);
    absentDocument.manifest.chunks[0].content = "toString";
    assert.ok(
      validateGuideBundle(absentDocument, snapshot, bounds).errors.some(
        (error) => error.code === "EMPTY_CONTENT",
      ),
    );
  }));

test("projected and legacy snapshots share pure validation diagnostics and cannot publish", async () =>
  fixture(async (root, store, snapshot) => {
    for (const captureView of [undefined, "since-reviewed"] as const) {
      const legacy = { ...snapshot, id: `scope-${captureView || "legacy"}`, captureView };
      await store.capture(legacy);
      const directory = await draft(root, bundleFor(legacy));
      const report = await validateGuide({ root: store.root, reviewId: store.id, directory });
      assert.equal(report.valid, false);
      assert.ok(report.errors.some((error) => error.code === "INVALID_CAPTURE_VIEW"));
      await assert.rejects(
        store.importGuide(
          bundleFor(legacy),
          store.state.sequence,
          `import-${captureView || "legacy"}`,
          "Robot",
        ),
        /validation failed/,
      );
    }
    assert.deepEqual(store.state.guides, []);
  }));

test("chunk, total bundle and empty Remaining limits are explicit validation failures", async () =>
  fixture(async (_root, store, snapshot) => {
    const bundle = bundleFor(snapshot);
    const { bounds } = await guideValidationInput(store, bundle);
    const many = structuredClone(bundle);
    many.manifest.chunks = Array.from({ length: GUIDE_LIMITS.chunks + 1 }, (_value, index) => ({
      ...bundle.manifest.chunks[0],
      id: `chunk-${index}`,
    }));
    assert.ok(
      validateGuideBundle(many, snapshot, bounds).errors.some(
        (error) => error.code === "INVALID_SCHEMA",
      ),
    );
    const empty = structuredClone(bundle);
    empty.manifest.chunks[0].kind = "remaining";
    empty.manifest.chunks[0].targets = [];
    assert.ok(
      validateGuideBundle(empty, snapshot, bounds).errors.some(
        (error) => error.code === "INVALID_SCHEMA",
      ),
    );
    const large = structuredClone(bundle);
    large.manifest.chunks = [];
    large.documents = {};
    for (let index = 0; index < 17; index++) {
      const chunk = {
        ...structuredClone(bundle.manifest.chunks[0]),
        id: `chunk-${index}`,
        content: `chunk-${index}.md`,
      };
      for (const target of chunk.targets) target.id += `-${index}`;
      const links = chunk.targets
        .map((target) => `[Inspect](superreview://target/${target.id})`)
        .join("\n");
      large.manifest.chunks.push(chunk);
      large.documents[chunk.content] =
        links + "x".repeat(GUIDE_LIMITS.documentBytes - Buffer.byteLength(links));
    }
    assert.ok(
      validateGuideBundle(large, snapshot, bounds).errors.some(
        (error) => error.code === "RESOURCE_LIMIT" && error.message.includes("total byte"),
      ),
    );
  }));

test("archived reviews refuse publication and chunk read writes without changing history", async () =>
  fixture(async (_root, store, snapshot) => {
    const bundle = bundleFor(snapshot);
    const imported = await store.importGuide(bundle, store.state.sequence, "publication", "Robot");
    await store.execute({ type: "archive", archived: true }, store.state.sequence, "archive");
    const events = await readFile(join(store.directory, "events.jsonl"));
    await assert.rejects(
      store.importGuide(bundle, store.state.sequence, "archived-publication", "Robot"),
      /read-only/,
    );
    await assert.rejects(
      store.execute(
        { type: "guide-read", guideId: imported.guide.id, chunkId: "changes", read: true },
        store.state.sequence,
        "archived-read",
      ),
      /archived/,
    );
    assert.deepEqual(await readFile(join(store.directory, "events.jsonl")), events);
  }));

test("publication preserves title content and existing headless request ID conventions", async () =>
  fixture(async (root, store, snapshot) => {
    const bundle = bundleFor(snapshot);
    bundle.manifest.chunks[0].title = " Captured changes ";
    const directory = await draft(root, bundle);
    assert.equal((await readGuideBundle(directory)).manifest.chunks[0].title, " Captured changes ");
    const requestId = "guide/import:stable-request";
    const published = await store.importGuide(bundle, store.state.sequence, requestId, "Robot");
    assert.equal(
      (await store.guide(published.guide.id)).bundle.manifest.chunks[0].title,
      " Captured changes ",
    );
    bundle.manifest.chunks[0].title = "Captured changes";
    await assert.rejects(
      store.importGuide(bundle, store.state.sequence, requestId, "Robot"),
      /different content/,
    );
  }));

test("canonical retry identity ignores object-key insertion order but preserves authored content", () => {
  assert.equal(guideHash({ b: 2, a: [1] }), guideHash({ a: [1], b: 2 }));
  assert.notEqual(guideHash({ content: "text\n" }), guideHash({ content: "text" }));
});
