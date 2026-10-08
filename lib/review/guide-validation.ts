import { z } from "zod";
import type { Point, Side } from "../comments/model";
import type { Snapshot } from "./types";
import type { GuideBundle, GuideInterval, GuideTarget, ResolvedGuideTarget } from "./guide";
import { guideInventory, unionGuideIntervals } from "./guide-coverage";
import { inspectGuideMarkdown } from "./guide-markdown";
import { checkGuideDiagram } from "./guide-diagram-policy";

/** Resource bounds apply to both draft reads and authoritative publication. */
export const GUIDE_LIMITS = {
  manifestBytes: 1024 * 1024,
  documentBytes: 256 * 1024,
  bundleBytes: 4 * 1024 * 1024,
  // Resolved original coordinates are stored inline with the authored bundle.
  artifactBytes: 16 * 1024 * 1024,
  chunks: 100,
  targets: 10000,
  pathLength: 1000,
} as const;
const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export function safeGuideContentPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= GUIDE_LIMITS.pathLength &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.startsWith("/") &&
    !/^[a-zA-Z]:/.test(path) &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}
const contentPath = z
  .string()
  .refine(safeGuideContentPath, "Content path must stay within the bundle root");
const path = z.string().min(1).max(GUIDE_LIMITS.pathLength);
const target = z.discriminatedUnion("kind", [
  z.object({ id: identifier, kind: z.literal("file"), path }).strict(),
  z
    .object({
      id: identifier,
      kind: z.literal("range"),
      path,
      side: z.enum(["old", "new"]),
      start: z.number().int().positive().safe(),
      end: z.number().int().positive().safe(),
    })
    .strict(),
]);
export const guideManifestSchema = z
  .object({
    schema: z.literal(1),
    snapshotId: identifier,
    chunks: z
      .array(
        z
          .object({
            id: identifier,
            title: z
              .string()
              .min(1)
              .max(300)
              .refine((title) => title.trim().length > 0, "Chunk title must not be empty"),
            kind: z.literal("remaining").optional(),
            content: contentPath,
            targets: z.array(target).min(1).max(GUIDE_LIMITS.targets),
          })
          .strict(),
      )
      .min(1)
      .max(GUIDE_LIMITS.chunks),
  })
  .strict();
const bundleSchema = z
  .object({ manifest: guideManifestSchema, documents: z.record(z.string()) })
  .strict();
export type GuideSourceBounds = Record<string, { old: number | null; new: number | null }>;
export type GuideDiagnostic = {
  code: string;
  message: string;
  path?: string;
  side?: Side;
  start?: number;
  end?: number;
  marker?: string;
  chunkId?: string;
  targetId?: string;
};
export type GuideValidation = {
  valid: boolean;
  snapshotId: string;
  errors: GuideDiagnostic[];
  resolvedTargets: Record<string, ResolvedGuideTarget>;
};

function missingIntervals(required: GuideInterval[], assigned: GuideInterval[]): GuideInterval[] {
  const union = unionGuideIntervals(assigned);
  const missing: GuideInterval[] = [];
  for (const interval of required) {
    let start = interval.start;
    for (const covered of union) {
      if (covered.end < start) continue;
      if (covered.start > interval.end) break;
      if (covered.start > start) missing.push({ start, end: covered.start - 1 });
      start = Math.max(start, covered.end + 1);
      if (start > interval.end) break;
    }
    if (start <= interval.end) missing.push({ start, end: interval.end });
  }
  return missing;
}

/** Resolve original source coordinates without word-diff preparation or per-line storage. */
function resolveTarget(
  snapshot: Snapshot,
  fileIndex: number,
  target: GuideTarget,
): ResolvedGuideTarget {
  const file = snapshot.data.files[fileIndex];
  const evidence = snapshot.evidence[file.path];
  const ranges: ResolvedGuideTarget["ranges"] = [];
  for (const side of ["old", "new"] as const) {
    if (target.kind === "range" && target.side !== side) continue;
    for (const [hunkIndex, hunk] of file.hunks.entries()) {
      let oldLine = hunk.oldStart;
      let newLine = hunk.newStart;
      let source = 0;
      let first: Point | undefined;
      let last: Point | undefined;
      for (const row of hunk.lines) {
        if (row.startsWith("\\")) continue;
        const number = side === "old" ? oldLine : newLine;
        const present = side === "old" ? !row.startsWith("+") : !row.startsWith("-");
        if (
          present &&
          (target.kind === "file" || (number >= target.start && number <= target.end))
        ) {
          const point = { hunk: hunkIndex, source, line: number, text: row.slice(1) };
          first ||= point;
          last = point;
        }
        if (!row.startsWith("+")) oldLine++;
        if (!row.startsWith("-")) newLine++;
        source++;
      }
      if (first && last) ranges.push({ side, start: first, end: last });
    }
  }
  return {
    target,
    fileIndex,
    fingerprint: file.fingerprint || evidence.key,
    sourceObjects: { old: evidence.before.object, new: evidence.after.object },
    ranges,
  };
}

/** One pure validator for CLI diagnostics, import and lazy artifact verification. */
export function validateGuideBundle(
  value: unknown,
  snapshot: Snapshot,
  bounds: GuideSourceBounds,
): GuideValidation {
  const errors: GuideDiagnostic[] = [];
  const result: GuideValidation = {
    valid: false,
    snapshotId: snapshot.id,
    errors,
    resolvedTargets: Object.create(null),
  };
  const parsed = bundleSchema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      errors.push({ code: "INVALID_SCHEMA", message: `${issue.path.join(".")}: ${issue.message}` });
    return result;
  }
  const bundle: GuideBundle = parsed.data;
  if (snapshot.captureView !== "full")
    errors.push({
      code: "INVALID_CAPTURE_VIEW",
      message: "Publication requires explicit full capture provenance. Recapture the comparison.",
    });
  if (bundle.manifest.snapshotId !== snapshot.id)
    errors.push({
      code: "SNAPSHOT_MISMATCH",
      message: "Guide snapshot does not match the saved comparison",
    });
  let inventory;
  try {
    inventory = guideInventory(snapshot);
  } catch (error) {
    errors.push({ code: "INVALID_SNAPSHOT", message: (error as Error).message });
    return result;
  }
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  let totalBytes = bytes(JSON.stringify(bundle.manifest));
  if (totalBytes > GUIDE_LIMITS.manifestBytes)
    errors.push({ code: "RESOURCE_LIMIT", message: "Manifest exceeds the byte limit" });
  for (const [name, document] of Object.entries(bundle.documents)) {
    const size = bytes(document);
    totalBytes += size;
    if (!safeGuideContentPath(name) || size > GUIDE_LIMITS.documentBytes)
      errors.push({
        code: "RESOURCE_LIMIT",
        message: `Invalid document path or oversized document: ${name}`,
      });
    if (document.includes("\0"))
      errors.push({
        code: "INVALID_CONTENT",
        message: `Explanation contains binary content: ${name}`,
      });
  }
  if (totalBytes > GUIDE_LIMITS.bundleBytes)
    errors.push({ code: "RESOURCE_LIMIT", message: "Bundle exceeds the total byte limit" });
  const targetCount = bundle.manifest.chunks.reduce(
    (count, chunk) => count + chunk.targets.length,
    0,
  );
  if (targetCount > GUIDE_LIMITS.targets)
    errors.push({ code: "RESOURCE_LIMIT", message: "Guide exceeds the total target count limit" });
  if (errors.some((error) => error.code === "RESOURCE_LIMIT" || error.code === "INVALID_CONTENT"))
    return result;
  const chunks = new Set<string>();
  const targets = new Map<string, GuideTarget>();
  const assigned = new Map<string, { file: boolean; old: GuideInterval[]; new: GuideInterval[] }>();
  for (const [index, chunk] of bundle.manifest.chunks.entries()) {
    if (chunks.has(chunk.id))
      errors.push({
        code: "DUPLICATE_CHUNK",
        message: `Duplicate chunk ${chunk.id}`,
        chunkId: chunk.id,
      });
    chunks.add(chunk.id);
    if (chunk.kind === "remaining" && index !== bundle.manifest.chunks.length - 1)
      errors.push({
        code: "REMAINING_NOT_LAST",
        message: "Remaining changes must be the final chunk",
        chunkId: chunk.id,
      });
    const document = Object.hasOwn(bundle.documents, chunk.content)
      ? bundle.documents[chunk.content]
      : "";
    if (!document?.trim())
      errors.push({
        code: "EMPTY_CONTENT",
        message: `Missing or empty explanation: ${chunk.content}`,
        chunkId: chunk.id,
      });
    for (const reference of chunk.targets) {
      if (targets.has(reference.id))
        errors.push({
          code: "DUPLICATE_TARGET",
          message: `Duplicate target ${reference.id}`,
          targetId: reference.id,
        });
      targets.set(reference.id, reference);
      const file = inventory.files.find((file) => file.path === reference.path);
      if (!file) {
        errors.push({
          code: "UNKNOWN_PATH",
          message: "Target path is not in the snapshot",
          path: reference.path,
          targetId: reference.id,
        });
        continue;
      }
      if (reference.kind === "range") {
        const count = bounds[reference.path]?.[reference.side];
        if (count == null || reference.end < reference.start || reference.end > count) {
          errors.push({
            code: "INVALID_RANGE",
            message: "Range endpoints must exist on the captured side",
            path: reference.path,
            side: reference.side,
            start: reference.start,
            end: reference.end,
            targetId: reference.id,
          });
          continue;
        }
      }
      const coverage = assigned.get(reference.path) || { file: false, old: [], new: [] };
      if (reference.kind === "file") coverage.file = true;
      else coverage[reference.side].push({ start: reference.start, end: reference.end });
      assigned.set(reference.path, coverage);
      result.resolvedTargets[reference.id] = resolveTarget(snapshot, file.fileIndex, reference);
    }
  }
  const documents = new Set(bundle.manifest.chunks.map((chunk) => chunk.content));
  for (const name of Object.keys(bundle.documents)) {
    if (!documents.has(name))
      errors.push({ code: "UNUSED_DOCUMENT", message: `Document is not referenced: ${name}` });
  }
  for (const chunk of bundle.manifest.chunks) {
    const linked = new Set<string>();
    const markdown = Object.hasOwn(bundle.documents, chunk.content)
      ? bundle.documents[chunk.content]
      : "";
    const explanation = inspectGuideMarkdown(markdown);
    for (const diagram of explanation.diagrams) {
      const policy = checkGuideDiagram(diagram);
      if (!policy.valid) {
        errors.push({
          code: "UNSAFE_DIAGRAM",
          message: policy.reason,
          chunkId: chunk.id,
        });
      }
    }
    for (const id of explanation.targetLinks) {
      if (!targets.has(id))
        errors.push({
          code: "BROKEN_TARGET_LINK",
          message: `Unknown internal target link: ${id}`,
          chunkId: chunk.id,
        });
      else linked.add(id);
    }
    for (const reference of chunk.targets) {
      if (!linked.has(reference.id))
        errors.push({
          code: "UNEXPLAINED_TARGET",
          message: `Explanation must link target ${reference.id}`,
          chunkId: chunk.id,
          targetId: reference.id,
        });
    }
  }
  for (const file of inventory.files) {
    const coverage = assigned.get(file.path);
    if (!coverage)
      errors.push({
        code: "UNASSIGNED_FILE",
        message: "Captured file has no explicit assignment",
        path: file.path,
      });
    if (coverage?.file) continue;
    for (const side of ["old", "new"] as const) {
      for (const interval of missingIntervals(file[side], coverage?.[side] || []))
        errors.push({
          code: "UNASSIGNED_CHANGE",
          message: "Captured changed lines are unassigned",
          path: file.path,
          side,
          ...interval,
        });
    }
    for (const marker of file.markers)
      errors.push({
        code: "UNASSIGNED_MARKER",
        message: "File-level changes require a whole-file target",
        path: file.path,
        marker,
      });
  }
  result.valid = errors.length === 0;
  return result;
}
