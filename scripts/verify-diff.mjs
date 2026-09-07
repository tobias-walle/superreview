import assert from "node:assert/strict";
import { wordDiff, alignTokens } from "../lib/diff/word.mjs";
import { snapshot } from "../bin/snapshot.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// Alignment expectations taken from delta's align.rs tests.
assert.deepEqual(alignTokens([..."aaa"], [..."aba"]), [0, 1, 2, 0]);
assert.deepEqual(alignTokens([..."kitten"], [..."sitting"]), [1, 2, 0, 0, 0, 1, 2, 0, 2]);
const pairs = [
  ["const count = 1;", "const count = 2;"],
  ["hello world", "hello beautiful world"],
  ["", "new"],
  ["old", ""],
  ["👩🏽‍💻 café", "👩🏽‍💻 tea"],
  ["a  b", "a b"],
];
for (const [a, b] of pairs) {
  const d = wordDiff(a, b);
  assert.equal(d.before.map((x) => x.text).join(""), a);
  assert.equal(d.after.map((x) => x.text).join(""), b);
}
const words = wordDiff("'--diff-algorithm=myers'", "'--diff-algorithm=histogram'");
assert.equal(
  words.before
    .filter((x) => x.changed)
    .map((x) => x.text)
    .join(""),
  "myers",
);
assert.equal(
  words.after
    .filter((x) => x.changed)
    .map((x) => x.text)
    .join(""),
  "histogram",
);
const temp = mkdtempSync(join(tmpdir(), "patchwork-test-"));
const git = (args) =>
  execFileSync("git", args, {
    cwd: temp,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
try {
  git(["init", "-q"]);
  writeFileSync(join(temp, "untracked.txt"), "hello\n");
  const unborn = snapshot(temp);
  assert.equal(unborn.files.length, 1);
  assert.equal(unborn.files[0].status, "A");
  writeFileSync(join(temp, "tracked.txt"), "one\ntwo\n");
  writeFileSync(join(temp, "deleted.txt"), "bye\n");
  git(["add", "."]);
  git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "Fixture",
  ]);
  writeFileSync(join(temp, "tracked.txt"), "one\nchanged\n");
  git(["add", "tracked.txt"]);
  writeFileSync(join(temp, "tracked.txt"), "one\nchanged\nunstaged\n");
  rmSync(join(temp, "deleted.txt"));
  writeFileSync(join(temp, "space name.txt"), "new\n");
  const d = snapshot(temp);
  assert.equal(d.files.length, 3);
  assert.equal(d.files.find((f) => f.path === "tracked.txt").additions, 2);
  assert.equal(d.files.find((f) => f.path === "deleted.txt").status, "D");
  assert.equal(d.files.find((f) => f.path === "space name.txt").status, "A");
  assert.match(d.files.find((f) => f.path === "tracked.txt").hunks[0].lines.join("\n"), /unstaged/);
  console.log(
    "PASS: delta alignment cases; word reconstruction; unborn repository; staged + unstaged + untracked + deleted files.",
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
