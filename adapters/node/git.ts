import { execFile, execFileSync } from "node:child_process";
import { lstat, readFile, readlink, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { parsePatch } from "../../lib/diff/parse.mjs";
import type { CaptureProgress, Evidence, FileVersion, Snapshot } from "../../lib/review/types";
import type { JsonlStore } from "./jsonl-store";

export type Comparison = { refs: string[]; cached: boolean; paths: string[] };
const GIT_BUFFER_BYTES = 512 * 1024 * 1024;
const PATH_BATCH_SIZE = 1000;
const OBJECT_BATCH_SIZE = 256;
const FILE_IO_CONCURRENCY = 16;
const OPAQUE_FILE_DIGITS = 8;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const missing: FileVersion = { object: null, mode: "000000" };
type CapturedVersion = { version: FileVersion; content: Buffer | null };
type GitEntry = { mode: string; oid: string };

export function git(root: string, args: string[], input?: Buffer): Buffer {
  return execFileSync("git", ["--literal-pathspecs", ...args], {
    cwd: root,
    input,
    maxBuffer: GIT_BUFFER_BYTES,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
function gitAsync(root: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["--literal-pathspecs", ...args],
      { cwd: root, maxBuffer: GIT_BUFFER_BYTES, encoding: "buffer" },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        Object.assign(error, { status: error.code, stdout, stderr });
        reject(error);
      },
    );
    if (input) child.stdin?.end(input);
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
async function captureRepository(root: string) {
  const common = resolve(
    root,
    (await gitAsync(root, ["rev-parse", "--git-common-dir"])).toString().trim(),
  );
  let branch: string;
  try {
    branch = (await gitAsync(root, ["symbolic-ref", "--short", "HEAD"])).toString().trim();
  } catch {
    branch = (await gitAsync(root, ["rev-parse", "--short", "HEAD"])).toString().trim();
  }
  return { common, branch, id: hash(common) };
}
async function captureCommit(root: string, ref: string) {
  if (!ref || ref.startsWith("-")) throw new Error("Invalid Git revision");
  try {
    return (await gitAsync(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]))
      .toString()
      .trim();
  } catch {
    throw new Error(`Cannot resolve Git revision: ${ref}`);
  }
}
async function resolveCaptureComparison(root: string, comparison: Comparison) {
  const { refs, cached } = comparison;
  if (refs.length > 2) throw new Error("Use one revision, two revisions, or A..B / A...B.");
  let base: string,
    target = cached ? "index" : "working-tree";
  let label = cached ? "Staged changes" : "Local changes";
  if (!refs.length) {
    try {
      base = await captureCommit(root, "HEAD");
    } catch {
      base = (await gitAsync(root, ["hash-object", "-t", "tree", "--stdin"], Buffer.alloc(0)))
        .toString()
        .trim();
    }
  } else if (refs.length === 2 || refs[0].includes("..")) {
    if (cached) throw new Error("--cached accepts at most one base revision.");
    const triple = refs.length === 1 && refs[0].includes("...");
    const pair = refs.length === 2 ? refs : refs[0].split(triple ? "..." : "..");
    if (pair.length !== 2) throw new Error("Invalid comparison range");
    base = await captureCommit(root, pair[0] || "HEAD");
    target = await captureCommit(root, pair[1] || "HEAD");
    if (triple) base = (await gitAsync(root, ["merge-base", base, target])).toString().trim();
    label = refs.join(" → ");
  } else {
    base = await captureCommit(root, refs[0]);
    label = `${refs[0]} → ${cached ? "index" : "working tree"}`;
  }
  return { base, target, label };
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}
async function mapLimit<T, R>(
  values: T[],
  limit: number,
  fn: (value: T, index: number) => Promise<R>,
) {
  const result = Array.from<R>({ length: values.length });
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= values.length) return;
        result[index] = await fn(values[index], index);
      }
    }),
  );
  return result;
}
function parseEntry(raw: string, index: boolean) {
  const tab = raw.indexOf("\t");
  if (tab < 0) throw new Error("Invalid Git tree entry");
  const header = raw.slice(0, tab).split(" ");
  const path = raw.slice(tab + 1);
  if (index) return { path, mode: header[0], oid: header[1], stage: header[2] };
  return { path, mode: header[0], oid: header[2], stage: "0" };
}
async function metadataForRef(root: string, ref: string, paths: string[]) {
  const entries = new Map<string, GitEntry>();
  for (const batch of chunks(paths, PATH_BATCH_SIZE)) {
    const args =
      ref === "index"
        ? ["ls-files", "--stage", "-z", "--", ...batch]
        : ["ls-tree", "-z", ref, "--", ...batch];
    const records = (await gitAsync(root, args)).toString().split("\0").filter(Boolean);
    for (const raw of records) {
      const entry = parseEntry(raw, ref === "index");
      if (ref === "index" && (entry.stage !== "0" || entries.has(entry.path)))
        throw new Error(
          `Resolve the merge conflict in ${entry.path} before capturing staged changes.`,
        );
      entries.set(entry.path, { mode: entry.mode, oid: entry.oid });
    }
  }
  return entries;
}
async function readObjectBatch(root: string, oids: string[]) {
  const contents = new Map<string, Buffer>();
  for (const batch of chunks([...new Set(oids)], OBJECT_BATCH_SIZE)) {
    if (!batch.length) continue;
    const output = await gitAsync(
      root,
      ["cat-file", "--batch"],
      Buffer.from(batch.join("\n") + "\n"),
    );
    let offset = 0;
    for (const requested of batch) {
      const newline = output.indexOf(10, offset);
      if (newline < 0) throw new Error("Invalid Git object response");
      const header = output.subarray(offset, newline).toString();
      if (header.endsWith(" missing")) throw new Error(`Missing Git object: ${requested}`);
      const parts = header.split(" ");
      const size = Number(parts.at(-1));
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid Git object size");
      const start = newline + 1,
        end = start + size;
      if (end >= output.length || output[end] !== 10)
        throw new Error("Truncated Git object response");
      contents.set(requested, Buffer.from(output.subarray(start, end)));
      offset = end + 1;
    }
  }
  return contents;
}
async function storedVersion(
  store: JsonlStore,
  mode: string,
  content: Buffer,
): Promise<CapturedVersion> {
  return { version: { object: await store.object(content), mode }, content };
}
async function capturedRefVersions(root: string, ref: string, paths: string[], store: JsonlStore) {
  const entries = await metadataForRef(root, ref, paths);
  const blobs = await readObjectBatch(
    root,
    [...entries.values()]
      .filter((entry) => entry.mode !== "040000" && entry.mode !== "160000")
      .map((entry) => entry.oid),
  );
  const captured = await mapLimit(paths, FILE_IO_CONCURRENCY, async (path) => {
    const entry = entries.get(path);
    if (!entry || entry.mode === "040000")
      return [path, { version: missing, content: null }] as const;
    const content = entry.mode === "160000" ? Buffer.from(entry.oid) : blobs.get(entry.oid);
    if (!content) throw new Error(`Missing content for ${path}`);
    return [path, await storedVersion(store, entry.mode, content)] as const;
  });
  return new Map(captured);
}
async function capturedWorkingVersion(root: string, path: string, store: JsonlStore) {
  try {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = await lstat(join(root, ...parts.slice(0, i)));
      if (parent.isSymbolicLink() || !parent.isDirectory())
        return { version: missing, content: null };
    }
    const target = join(root, path);
    const stat = await lstat(target);
    if (stat.isSymbolicLink())
      return storedVersion(store, "120000", Buffer.from(await readlink(target)));
    if (stat.isDirectory()) {
      const oid = (await gitAsync(target, ["rev-parse", "HEAD"])).toString().trim();
      return storedVersion(store, "160000", Buffer.from(oid));
    }
    return storedVersion(store, stat.mode & 0o111 ? "100755" : "100644", await readFile(target));
  } catch (error: any) {
    if (error.code === "ENOENT") return { version: missing, content: null };
    throw error;
  }
}
async function capturedVersions(root: string, ref: string, paths: string[], store: JsonlStore) {
  if (ref !== "working-tree") return capturedRefVersions(root, ref, paths, store);
  const captured = await mapLimit(
    paths,
    FILE_IO_CONCURRENCY,
    async (path) => [path, await capturedWorkingVersion(root, path, store)] as const,
  );
  return new Map(captured);
}
function splitDirectoryPatch(patch: string) {
  const sections = new Map<number, string>();
  for (const section of patch.split(/(?=^diff --git )/m)) {
    if (!section.startsWith("diff --git ")) continue;
    const match = section.split("\n", 1)[0].match(/file-(\d{8})/);
    if (!match) throw new Error("Cannot identify captured diff file");
    sections.set(Number(match[1]), section);
  }
  return sections;
}

export async function capture(
  root: string,
  comparison: Comparison,
  store: JsonlStore,
  view: "full" | "since" = "full",
  onProgress?: (progress: CaptureProgress) => void,
): Promise<Snapshot> {
  onProgress?.({ phase: "discovering", completed: 0, total: 0 });
  const [repo, resolved] = await Promise.all([
    captureRepository(root),
    resolveCaptureComparison(root, comparison),
  ]);
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
  const raw = (await gitAsync(root, args)).toString().split("\0");
  const changed = new Map<string, string>();
  for (let i = 0; i < raw.length - 1; i += 2) changed.set(raw[i + 1], raw[i]);
  if (resolved.target === "working-tree") {
    for (const path of (
      await gitAsync(root, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ...comparison.paths,
      ])
    )
      .toString()
      .split("\0")
      .filter(Boolean))
      changed.set(path, "A");
  }
  const entries = [...changed].filter(
    ([path]) => path !== ".superreview" && !path.startsWith(".superreview/"),
  );
  for (const [path, status] of entries)
    if (status === "U") throw new Error(`Resolve the merge conflict in ${path} before reviewing.`);
  const paths = entries.map(([path]) => path);
  onProgress?.({ phase: "capturing", completed: 0, total: paths.length });
  const [beforeVersions, afterVersions] = await Promise.all([
    capturedVersions(root, resolved.base, paths, store),
    capturedVersions(root, resolved.target, paths, store),
  ]);
  const evidence: Record<string, Evidence> = {};
  let completed = 0;
  const pending: Array<{
    path: string;
    status: string;
    before: FileVersion;
    after: FileVersion;
    shownBefore: FileVersion;
    left: Buffer | null;
    right: Buffer | null;
    changedSinceReview: boolean;
  }> = [];
  for (const [path, status] of entries) {
    const beforeCaptured = beforeVersions.get(path)!,
      afterCaptured = afterVersions.get(path)!;
    const before = beforeCaptured.version,
      after = afterCaptured.version,
      key = hash([path, before, after]);
    evidence[path] = { before, after, key };
    const checkpoint = store.state.checkpoints[path];
    completed++;
    onProgress?.({ phase: "capturing", completed, total: paths.length });
    if (view === "since" && checkpoint?.viewed && checkpoint.evidence?.key === key) continue;
    const compatible =
      checkpoint?.viewed && JSON.stringify(checkpoint.evidence?.before) === JSON.stringify(before);
    const shownBefore = view === "since" && compatible ? checkpoint.evidence!.after : before;
    const left = shownBefore.object
      ? shownBefore.object === before.object
        ? beforeCaptured.content
        : await store.readObject(shownBefore.object)
      : null;
    pending.push({
      path,
      status,
      before,
      after,
      shownBefore,
      left,
      right: afterCaptured.content,
      changedSinceReview: !!checkpoint?.viewed && checkpoint.evidence?.key !== key,
    });
  }

  onProgress?.({ phase: "diffing", completed: 0, total: pending.length });
  const temp = await mkdtemp(join(tmpdir(), "superreview-diff-"));
  try {
    const beforeDirectory = join(temp, "before"),
      afterDirectory = join(temp, "after");
    await Promise.all([
      mkdir(beforeDirectory, { recursive: true }),
      mkdir(afterDirectory, { recursive: true }),
    ]);
    await mapLimit(pending, FILE_IO_CONCURRENCY, async (item, index) => {
      const name = `file-${String(index).padStart(OPAQUE_FILE_DIGITS, "0")}`;
      await Promise.all([
        item.left === null ? Promise.resolve() : writeFile(join(beforeDirectory, name), item.left),
        item.right === null ? Promise.resolve() : writeFile(join(afterDirectory, name), item.right),
      ]);
    });
    let patch = "";
    try {
      patch = (
        await gitAsync(temp, [
          "diff",
          "--no-index",
          "--no-renames",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--diff-algorithm=histogram",
          "--unified=4",
          "--",
          "before",
          "after",
        ])
      ).toString();
    } catch (error: any) {
      if (error.status !== 1) throw error;
      patch = error.stdout.toString();
    }
    const sections = splitDirectoryPatch(patch);
    const files = pending.map((item, index) => {
      const file = parsePatch(sections.get(index) || "", item.path, item.status);
      onProgress?.({ phase: "diffing", completed: index + 1, total: pending.length });
      return {
        ...file,
        ...(item.before.mode !== item.after.mode
          ? { changeSummary: `Mode ${item.before.mode} → ${item.after.mode}` }
          : {}),
        fingerprint: hash([item.path, item.shownBefore, item.after]),
        changedSinceReview: item.changedSinceReview,
      };
    });
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
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
