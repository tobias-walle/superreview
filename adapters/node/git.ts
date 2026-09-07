import { execFileSync } from "node:child_process";
import { lstat, readFile, readlink, mkdtemp, writeFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { parsePatch } from "../../lib/diff/parse.mjs";
import type { Evidence, FileVersion, Snapshot } from "../../lib/review/types";
import type { JsonlStore } from "./jsonl-store";

export type Comparison = { refs: string[]; cached: boolean; paths: string[] };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const missing: FileVersion = { object: null, mode: "000000" };
export function git(root: string, args: string[], input?: Buffer): Buffer {
  return execFileSync("git", ["--literal-pathspecs", ...args], {
    cwd: root,
    input,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
export function repository(directory: string) {
  const root = git(directory, ["rev-parse", "--show-toplevel"]).toString().trim();
  const common = resolve(root, git(root, ["rev-parse", "--git-common-dir"]).toString().trim());
  let branch: string;
  try {
    branch = git(root, ["symbolic-ref", "--short", "HEAD"]).toString().trim();
  } catch {
    branch = git(root, ["rev-parse", "--short", "HEAD"]).toString().trim();
  }
  return { root, common, branch, id: hash(common) };
}
function commit(root: string, ref: string) {
  if (!ref || ref.startsWith("-")) throw new Error("Invalid Git revision");
  try {
    return git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])
      .toString()
      .trim();
  } catch {
    throw new Error(`Cannot resolve Git revision: ${ref}`);
  }
}
export function resolveComparison(root: string, comparison: Comparison) {
  const { refs, cached } = comparison;
  if (refs.length > 2) throw new Error("Use one revision, two revisions, or A..B / A...B.");
  let base: string,
    target = cached ? "index" : "working-tree";
  let label = cached ? "Staged changes" : "Local changes";
  if (!refs.length) {
    try {
      base = commit(root, "HEAD");
    } catch {
      base = git(root, ["hash-object", "-t", "tree", "--stdin"], Buffer.alloc(0)).toString().trim();
    }
  } else if (refs.length === 2 || refs[0].includes("..")) {
    if (cached) throw new Error("--cached accepts at most one base revision.");
    const triple = refs.length === 1 && refs[0].includes("...");
    const pair = refs.length === 2 ? refs : refs[0].split(triple ? "..." : "..");
    if (pair.length !== 2) throw new Error("Invalid comparison range");
    base = commit(root, pair[0] || "HEAD");
    target = commit(root, pair[1] || "HEAD");
    if (triple) base = git(root, ["merge-base", base, target]).toString().trim();
    label = refs.join(" → ");
  } else {
    base = commit(root, refs[0]);
    label = `${refs[0]} → ${cached ? "index" : "working tree"}`;
  }
  return { base, target, label };
}
async function capturedVersion(
  root: string,
  ref: string,
  path: string,
  store: JsonlStore,
): Promise<FileVersion> {
  if (ref === "working-tree") {
    try {
      // A tracked directory can have been replaced by a symlink. Do not follow it.
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) {
        const parent = await lstat(join(root, ...parts.slice(0, i)));
        if (parent.isSymbolicLink() || !parent.isDirectory()) return missing;
      }
      // Never follow symlinks into paths outside the repository.
      const stat = await lstat(join(root, path));
      if (stat.isSymbolicLink())
        return {
          object: await store.object(Buffer.from(await readlink(join(root, path)))),
          mode: "120000",
        };
      if (stat.isDirectory()) {
        const oid = git(join(root, path), ["rev-parse", "HEAD"]).toString().trim();
        return { object: await store.object(Buffer.from(oid)), mode: "160000" };
      }
      return {
        object: await store.object(await readFile(join(root, path))),
        mode: stat.mode & 0o111 ? "100755" : "100644",
      };
    } catch (e: any) {
      if (e.code === "ENOENT") return missing;
      throw e;
    }
  }
  const raw = git(
    root,
    ref === "index"
      ? ["ls-files", "--stage", "-z", "--", path]
      : ["ls-tree", "-z", ref, "--", path],
  ).toString();
  if (!raw) return missing;
  const [header] = raw.split("\t");
  const parts = header.split(" ");
  if (ref === "index" && (parts[2] !== "0" || raw.split("\0").filter(Boolean).length > 1))
    throw new Error(`Resolve the merge conflict in ${path} before capturing staged changes.`);
  const mode = parts[0],
    oid = ref === "index" ? parts[1] : parts[2];
  if (mode === "040000") return missing;
  const content = mode === "160000" ? Buffer.from(oid) : git(root, ["cat-file", "blob", oid]);
  return { object: await store.object(content), mode };
}
export async function capture(
  root: string,
  comparison: Comparison,
  store: JsonlStore,
  view: "full" | "since" = "full",
): Promise<Snapshot> {
  const repo = repository(root),
    resolved = resolveComparison(root, comparison);
  const args = [
    "diff",
    "--name-status",
    "-z",
    "--no-renames",
    ...(comparison.cached ? ["--cached"] : []),
    resolved.base,
    ...(!["index", "working-tree"].includes(resolved.target) ? [resolved.target] : []),
    "--",
    ...comparison.paths,
  ];
  const raw = git(root, args).toString().split("\0");
  const paths = new Map<string, string>();
  for (let i = 0; i < raw.length - 1; i += 2) paths.set(raw[i + 1], raw[i]);
  if (resolved.target === "working-tree") {
    for (const path of git(root, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...comparison.paths,
    ])
      .toString()
      .split("\0")
      .filter(Boolean))
      paths.set(path, "A");
  }
  const evidence: Record<string, Evidence> = {},
    files = [];
  const temp = await mkdtemp(join(tmpdir(), "superreview-diff-"));
  try {
    for (const [path, status] of paths) {
      if (path === ".superreview" || path.startsWith(".superreview/")) continue;
      if (status === "U")
        throw new Error(`Resolve the merge conflict in ${path} before reviewing.`);
      const before = await capturedVersion(root, resolved.base, path, store);
      const after = await capturedVersion(root, resolved.target, path, store);
      const key = hash([path, before, after]);
      evidence[path] = { before, after, key };
      const checkpoint = store.state.checkpoints[path];
      if (view === "since" && checkpoint?.viewed && checkpoint.evidence?.key === key) continue;
      // Only extend reviewed evidence if the full comparison's base is unchanged.
      const compatible =
        checkpoint?.viewed &&
        JSON.stringify(checkpoint.evidence?.before) === JSON.stringify(before);
      const shownBefore = view === "since" && compatible ? checkpoint.evidence!.after : before;
      const left = shownBefore.object
        ? await store.readObject(shownBefore.object)
        : Buffer.alloc(0);
      const right = after.object ? await store.readObject(after.object) : Buffer.alloc(0);
      await writeFile(join(temp, "before"), left);
      await writeFile(join(temp, "after"), right);
      let patch: string;
      try {
        patch = git(temp, [
          "diff",
          "--no-index",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--diff-algorithm=histogram",
          "--unified=4",
          "--",
          "before",
          "after",
        ]).toString();
      } catch (e: any) {
        if (e.status !== 1) throw e;
        patch = e.stdout.toString();
      }
      const file = parsePatch(patch, path, status);
      files.push({
        ...file,
        ...(before.mode !== after.mode
          ? { changeSummary: `Mode ${before.mode} → ${after.mode}` }
          : {}),
        fingerprint: hash([path, shownBefore, after]),
        changedSinceReview: !!checkpoint?.viewed && checkpoint.evidence?.key !== key,
      });
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  return {
    id: randomUUID(),
    comparison,
    created: Date.now(),
    ...resolved,
    label: view === "since" ? `${resolved.label} · since reviewed` : resolved.label,
    data: {
      repository: basename(root),
      repositoryId: repo.id,
      branch: repo.branch,
      files,
    },
    evidence,
  };
}
