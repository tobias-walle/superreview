import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("packaged skill reads outside Git without creating files, and has matching JSON output", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "superreview-skill-"));
  const cli = resolve("dist-cli/superreview.mjs");
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  try {
    const plain = run("skill", "read");
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(plain.stderr, "");
    assert.equal(plain.stdout, await readFile("skill-data/review.md", "utf8"));
    const json = run("skill", "read", "--json");
    assert.equal(json.status, 0, json.stderr);
    assert.deepEqual(JSON.parse(json.stdout), { name: "superreview", content: plain.stdout });
    for (const args of [
      ["skill"],
      ["skill", "write"],
      ["skill", "read", "../secret"],
      ["skill", "read", "--new"],
    ]) {
      const invalid = run(...args);
      assert.equal(invalid.status, 1);
      assert.equal(invalid.stdout, "");
      assert.match(invalid.stderr, /Usage: superreview skill read/);
    }
    assert.deepEqual(await readdir(cwd), []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
