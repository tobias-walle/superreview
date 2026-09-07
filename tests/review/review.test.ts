import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  appendFile,
  symlink,
  chmod,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { emptyReview, evolve, decide, pendingThreads } from "../../lib/review/core";
import { JsonlStore, lockRepository } from "../../adapters/node/jsonl-store";
import { capture, git, resolveComparison } from "../../adapters/node/git";
import { startServer } from "../../adapters/node/server";
import { parseArgs } from "../../cli/args";
import type { Snapshot, ReviewIdentity } from "../../lib/review/types";
import type { Thread } from "../../lib/comments/model";

const identity: ReviewIdentity = {
  schema: 1,
  id: "review-test",
  title: "Auth review",
  created: 1,
  binding: { repository: "r", worktree: "/r", branch: "feature" },
};
const snapshot: Snapshot = {
  id: "snapshot-test",
  created: 1,
  base: "abc",
  target: "working-tree",
  label: "Local changes",
  evidence: {},
  data: { repository: "app", branch: "feature", files: [] },
};
const thread: Thread = {
  id: "t1",
  created: 1,
  anchor: {
    snapshotId: snapshot.id,
    fingerprint: "f1",
    path: "auth.ts",
    side: "new",
    start: { line: 1, hunk: 0, source: 0, text: "old" },
    end: { line: 3, hunk: 0, source: 2, text: "new" },
    excerpt: "old\n```\nnew",
  },
  messages: [{ id: "m1", body: "**Please** validate the token.", created: 1 }],
};

test("submissions freeze conversation context and export independently from later edits", () => {
  let state = emptyReview(identity);
  state = evolve(state, decide(state, { type: "thread", thread }, snapshot, "e1", 10));
  assert.equal(pendingThreads(state).length, 1);
  state = evolve(
    state,
    decide(state, { type: "submit", summary: "First round" }, snapshot, "e2", 20),
  );
  const frozen = state.submissions[0].markdown;
  assert.match(frozen, /new L1–3/);
  assert.match(frozen, /snapshot-test/);
  assert.match(frozen, /````/);
  assert.equal(pendingThreads(state).length, 0);
  const edited = structuredClone(thread);
  edited.messages[0].body = "Updated feedback";
  edited.messages[0].edited = 30;
  state = evolve(state, decide(state, { type: "thread", thread: edited }, snapshot, "e3", 30));
  assert.equal(pendingThreads(state).length, 1);
  assert.equal(state.submissions[0].markdown, frozen);
  edited.messages.push({ id: "m2", body: "Reply context", created: 40 });
  state = evolve(state, decide(state, { type: "thread", thread: edited }, snapshot, "e4", 40));
  state = evolve(state, decide(state, { type: "submit", summary: "" }, snapshot, "e5", 50));
  assert.match(state.submissions[1].markdown, /Reply context/);
  assert.match(state.submissions[1].markdown, /Updated feedback/);
  assert.equal(pendingThreads(state).length, 0);
});
test("empty submission rejected; summary-only round allowed; archive keeps history read-only", () => {
  let state = emptyReview(identity);
  assert.throws(
    () => decide(state, { type: "submit", summary: " " }, snapshot, "e1", 1),
    /Add feedback/,
  );
  state = evolve(
    state,
    decide(state, { type: "submit", summary: "Looks good" }, snapshot, "e2", 2),
  );
  state = evolve(state, decide(state, { type: "archive", archived: true }, snapshot, "e3", 3));
  assert.throws(() => decide(state, { type: "thread", thread }, snapshot, "e4", 4), /archived/);
  assert.equal(state.submissions.length, 1);
});
test("deletions and resolution changes become pending without rewriting earlier rounds", () => {
  let state = emptyReview(identity);
  state = evolve(state, decide(state, { type: "thread", thread }, snapshot, "e1", 1));
  state = evolve(state, decide(state, { type: "submit", summary: "" }, snapshot, "e2", 2));
  const deleted = structuredClone(thread);
  deleted.messages[0].deleted = true;
  deleted.messages[0].body = "";
  deleted.resolved = true;
  state = evolve(state, decide(state, { type: "thread", thread: deleted }, snapshot, "e3", 3));
  assert.equal(pendingThreads(state).length, 1);
  assert.equal(state.submissions[0].threads[0].messages[0].deleted, undefined);
});
test("event replay rejects noncontiguous sequences and unknown schemas", () => {
  assert.throws(
    () =>
      evolve(emptyReview(identity), {
        schema: 1,
        id: "x",
        sequence: 2,
        created: 1,
        type: "archive",
        archived: true,
      }),
    /sequence/,
  );
});
async function fixture(fn: (root: string, store: JsonlStore) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "superreview-test-"));
  try {
    git(root, ["init", "-b", "main"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test"]);
    await writeFile(join(root, "auth.ts"), 'const token = "old";\nconst limit = 1;\n');
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "base"]);
    const store = new JsonlStore(join(root, ".superreview"), identity.id);
    await store.create(identity);
    await fn(root, store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const local = { refs: [], paths: [], cached: false };
test("Git captures staged, unstaged, untracked, deleted and symlink changes without editing index", async () =>
  fixture(async (root, store) => {
    await writeFile(join(root, "auth.ts"), 'const token = "staged";\n');
    git(root, ["add", "auth.ts"]);
    await writeFile(join(root, "auth.ts"), 'const token = "working";\n');
    await writeFile(join(root, "new file.ts"), "hello\n");
    await symlink("/not-in-repository", join(root, "link"));
    const index = git(root, ["write-tree"]).toString();
    const snap = await capture(root, local, store);
    assert.deepEqual(snap.data.files.map((f) => f.path).sort(), ["auth.ts", "link", "new file.ts"]);
    assert.match(JSON.stringify(snap.data.files), /working/);
    assert.equal(git(root, ["write-tree"]).toString(), index);
    assert.equal(snap.evidence.link.after.mode, "120000");
    const staged = await capture(root, { ...local, cached: true }, store);
    assert.equal(staged.data.files.length, 1);
    assert.match(JSON.stringify(staged.data.files), /staged/);
    await rm(join(root, "auth.ts"));
    const deleted = await capture(root, local, store);
    assert.equal(deleted.evidence["auth.ts"].after.object, null);
  }));
test("two-dot uses endpoints; three-dot uses merge base; single revision compares working tree", async () =>
  fixture(async (root, store) => {
    git(root, ["checkout", "-b", "feature"]);
    await writeFile(join(root, "feature.ts"), "feature\n");
    git(root, ["add", "feature.ts"]);
    git(root, ["commit", "-m", "feature"]);
    git(root, ["checkout", "main"]);
    await writeFile(join(root, "main.ts"), "main\n");
    git(root, ["add", "main.ts"]);
    git(root, ["commit", "-m", "main"]);
    const endpoints = await capture(root, { ...local, refs: ["main..feature"] }, store);
    const merge = await capture(root, { ...local, refs: ["main...feature"] }, store);
    assert.equal(endpoints.data.files.length, 2);
    assert.deepEqual(
      merge.data.files.map((f) => f.path),
      ["feature.ts"],
    );
    assert.equal(resolveComparison(root, { ...local, refs: ["feature"] }).target, "working-tree");
    assert.throws(
      () => resolveComparison(root, { ...local, refs: ["--output=/tmp/no"] }),
      /Invalid/,
    );
  }));
test("viewed evidence survives ref-only changes, since-reviewed diffs use reviewed content conservatively", async () =>
  fixture(async (root, store) => {
    await writeFile(join(root, "auth.ts"), 'const token = "new";\nconst limit = 1;\n');
    const first = await capture(root, local, store);
    await store.capture(first);
    const f = first.data.files[0];
    await store.execute(
      {
        type: "checkpoint",
        checkpoint: {
          path: f.path,
          fingerprint: f.fingerprint!,
          viewed: true,
          manual: true,
          snapshotId: first.id,
          created: 1,
        },
      },
      store.state.sequence,
      "view",
    );
    const same = await capture(root, local, store, "since");
    assert.equal(same.data.files.length, 0);
    await writeFile(join(root, "auth.ts"), 'const token = "new";\nconst limit = 2;\n');
    const changed = await capture(root, local, store, "since");
    assert.equal(changed.data.files[0].changedSinceReview, true);
    assert.ok(!JSON.stringify(changed.data.files).includes('-const token = \\"old'));
    assert.equal(
      changed.evidence["auth.ts"].before.object,
      first.evidence["auth.ts"].before.object,
    );
    git(root, ["add", "auth.ts"]);
    git(root, ["commit", "-m", "new base"]);
    await writeFile(join(root, "auth.ts"), 'const token = "latest";\n');
    const changedBase = await capture(root, local, store, "since");
    assert.notEqual(
      changedBase.evidence["auth.ts"].before.object,
      first.evidence["auth.ts"].before.object,
    );
    assert.match(JSON.stringify(changedBase.data.files), /-const limit = 2/);
  }));
test("snapshot objects restore original bytes after files change and a branch is deleted", async () =>
  fixture(async (root, store) => {
    await writeFile(join(root, "auth.ts"), "captured\n");
    const snap = await capture(root, local, store);
    await store.capture(snap);
    await writeFile(join(root, "auth.ts"), "later\n");
    const restored = await store.snapshot(snap.id);
    assert.equal(
      (await store.readObject(restored.evidence["auth.ts"].after.object!)).toString(),
      "captured\n",
    );
    assert.deepEqual(restored, snap);
  }));
test("JSONL append is replayable, stale writes rejected and retries idempotent", async () =>
  fixture(async (root, store) => {
    await store.capture(await capture(root, local, store));
    const sequence = store.state.sequence;
    await store.execute({ type: "submit", summary: "Done" }, sequence, "submit1");
    await store.execute({ type: "submit", summary: "Done" }, sequence, "submit1");
    assert.equal(store.state.submissions.length, 1);
    await assert.rejects(
      () => store.execute({ type: "submit", summary: "Stale" }, sequence, "submit2"),
      /another tab/,
    );
    const replay = new JsonlStore(store.root, store.id);
    await replay.load();
    assert.deepEqual(replay.state, store.state);
  }));
test("recover incomplete final JSONL write but fail on corrupted middle record", async () =>
  fixture(async (root, store) => {
    await store.capture(await capture(root, local, store));
    const path = join(store.directory, "events.jsonl"),
      good = await readFile(path, "utf8");
    await appendFile(path, '{"partial":');
    await assert.rejects(() => store.load(), /Incomplete/);
    await store.load(true);
    assert.equal(await readFile(path, "utf8"), good);
    await writeFile(path, good + "{bad}\n" + good);
    await assert.rejects(() => store.load(true));
  }));
test("repository writer lock prevents a second writer and releases cleanly", async () =>
  fixture(async (root, store) => {
    const release = await lockRepository(store.root);
    await assert.rejects(() => lockRepository(store.root), /already running/);
    await release();
    const again = await lockRepository(store.root);
    await again();
  }));
test("HTTP lifecycle persists comment, reply, submission, history and rejects cross-origin mutation", async () =>
  fixture(async (root, store) => {
    await writeFile(join(root, "auth.ts"), "new\n");
    const snap = await capture(root, local, store);
    await store.capture(snap);
    const { server, url } = await startServer({
      store,
      root,
      comparison: local,
      web: root,
      port: 0,
    });
    const post = async (path: string, value: unknown, headers = {}) =>
      fetch(url + path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-superreview": "1",
          ...headers,
        },
        body: JSON.stringify(value),
      });
    try {
      const session: any = await (await fetch(url + "/api/session")).json();
      const t = structuredClone(thread);
      t.anchor.snapshotId = snap.id;
      t.anchor.fingerprint = snap.data.files[0].fingerprint!;
      const saved = await post("/api/commands", {
        sequence: session.state.sequence,
        id: "http-comment",
        command: { type: "thread", thread: t },
      });
      assert.equal(saved.status, 200);
      t.messages.push({
        id: "reply",
        body: "Add expiry validation too.",
        created: 2,
      });
      await post("/api/commands", {
        sequence: store.state.sequence,
        id: "http-reply",
        command: { type: "thread", thread: t },
      });
      const submitted = await post("/api/commands", {
        sequence: store.state.sequence,
        id: "http-submit",
        command: { type: "submit", summary: "Ready for agent" },
      });
      assert.equal(submitted.status, 200);
      assert.match(store.state.submissions[0].markdown, /expiry validation/);
      const attack = await post("/api/commands", {}, { origin: "https://evil.example" });
      assert.equal(attack.status, 403);
      const invalid = await post("/api/commands", {
        sequence: store.state.sequence,
        id: "invalid",
        command: { type: "thread", thread: {} },
      });
      assert.equal(invalid.status, 400);
      const restore = new JsonlStore(store.root, store.id);
      await restore.load();
      assert.equal(restore.state.submissions.length, 1);
      const history = await fetch(url + "/api/snapshots/" + snap.id);
      assert.equal(history.status, 200);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }));
test("CLI parser handles comparison/path split and rejects unknown flags", () => {
  assert.deepEqual(parseArgs(["main...feature", "--", "space name.ts"]).paths, ["space name.ts"]);
  assert.equal(parseArgs(["--cached"]).cached, true);
  assert.equal(parseArgs(["export", "abc", "--submission", "2"]).submission, 2);
  assert.throws(() => parseArgs(["--surprise"]), /Unknown/);
  assert.throws(() => parseArgs(["--port", "wrong"]), /Invalid/);
});

test("unchanged branch diff evidence survives an empty commit", async () =>
  fixture(async (root, store) => {
    git(root, ["checkout", "-b", "feature"]);
    await writeFile(join(root, "auth.ts"), "changed\n");
    git(root, ["add", "auth.ts"]);
    git(root, ["commit", "-m", "change"]);
    const comparison = { ...local, refs: ["main...HEAD"] };
    const before = await capture(root, comparison, store);
    await store.capture(before);
    const file = before.data.files[0];
    await store.execute(
      {
        type: "checkpoint",
        checkpoint: {
          path: file.path,
          fingerprint: file.fingerprint!,
          viewed: true,
          manual: false,
          snapshotId: before.id,
          created: 1,
        },
      },
      store.state.sequence,
      "mark",
    );
    git(root, ["commit", "--allow-empty", "-m", "metadata only"]);
    const after = await capture(root, comparison, store);
    assert.notEqual(before.target, after.target);
    assert.equal(before.evidence["auth.ts"].key, after.evidence["auth.ts"].key);
    assert.equal((await capture(root, comparison, store, "since")).data.files.length, 0);
  }));
test("mode-only and binary changes preserve reviewable file evidence", async () =>
  fixture(async (root, store) => {
    await chmod(join(root, "auth.ts"), 0o755);
    await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2]));
    const snap = await capture(root, local, store);
    assert.match(
      snap.data.files.find((f) => f.path === "auth.ts")!.changeSummary!,
      /100644.*100755/,
    );
    assert.equal(snap.data.files.find((f) => f.path === "binary.bin")!.binary, true);
  }));
test("capture does not follow a directory replaced by an external symlink", async () =>
  fixture(async (root, store) => {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "auth.ts"), "tracked\n");
    git(root, ["add", "nested"]);
    git(root, ["commit", "-m", "directory"]);
    await rm(join(root, "nested"), { recursive: true });
    await symlink(root, join(root, "nested"));
    const snap = await capture(root, local, store);
    assert.equal(snap.evidence["nested/auth.ts"].after.object, null);
  }));
test("capture supports unborn repositories and excludes its own store", async () => {
  const root = await mkdtemp(join(tmpdir(), "superreview-unborn-"));
  try {
    git(root, ["init", "-b", "main"]);
    await writeFile(join(root, "first.ts"), "first\n");
    const store = new JsonlStore(join(root, ".superreview"), identity.id);
    await store.create(identity);
    const snap = await capture(root, local, store);
    assert.deepEqual(
      snap.data.files.map((f) => f.path),
      ["first.ts"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packaged CLI starts, serves assets, resumes a review, exports history and archives it", async () =>
  fixture(async (root) => {
    // Exercise the distributable binary, not imports of its entry point.
    const binary = resolve("dist-cli/superreview.mjs");
    await writeFile(join(root, "auth.ts"), "cli change\n");
    async function launch(args: string[]) {
      const child = spawn(process.execPath, [binary, ...args, "--no-open", "--json"], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "",
        errors = "";
      child.stderr.on("data", (chunk) => {
        errors += chunk.toString();
      });
      const ready: any = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("CLI did not start: " + errors));
        }, 15000);
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`CLI exited ${code}: ${errors}`));
        });
        child.stdout.on("data", (chunk) => {
          output += chunk.toString();
          if (output.includes("\n")) {
            clearTimeout(timer);
            resolve(JSON.parse(output.split("\n")[0]));
          }
        });
      });
      return {
        ...ready,
        stop: () =>
          new Promise<void>((r) => {
            child.once("exit", () => r());
            child.kill("SIGTERM");
          }),
      };
    }
    const first = await launch(["--new", "--name", "CLI round"]);
    const post = async (url: string, path: string, value: unknown) =>
      fetch(url + path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-superreview": "1" },
        body: JSON.stringify(value),
      });
    try {
      const html = await (await fetch(first.url)).text();
      assert.match(html, /<title>Superreview<\/title>/);
      const script = html.match(/src="([^"]+\.js)"/)![1];
      assert.equal((await fetch(first.url + script)).status, 200);
      const session: any = await (await fetch(first.url + "/api/session")).json();
      assert.ok(session.snapshot.data.files.some((f: any) => f.path === "auth.ts"));
      const submitted = await post(first.url, "/api/commands", {
        sequence: session.state.sequence,
        id: "cli-submit",
        command: { type: "submit", summary: "CLI end-to-end round" },
      });
      assert.equal(submitted.status, 200);
    } finally {
      await first.stop();
    }
    const second = await launch(["--cached"]);
    try {
      assert.equal(
        second.reviewId,
        first.reviewId,
        "branch review remains stable across local comparison modes",
      );
    } finally {
      await second.stop();
    }
    const exported = execFileSync(
      process.execPath,
      [binary, "export", first.reviewId, "--submission", "1"],
      { cwd: root, encoding: "utf8" },
    );
    assert.match(exported, /CLI end-to-end round/);
    const archived = JSON.parse(
      execFileSync(process.execPath, [binary, "archive", first.reviewId, "--json"], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    assert.equal(archived.archived, true);
    const opened = await launch(["open", first.reviewId]);
    try {
      const session: any = await (await fetch(opened.url + "/api/session")).json();
      assert.equal(session.state.archived, true);
      assert.equal(session.state.submissions.length, 1);
    } finally {
      await opened.stop();
    }
  }));

test("draft replacement rejects stale tabs without creating event noise", async () =>
  fixture(async (root, store) => {
    const draft = {
      id: "d1",
      anchor: thread.anchor,
      body: "Unfinished thought",
    };
    assert.equal(await store.saveDrafts([draft], 0), 1);
    await assert.rejects(() => store.saveDrafts([], 0), /another tab/);
    assert.equal((await store.draftState()).drafts[0].body, draft.body);
    assert.equal(store.state.sequence, 0);
  }));
test("damaged content objects fail visibly instead of becoming comparison evidence", async () =>
  fixture(async (root, store) => {
    const id = await store.object(Buffer.from("original"));
    await writeFile(join(store.root, "objects", id), "corrupt");
    await assert.rejects(() => store.readObject(id), /damaged/);
  }));
