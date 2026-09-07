import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { parsePatch } from "../lib/diff/parse.mjs";
export function snapshot(directory) {
  const cwd = resolve(directory);
  const git = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  const run = (args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  let base = "HEAD";
  try {
    run(["rev-parse", "--verify", "HEAD"]);
  } catch {
    base = run(["hash-object", "-t", "tree", "--stdin"]).trim();
  }
  let branch;
  try {
    branch = run(["symbolic-ref", "--short", "HEAD"]).trim();
  } catch {
    branch = run(["rev-parse", "--short", "HEAD"]).trim();
  }
  const status = run(["diff", "--name-status", "-z", "--no-renames", base, "--"]).split("\0");
  const entries = [];
  for (let i = 0; i < status.length - 1; i += 2) entries.push([status[i], status[i + 1]]);
  for (const p of run(["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean))
    entries.push(["A", p]);
  const files = entries.map(([state, path]) => {
    const common = [
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--diff-algorithm=histogram",
      "--unified=4",
    ];
    let patch;
    const tracked = run(["ls-files", "--", path]).length > 0;
    if (tracked) patch = run(["diff", ...common, "--no-renames", base, "--", path]);
    else {
      try {
        patch = run(["diff", "--no-index", ...common, "--", "/dev/null", path]);
      } catch (e) {
        if (e.status !== 1) throw e;
        patch = e.stdout;
      }
    }
    return parsePatch(patch, path, state);
  });
  return {
    repository: basename(root),
    repositoryId: createHash("sha256").update(root).digest("hex"),
    branch,
    files,
  };
}
