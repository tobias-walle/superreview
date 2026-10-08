import { mkdir, readFile, writeFile, rename, open, rm, readdir, link } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import type { Command, Event, ReviewIdentity, ReviewState, Snapshot } from "../../lib/review/types";
import { comparePoints, type Anchor, type Draft, type Point } from "../../lib/comments/model";
import { renderHunk } from "../../lib/diff/render";
import { decide, emptyReview, evolve } from "../../lib/review/core";
import type { GuideBundle, GuideDescriptor, PublishedGuide } from "../../lib/review/guide";
import {
  GUIDE_LIMITS,
  guideManifestSchema,
  validateGuideBundle,
} from "../../lib/review/guide-validation";
import { guideAuthor, guideHash, guideValidationInput } from "./guide-publication";

function validatePoint(snapshot: Snapshot, anchor: Anchor, point: Point) {
  const file = snapshot.data.files.find((entry) => entry.path === anchor.path);
  const line = file?.hunks[point.hunk] && renderHunk(file.hunks[point.hunk]).unified[point.source];
  const number = anchor.side === "old" ? line?.oldNo : line?.newNo;
  if (!line || number !== point.line || line.text !== point.text)
    throw new Error("Comment line is not in its snapshot");
}
function validateAnchor(snapshot: Snapshot, anchor: Anchor) {
  const file = snapshot.data.files.find((entry) => entry.path === anchor.path);
  if (!file) throw new Error("Comment file is not in its snapshot");
  if (file.fingerprint !== anchor.fingerprint)
    throw new Error("Comment file does not match its snapshot");
  if (anchor.kind === "file") return;
  validatePoint(snapshot, anchor, anchor.start);
  validatePoint(snapshot, anchor, anchor.end);
  if (comparePoints(anchor.start, anchor.end) > 0) throw new Error("Comment range is not ordered");
}

const safeId = (id: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid storage identifier");
  return id;
};
export async function atomicJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
}
async function writeImmutable(path: string, content: string | Buffer) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
}
/** One writer owns the repository lock; no concurrent unsynchronised appends. */
export async function lockRepository(root: string): Promise<() => Promise<void>> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, "writer.lock");
  try {
    await mkdir(path);
  } catch {
    let pid: number;
    try {
      pid = Number(await readFile(join(path, "pid"), "utf8"));
    } catch {
      throw new Error("Review store is locked. Check for another superreview process.");
    }
    try {
      process.kill(pid, 0);
      throw new Error(
        "Superreview is already running for this repository. Stop that process first.",
      );
    } catch (error: any) {
      if (error.code !== "ESRCH") throw error;
    }
    await rm(path, { recursive: true });
    await mkdir(path);
  }
  await writeFile(join(path, "pid"), String(process.pid));
  return () => rm(path, { recursive: true, force: true });
}
export class JsonlStore {
  readonly directory: string;
  state!: ReviewState;
  private ids = new Set<string>();
  private publications = new Map<string, GuideDescriptor>();
  constructor(
    readonly root: string,
    readonly id: string,
  ) {
    this.directory = join(root, "reviews", safeId(id));
  }
  async create(identity: ReviewIdentity) {
    await mkdir(join(this.directory, "snapshots"), { recursive: true });
    await atomicJson(join(this.directory, "review.json"), identity);
    await writeFile(join(this.directory, "events.jsonl"), "", {
      flag: "wx",
      mode: 0o600,
    });
    this.state = emptyReview(identity);
  }
  async load(recover = false) {
    const identity = JSON.parse(await readFile(join(this.directory, "review.json"), "utf8"));
    if (identity.schema !== 1) throw new Error("Unsupported review schema");
    let raw = await readFile(join(this.directory, "events.jsonl"), "utf8");
    if (raw && !raw.endsWith("\n")) {
      if (!recover) throw new Error("Incomplete final event; open the review to recover it.");
      const end = raw.lastIndexOf("\n") + 1;
      // Keep the interrupted write for diagnosis. Never discard a corrupt middle line.
      await writeFile(join(this.directory, `interrupted-${Date.now()}.jsonl`), raw.slice(end), {
        mode: 0o600,
      });
      await writeFile(join(this.directory, "events.jsonl"), raw.slice(0, end));
      raw = raw.slice(0, end);
    }
    let state = emptyReview(identity);
    this.ids.clear();
    this.publications.clear();
    for (const line of raw.split("\n").filter(Boolean)) {
      const event = JSON.parse(line) as Event;
      if (!event.id || this.ids.has(event.id)) throw new Error("Duplicate or missing event ID");
      state = evolve(state, event);
      this.ids.add(event.id);
      if (event.type === "guide-published") this.publications.set(event.id, event.guide);
    }
    this.state = state;
    return state;
  }
  async append(event: Event) {
    const next = evolve(this.state, event);
    const file = await open(join(this.directory, "events.jsonl"), "a", 0o600);
    try {
      await file.writeFile(JSON.stringify(event) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    this.ids.add(event.id);
    if (event.type === "guide-published") this.publications.set(event.id, event.guide);
    this.state = next;
    return next;
  }
  async execute(command: Command, sequence: number, id: string) {
    if (this.ids.has(id)) return this.state; // Retry after an uncertain network response.
    if (sequence !== this.state.sequence)
      throw Object.assign(new Error("The review changed in another tab. Reload and try again."), {
        status: 409,
      });
    const snapshot = this.state.snapshotId ? await this.snapshot(this.state.snapshotId) : undefined;
    if (command.type === "thread") {
      if (!snapshot) throw new Error("Capture a snapshot before commenting.");
      const anchor = command.thread.anchor;
      const original = await this.snapshot(anchor.snapshotId || snapshot.id);
      validateAnchor(original, anchor);
      const existing = this.state.threads.find((t) => t.id === command.thread.id);
      if (existing && JSON.stringify(existing.anchor) !== JSON.stringify(anchor))
        throw new Error("A thread anchor cannot be changed");
    }
    if (command.type === "checkpoint") {
      if (!snapshot) throw new Error("Capture a snapshot before marking files.");
      const cp = command.checkpoint;
      if (
        cp.snapshotId !== snapshot.id ||
        !snapshot.data.files.some((f) => f.path === cp.path && f.fingerprint === cp.fingerprint)
      )
        throw new Error("The file changed. Refresh before marking it viewed.");
      cp.evidence = snapshot.evidence[cp.path];
    }
    return this.append(decide(this.state, command, snapshot, id, Date.now()));
  }
  /** Called only under the repository lock or server write queue. Publication is
   * deliberately not a UI command, and authored data never supplies provenance. */
  async importGuide(bundle: GuideBundle, sequence: number, requestId: string, authorName: string) {
    if (!requestId || requestId.length > 100) throw new Error("Invalid request ID");
    const exactBundle = structuredClone(bundle);
    const author = guideAuthor(authorName);
    const requestHash = guideHash({ bundle: exactBundle, author });
    if (this.ids.has(requestId)) {
      const previous = this.publications.get(requestId);
      if (!previous || previous.requestHash !== requestHash)
        throw Object.assign(new Error("Request ID was already used with different content"), {
          status: 409,
        });
      await this.guide(previous.id);
      return { state: this.state, guide: previous, requestId };
    }
    if (sequence !== this.state.sequence)
      throw Object.assign(new Error("The review changed. Reload and try again."), { status: 409 });
    if (this.state.archived) throw new Error("Archived reviews are read-only");
    guideManifestSchema.parse(exactBundle.manifest);
    const { snapshot, bounds } = await guideValidationInput(this, exactBundle);
    const validation = validateGuideBundle(exactBundle, snapshot, bounds);
    if (!validation.valid)
      throw Object.assign(new Error("Guide validation failed"), { diagnostics: validation.errors });
    const payload = {
      id: randomUUID(),
      snapshotId: snapshot.id,
      created: Date.now(),
      author,
      requestHash,
      snapshotHash: guideHash(snapshot),
      chunkIds: exactBundle.manifest.chunks.map((chunk) => chunk.id),
      bundle: exactBundle,
      resolvedTargets: validation.resolvedTargets,
    };
    const artifactHash = guideHash(payload);
    const artifact: PublishedGuide = { ...payload, artifactHash };
    const artifactText = JSON.stringify(artifact);
    if (Buffer.byteLength(artifactText) > GUIDE_LIMITS.artifactBytes)
      throw new Error("Resolved guide artifact exceeds byte limit");
    const descriptor: GuideDescriptor = {
      id: payload.id,
      snapshotId: payload.snapshotId,
      created: payload.created,
      author,
      artifactHash,
      requestHash,
      snapshotHash: payload.snapshotHash,
      chunkIds: payload.chunkIds,
    };
    const directory = join(this.directory, "guides");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const parent = await open(this.directory, "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    const destination = join(directory, safeId(payload.id) + ".json");
    const temp = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeImmutable(temp, artifactText);
      // Atomic no-replace installation. A crash may leave an unreferenced artifact,
      // never an event pointing to a partially written one.
      await link(temp, destination);
      const handle = await open(directory, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } finally {
      await rm(temp, { force: true });
    }
    const state = await this.append({
      schema: 1,
      id: requestId,
      sequence: this.state.sequence + 1,
      created: payload.created,
      type: "guide-published",
      guide: descriptor,
    });
    return { state, guide: descriptor, requestId };
  }
  async guide(id: string): Promise<PublishedGuide> {
    const descriptor = this.state.guides.find((guide) => guide.id === id);
    if (!descriptor) throw new Error("Guide revision is not published in this review");
    const path = join(this.directory, "guides", safeId(id) + ".json");
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let artifact: PublishedGuide;
    try {
      const artifactLimit = GUIDE_LIMITS.artifactBytes;
      const info = await file.stat();
      if (!info.isFile()) throw new Error("Guide artifact is not a regular file");
      if (info.size > artifactLimit) throw new Error("Guide artifact exceeds byte limit");
      const buffer = Buffer.alloc(artifactLimit + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > artifactLimit) throw new Error("Guide artifact exceeds byte limit");
      const bytes = buffer.subarray(0, size);
      const text = bytes.toString("utf8");
      if (!Buffer.from(text).equals(bytes))
        throw new Error("Published guide artifact is not UTF-8");
      artifact = JSON.parse(text);
    } finally {
      await file.close();
    }
    const { artifactHash, ...payload } = artifact;
    if (artifactHash !== descriptor.artifactHash || guideHash(payload) !== artifactHash)
      throw new Error("Published guide artifact is damaged");
    const actualDescriptor = {
      id: artifact.id,
      snapshotId: artifact.snapshotId,
      created: artifact.created,
      author: artifact.author,
      artifactHash,
      requestHash: artifact.requestHash,
      snapshotHash: artifact.snapshotHash,
      chunkIds: artifact.chunkIds,
    };
    if (guideHash(actualDescriptor) !== guideHash(descriptor))
      throw new Error("Published guide descriptor does not match its artifact");
    if (guideHash({ bundle: artifact.bundle, author: artifact.author }) !== descriptor.requestHash)
      throw new Error("Published guide request identity does not match its artifact");
    const { snapshot, bounds } = await guideValidationInput(this, artifact.bundle);
    if (snapshot.id !== descriptor.snapshotId || guideHash(snapshot) !== descriptor.snapshotHash)
      throw new Error(
        "Published guide snapshot evidence no longer matches its immutable references",
      );
    const validation = validateGuideBundle(artifact.bundle, snapshot, bounds);
    if (
      !validation.valid ||
      guideHash(validation.resolvedTargets) !== guideHash(artifact.resolvedTargets)
    )
      throw new Error("Published guide references no longer match its immutable snapshot");
    return artifact;
  }
  async capture(snapshot: Snapshot) {
    await writeImmutable(
      join(this.directory, "snapshots", safeId(snapshot.id) + ".json"),
      JSON.stringify(snapshot),
    );
    await this.append({
      schema: 1,
      id: randomUUID(),
      sequence: this.state.sequence + 1,
      created: Date.now(),
      type: "snapshot",
      snapshotId: snapshot.id,
    });
  }
  async snapshot(id: string): Promise<Snapshot> {
    return JSON.parse(
      await readFile(join(this.directory, "snapshots", safeId(id) + ".json"), "utf8"),
    );
  }
  async draftState(): Promise<{ drafts: Draft[]; revision: number }> {
    try {
      const saved = JSON.parse(await readFile(join(this.directory, "drafts.json"), "utf8"));
      return Array.isArray(saved) ? { drafts: saved, revision: 0 } : saved;
    } catch (e: any) {
      if (e.code === "ENOENT") return { drafts: [], revision: 0 };
      throw e;
    }
  }
  async saveDrafts(drafts: Draft[], revision: number) {
    const saved = await this.draftState();
    if (saved.revision !== revision)
      throw Object.assign(
        new Error("Drafts changed in another tab. Copy your unsaved text before reloading."),
        { status: 409 },
      );
    await atomicJson(join(this.directory, "drafts.json"), {
      drafts,
      revision: revision + 1,
    });
    return revision + 1;
  }
  async object(content: Buffer): Promise<string> {
    const hash = createHash("sha256").update(content).digest("hex");
    await mkdir(join(this.root, "objects"), { recursive: true });
    try {
      await writeImmutable(join(this.root, "objects", hash), content);
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
    }
    return hash;
  }
  async readObject(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid object hash");
    const content = await readFile(join(this.root, "objects", hash));
    if (createHash("sha256").update(content).digest("hex") !== hash)
      throw new Error("Stored content object is damaged");
    return content;
  }
}
export async function listReviews(root: string, recover = false) {
  let entries: string[];
  try {
    entries = await readdir(join(root, "reviews"));
  } catch (e: any) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  return Promise.all(
    entries.map(async (id) => {
      const store = new JsonlStore(root, id);
      return store.load(recover);
    }),
  );
}
