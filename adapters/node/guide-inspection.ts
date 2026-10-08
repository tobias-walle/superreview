import type { CapturedGuideSource, GuideInspection } from "../../lib/review/guide";
import { guideInventory } from "../../lib/review/guide-coverage";
import type { FileVersion } from "../../lib/review/types";
import type { JsonlStore } from "./jsonl-store";

export async function readCapturedGuideSource(
  store: JsonlStore,
  version: FileVersion,
): Promise<CapturedGuideSource> {
  if (version.object === null) return { ...version, encoding: "utf8", content: null, lineCount: 0 };
  const bytes = await store.readObject(version.object);
  const text = bytes.toString("utf8");
  // Binary and non-UTF8 objects are exported losslessly, never as replacement characters.
  const binary = bytes.includes(0) || !Buffer.from(text, "utf8").equals(bytes);
  return {
    ...version,
    encoding: binary ? "base64" : "utf8",
    content: binary ? bytes.toString("base64") : text,
    lineCount: binary
      ? null
      : text === ""
        ? 0
        : text.split("\n").length - (text.endsWith("\n") ? 1 : 0),
  };
}

/** Read only. No lock, recovery, capture, live Git diff or filesystem source fallback. */
export async function inspectGuideSnapshot(
  store: JsonlStore,
  snapshotId: string,
): Promise<GuideInspection> {
  const snapshot = await store.snapshot(snapshotId);
  const inventory = guideInventory(snapshot);
  const sources: GuideInspection["sources"] = [];
  // Keep source reads sequential across files so large snapshots don't schedule
  // unbounded simultaneous object reads. Only the two sides of one file overlap.
  for (const file of inventory.files) {
    const [old, next] = await Promise.all([
      readCapturedGuideSource(store, file.evidence.before),
      readCapturedGuideSource(store, file.evidence.after),
    ]);
    sources.push({ path: file.path, old, new: next });
  }
  return {
    reviewId: store.id,
    snapshotId: snapshot.id,
    captureView: snapshot.captureView ?? null,
    comparison: snapshot.comparison ?? null,
    snapshot,
    inventory,
    sources,
  };
}
