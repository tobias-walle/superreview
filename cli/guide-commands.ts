import { randomUUID } from "node:crypto";
import { JsonlStore, lockRepository } from "../adapters/node/jsonl-store";
import { readGuideBundle } from "../adapters/node/guide-bundle";
import { guideValidationInput } from "../adapters/node/guide-publication";
import { validateGuideBundle } from "../lib/review/guide-validation";
import type { GuideDescriptor } from "../lib/review/guide";
import type { ReviewState } from "../lib/review/types";
import { activeServer, serverRequest } from "./review-commands";
import { inspectGuideSnapshot } from "../adapters/node/guide-inspection";

export async function inspectGuide(options: {
  root: string;
  reviewId: string;
  snapshotId: string;
}) {
  const store = new JsonlStore(options.root, options.reviewId);
  await store.load(); // Never repair interrupted events through this read boundary.
  return inspectGuideSnapshot(store, options.snapshotId);
}

export async function validateGuide(options: {
  root: string;
  reviewId: string;
  directory: string;
}) {
  const bundle = await readGuideBundle(options.directory);
  const store = new JsonlStore(options.root, options.reviewId);
  await store.load();
  const { snapshot, bounds } = await guideValidationInput(store, bundle);
  return validateGuideBundle(bundle, snapshot, bounds);
}

type ImportResult = { state: ReviewState; guide: GuideDescriptor; requestId: string };
export async function importGuide(options: {
  root: string;
  reviewId: string;
  directory: string;
  authorName: string;
  expectedSequence: number;
  requestId?: string;
}): Promise<ImportResult> {
  if (!Number.isInteger(options.expectedSequence) || options.expectedSequence <= 0) {
    throw new Error("--expected-sequence is required for guide import");
  }
  // Read once before entering the boundary. The exact in-memory bundle is then
  // revalidated and stored under the queue/lock, never reread from authoring files.
  const bundle = await readGuideBundle(options.directory);
  const requestId = options.requestId || randomUUID();
  const active = await activeServer(options.root);
  if (active?.reviewId === options.reviewId) {
    try {
      return await serverRequest<ImportResult>(active.url, "guides/import", {
        bundle,
        id: requestId,
        authorName: options.authorName,
        sequence: options.expectedSequence,
      });
    } catch (error: any) {
      if (!String(error.cause?.code || error.message).includes("fetch failed")) throw error;
    }
  }
  const unlock = await lockRepository(options.root);
  try {
    const store = new JsonlStore(options.root, options.reviewId);
    await store.load(true);
    return await store.importGuide(bundle, options.expectedSequence, requestId, options.authorName);
  } finally {
    await unlock();
  }
}
