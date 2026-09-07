import { sha256 } from "@noble/hashes/sha2.js";
import { buildFileModel, createWordDiffBudget, BLOCK_ROWS, type ReviewFile } from "./render";

const PREPARATION_YIELD_INTERVAL = 8;
let models: Array<ReturnType<typeof buildFileModel> | undefined> = [];
let generation = 0;
const pendingBlocks = new Set<string>();

function fingerprint(file: ReviewFile) {
  if (file.fingerprint) return file.fingerprint;
  const digest = sha256(
    new TextEncoder().encode(JSON.stringify([file.path, file.status, file.binary, file.hunks])),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function rowsFor(key: string) {
  const [fileIndex, hunkIndex, mode, blockIndex] = key.split(":");
  const hunk = models[+fileIndex]?.hunks[+hunkIndex];
  const start = +blockIndex * BLOCK_ROWS,
    end = (+blockIndex + 1) * BLOCK_ROWS;
  return mode === "split"
    ? hunk?.split.slice(start, end)
    : hunk?.unified.slice(start, end).map((line) => [line]);
}
function sendBlocks(keys: string[]) {
  const ready: Array<[string, ReturnType<typeof rowsFor>]> = [];
  for (const key of keys) {
    const rows = rowsFor(key);
    if (rows) ready.push([key, rows]);
    else pendingBlocks.add(key);
  }
  if (ready.length) self.postMessage({ type: "blocks", blocks: ready });
}
function flushPending(fileIndex: number) {
  const prefix = `${fileIndex}:`;
  const keys = [...pendingBlocks].filter((key) => key.startsWith(prefix));
  keys.forEach((key) => pendingBlocks.delete(key));
  sendBlocks(keys);
}
const yieldToMessages = () => new Promise((resolve) => setTimeout(resolve, 0));

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    const current = ++generation;
    const started = performance.now();
    const files = data.files as ReviewFile[];
    const budget = createWordDiffBudget();
    models = Array.from({ length: files.length });
    pendingBlocks.clear();
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const model = buildFileModel(file, budget);
        model.metadata.fingerprint = fingerprint(file);
        models[index] = model;
        self.postMessage({
          type: "file-ready",
          index,
          metadata: model.metadata,
          preparationMs: Math.round(performance.now() - started),
        });
        flushPending(index);
        if (current !== generation) return;
        if ((index + 1) % PREPARATION_YIELD_INTERVAL === 0) await yieldToMessages();
        if (current !== generation) return;
      }
      self.postMessage({
        type: "ready",
        preparationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      self.postMessage({ type: "error", message: String(error) });
    }
    return;
  }
  if (data.type === "blocks") sendBlocks(data.keys);
};
