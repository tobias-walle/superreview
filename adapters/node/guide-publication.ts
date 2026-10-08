import { createHash } from "node:crypto";
import type { Author } from "../../lib/comments/model";
import type { GuideBundle } from "../../lib/review/guide";
import type { GuideSourceBounds } from "../../lib/review/guide-validation";
import type { JsonlStore } from "./jsonl-store";
import { readCapturedGuideSource } from "./guide-inspection";

export function guideAuthor(name: string): Author {
  const clean = name.trim();
  if (!clean || clean.length > 200)
    throw new Error("Agent author must contain 1 to 200 characters");
  return {
    id: `agent-${createHash("sha256").update(clean).digest("hex").slice(0, 16)}`,
    name: clean,
    kind: "agent",
  };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonical(record[key])]),
    );
  }
  return value;
}
export function guideHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export async function guideValidationInput(store: JsonlStore, bundle: GuideBundle) {
  const snapshot = await store.snapshot(bundle.manifest.snapshotId);
  const bounds: GuideSourceBounds = Object.create(null);
  // Bounds do not run inventory rules. Both callers receive the same pure
  // diagnostics for legacy, projected or incomplete snapshot evidence.
  for (const [path, evidence] of Object.entries(snapshot.evidence)) {
    const [old, next] = await Promise.all([
      readCapturedGuideSource(store, evidence.before),
      readCapturedGuideSource(store, evidence.after),
    ]);
    bounds[path] = { old: old.lineCount, new: next.lineCount };
  }
  return { snapshot, bounds };
}
