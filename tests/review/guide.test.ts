import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, readdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { capture, git } from "../../adapters/node/git";
import { JsonlStore, lockRepository } from "../../adapters/node/jsonl-store";
import { inspectGuide } from "../../cli/guide-commands";
import { parseArgs } from "../../cli/args";
import { guideInventory, unionGuideIntervals } from "../../lib/review/guide-coverage";
import type { Snapshot, ReviewIdentity } from "../../lib/review/types";

const identity: ReviewIdentity = {
  schema: 1,
  id: "guide-review",
  title: "Guide inventory",
  created: 1,
  binding: { repository: "r", worktree: "/r", branch: "main" },
};
const local = { refs: [], paths: [], cached: false };
const missing = { object: null, mode: "000000" };
function textSnapshot(): Snapshot {
  return {
    id: "saved-full",
    captureView: "full",
    created: 1,
    label: "Local changes",
    base: "base",
    target: "working-tree",
    comparison: local,
    evidence: {
      "domain.ts": {
        before: { object: "old", mode: "100644" },
        after: { object: "new", mode: "100644" },
        key: "evidence",
      },
    },
    data: {
      repository: "r",
      branch: "main",
      files: [
        {
          path: "domain.ts",
          status: "M",
          fingerprint: "fp",
          sourceObjects: { old: "old", new: "new" },
          additions: 4,
          deletions: 2,
          hunks: [
            {
              header: "@@ -119,4 +119,6 @@",
              oldStart: 119,
              newStart: 119,
              lines: [
                "-before",
                "+after",
                "+more",
                " unchanged",
                "-telemetry",
                "+other",
                "+more other",
                "\\ No newline at end of file",
                " context",
              ],
            },
          ],
        },
      ],
    },
  };
}

test("inventory preserves both sides, disjoint changed runs and original file identity without word diff", () => {
  const snapshot = textSnapshot();
  const before = structuredClone(snapshot);
  const inventory = guideInventory(snapshot);
  assert.deepEqual(inventory.files[0], {
    path: "domain.ts",
    fileIndex: 0,
    fingerprint: "fp",
    evidence: snapshot.evidence["domain.ts"],
    old: [
      { start: 119, end: 119 },
      { start: 121, end: 121 },
    ],
    new: [
      { start: 119, end: 120 },
      { start: 122, end: 123 },
    ],
    markers: [],
  });
  assert.deepEqual(snapshot, before);
});

test("interval union counts overlap once without mutating assignments", () => {
  const ranges = [
    { start: 8, end: 12 },
    { start: 1, end: 4 },
    { start: 3, end: 9 },
    { start: 14, end: 14 },
  ];
  const before = structuredClone(ranges);
  assert.deepEqual(unionGuideIntervals(ranges), [
    { start: 1, end: 12 },
    { start: 14, end: 14 },
  ]);
  assert.deepEqual(ranges, before);
});

test("inventory bounds output by runs for a large changed hunk", () => {
  const snapshot = textSnapshot();
  const file = snapshot.data.files[0];
  file.hunks = [
    { header: "@@ -0,0 +1,100000 @@", oldStart: 0, newStart: 1, lines: Array(100000).fill("+new") },
  ];
  assert.deepEqual(guideInventory(snapshot).files[0].new, [{ start: 1, end: 100000 }]);
});

test("inventory retains binary, mode-only, submodule, empty, deletion and rename-as-delete/add markers", () => {
  const snapshot = textSnapshot();
  const specs = [
    {
      path: "binary",
      before: { object: "b", mode: "100644" },
      after: { object: "c", mode: "100644" },
      binary: true,
      markers: ["binary", "non-text"],
    },
    {
      path: "mode",
      before: { object: "b", mode: "100644" },
      after: { object: "b", mode: "100755" },
      markers: ["mode"],
    },
    {
      path: "submodule",
      before: { object: "b", mode: "160000" },
      after: { object: "c", mode: "160000" },
      markers: ["submodule", "non-text"],
    },
    {
      path: "empty",
      before: missing,
      after: { object: "empty", mode: "100644" },
      markers: ["added", "mode", "non-text"],
    },
    {
      path: "old-name",
      before: { object: "empty", mode: "100644" },
      after: missing,
      markers: ["deleted", "mode", "non-text"],
    },
    {
      path: "new-name",
      before: missing,
      after: { object: "empty", mode: "100644" },
      markers: ["added", "mode", "non-text"],
    },
  ];
  snapshot.evidence = Object.fromEntries(
    specs.map((spec) => [spec.path, { before: spec.before, after: spec.after, key: spec.path }]),
  );
  snapshot.data.files = specs.map((spec) => ({
    path: spec.path,
    status: "M",
    additions: 0,
    deletions: 0,
    binary: spec.binary,
    hunks: [],
  }));
  const inventory = guideInventory(snapshot);
  assert.equal(inventory.files.length, specs.length);
  for (const [index, spec] of specs.entries()) {
    assert.equal(inventory.files[index].fileIndex, index);
    assert.deepEqual(inventory.files[index].markers, spec.markers);
  }
});

test("scope comes from explicit provenance, not labels, and incomplete evidence cannot disappear", () => {
  const snapshot = textSnapshot();
  snapshot.label = "Since reviewed";
  assert.equal(guideInventory(snapshot).files.length, 1);
  snapshot.captureView = "since-reviewed";
  assert.throws(() => guideInventory(snapshot), /full capture/);
  delete snapshot.captureView;
  assert.equal(guideInventory(snapshot).files.length, 1);
  snapshot.evidence.omitted = snapshot.evidence["domain.ts"];
  assert.throws(() => guideInventory(snapshot), /omits captured evidence for omitted/);
  delete snapshot.evidence.omitted;
  snapshot.data.files[0].sourceObjects!.old = "reviewed-after";
  assert.throws(() => guideInventory(snapshot), /does not match full content evidence/);
});

async function fixture(fn: (root: string, store: JsonlStore) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "superreview-guide-"));
  try {
    git(root, ["init", "-b", "main"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test"]);
    await writeFile(join(root, "domain.ts"), "before\nunchanged\n");
    await writeFile(join(root, "deleted.ts"), "removed\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "base"]);
    const store = new JsonlStore(join(root, ".superreview"), identity.id);
    await store.create(identity);
    await fn(root, store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Git capture persists authoritative full/since provenance and narrow comparison scope", async () =>
  fixture(async (root, store) => {
    await writeFile(join(root, "domain.ts"), "staged\n");
    git(root, ["add", "domain.ts"]);
    await writeFile(join(root, "domain.ts"), "unstaged\n");
    const comparison = { ...local, cached: true, paths: ["domain.ts"] };
    const full = await capture(root, comparison, store);
    await store.capture(full);
    assert.equal((await store.snapshot(full.id)).captureView, "full");
    assert.deepEqual((await store.snapshot(full.id)).comparison, comparison);
    const since = await capture(root, comparison, store, "since");
    await store.capture(since);
    assert.equal((await store.snapshot(since.id)).captureView, "since-reviewed");
    assert.throws(() => guideInventory(since), /full capture/);
  }));

test("inspection reads exact saved sources, binary bytes and historical diff without writes or worktree substitution", async () =>
  fixture(async (root, store) => {
    await writeFile(join(root, "domain.ts"), "captured\nunchanged\n");
    await rm(join(root, "deleted.ts"));
    const binary = Buffer.from([0, 0xff, 1, 2]);
    await writeFile(join(root, "binary.bin"), binary);
    await writeFile(join(root, "empty"), "");
    await chmod(join(root, "domain.ts"), 0o755);
    const snapshot = await capture(root, local, store);
    await store.capture(snapshot);
    const events = await readFile(join(store.directory, "events.jsonl"));
    const index = git(root, ["write-tree"]);
    const excludePath = resolve(
      root,
      git(root, ["rev-parse", "--git-path", "info/exclude"]).toString().trim(),
    );
    const exclude = await readFile(excludePath);
    await writeFile(join(root, "domain.ts"), "live data must not replace capture\n");
    await rm(join(root, "binary.bin"));
    const later = await capture(root, { ...local, paths: ["domain.ts"] }, store);
    await store.capture(later);
    const laterEvents = await readFile(join(store.directory, "events.jsonl"));
    const unlock = await lockRepository(store.root);
    try {
      const inspection = await inspectGuide({
        root: store.root,
        reviewId: store.id,
        snapshotId: snapshot.id,
      });
      assert.equal(inspection.captureView, "full");
      assert.deepEqual(inspection.snapshot, snapshot);
      assert.equal(
        inspection.sources.find((source) => source.path === "domain.ts")!.old.content,
        "before\nunchanged\n",
      );
      assert.equal(
        inspection.sources.find((source) => source.path === "domain.ts")!.new.content,
        "captured\nunchanged\n",
      );
      assert.equal(
        inspection.sources.find((source) => source.path === "domain.ts")!.new.lineCount,
        2,
      );
      const exportedBinary = inspection.sources.find((source) => source.path === "binary.bin")!;
      assert.equal(exportedBinary.new.encoding, "base64");
      assert.deepEqual(Buffer.from(exportedBinary.new.content!, "base64"), binary);
      assert.equal(exportedBinary.old.content, null);
      assert.equal(
        inspection.sources.find((source) => source.path === "deleted.ts")!.new.content,
        null,
      );
      assert.equal(inspection.sources.find((source) => source.path === "empty")!.new.content, "");
      assert.deepEqual(await readFile(join(store.directory, "events.jsonl")), laterEvents);
      assert.deepEqual(git(root, ["write-tree"]), index);
      assert.deepEqual(await readFile(excludePath), exclude);
      assert.equal((await readdir(store.root)).includes("config.json"), false);
      assert.notDeepEqual(events, laterEvents);
    } finally {
      await unlock();
    }
  }));

test("captured inventory includes mode-only, staged gitlinks and renamed/deleted entries", async () =>
  fixture(async (root, store) => {
    await chmod(join(root, "domain.ts"), 0o755);
    await rm(join(root, "deleted.ts"));
    await writeFile(join(root, "renamed.ts"), "removed\n");
    const oid = git(root, ["rev-parse", "HEAD"]).toString().trim();
    git(root, ["update-index", "--add", "--cacheinfo", `160000,${oid},module`]);
    git(root, ["add", "domain.ts", "deleted.ts", "renamed.ts"]);
    const snapshot = await capture(root, { ...local, cached: true }, store);
    const inventory = guideInventory(snapshot);
    assert.deepEqual(inventory.files.map((file) => file.path).sort(), [
      "deleted.ts",
      "domain.ts",
      "module",
      "renamed.ts",
    ]);
    const mode = inventory.files.find((file) => file.path === "domain.ts")!;
    assert.deepEqual(mode.old, []);
    assert.deepEqual(mode.new, []);
    assert.deepEqual(mode.markers, ["mode"]);
    assert.ok(
      inventory.files.find((file) => file.path === "module")!.markers.includes("submodule"),
    );
    assert.ok(
      inventory.files.find((file) => file.path === "deleted.ts")!.markers.includes("deleted"),
    );
    assert.deepEqual(inventory.files.find((file) => file.path === "deleted.ts")!.old, [
      { start: 1, end: 1 },
    ]);
    assert.ok(
      inventory.files.find((file) => file.path === "renamed.ts")!.markers.includes("added"),
    );
    assert.deepEqual(inventory.files.find((file) => file.path === "renamed.ts")!.new, [
      { start: 1, end: 1 },
    ]);
  }));

test("inspection never repairs events or falls back to live source for damaged objects", async () =>
  fixture(async (root, store) => {
    await writeFile(join(root, "domain.ts"), "saved\n");
    const snapshot = await capture(root, local, store);
    await store.capture(snapshot);
    const object = snapshot.evidence["domain.ts"].after.object!;
    await writeFile(join(store.root, "objects", object), "damaged");
    await assert.rejects(
      inspectGuide({ root: store.root, reviewId: store.id, snapshotId: snapshot.id }),
      /damaged/,
    );
    const path = join(store.directory, "events.jsonl");
    const interrupted = (await readFile(path, "utf8")) + '{"incomplete":';
    await writeFile(path, interrupted);
    await assert.rejects(
      inspectGuide({ root: store.root, reviewId: store.id, snapshotId: snapshot.id }),
      /Incomplete final event/,
    );
    assert.equal(await readFile(path, "utf8"), interrupted);
    assert.equal(
      (await readdir(store.directory)).some((name) => name.startsWith("interrupted-")),
      false,
    );
  }));

test("guide inspect CLI requires explicit saved identities and rejects live comparison arguments", () => {
  const options = parseArgs(["guide", "inspect", "review", "--snapshot", "saved", "--json"]);
  assert.equal(options.command, "guide-inspect");
  assert.equal(options.id, "review");
  assert.equal(options.snapshot, "saved");
  assert.equal(options.json, true);
  assert.throws(() => parseArgs(["guide", "import", "review"]), /Usage/);
  assert.throws(() => parseArgs(["guide", "inspect", "review"]), /--snapshot/);
  assert.throws(
    () => parseArgs(["guide", "inspect", "review", "--snapshot", "saved", "HEAD"]),
    /does not accept Git/,
  );
});

test("packaged guide inspect emits clean saved JSON and fails nonzero with diagnostics only on stderr", async () =>
  fixture(async (root, store) => {
    await writeFile(join(root, "domain.ts"), "saved\n");
    const snapshot = await capture(root, local, store);
    await store.capture(snapshot);
    await writeFile(join(root, "domain.ts"), "later live source\n");
    const cli = resolve("dist-cli/superreview.mjs");
    const args = [
      cli,
      "guide",
      "inspect",
      store.id,
      "--snapshot",
      snapshot.id,
      "--json",
      "--verbose",
    ];
    const events = await readFile(join(store.directory, "events.jsonl"));
    const output = JSON.parse(
      execFileSync(process.execPath, args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    assert.deepEqual(output.snapshot, snapshot);
    assert.equal(
      output.sources.find((source: { path: string }) => source.path === "domain.ts").new.content,
      "saved\n",
    );
    assert.deepEqual(await readFile(join(store.directory, "events.jsonl")), events);
    const failed = spawnSync(
      process.execPath,
      [cli, "guide", "inspect", store.id, "--snapshot", "missing", "--json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, "");
    assert.match(JSON.parse(failed.stderr).error, /ENOENT/);
  }));
