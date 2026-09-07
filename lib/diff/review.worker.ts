import { sha256 } from "@noble/hashes/sha2.js";
import { buildFileModel, BLOCK_ROWS, type ReviewFile } from "./render";
let models: ReturnType<typeof buildFileModel>[] = [];
let generation = 0;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    const current = ++generation;
    const started = performance.now();
    try {
      const next: typeof models = [];
      for (const file of data.files as ReviewFile[]) {
        const model = buildFileModel(file);
        const digest = sha256(
          new TextEncoder().encode(
            JSON.stringify([file.path, file.status, file.binary, file.hunks]),
          ),
        );
        model.metadata.fingerprint =
          file.fingerprint ||
          Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
        next.push(model);
        if (current !== generation) return;
      }
      models = next;
      self.postMessage({
        type: "ready",
        files: models.map((m) => m.metadata),
        preparationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      self.postMessage({ type: "error", message: String(error) });
    }
  }
  if (data.type === "blocks") {
    self.postMessage({
      type: "blocks",
      request: data.request,
      blocks: data.keys.map((key: string) => {
        const [f, h, mode, b] = key.split(":");
        const hunk = models[+f]?.hunks[+h];
        const start = +b * BLOCK_ROWS,
          end = (+b + 1) * BLOCK_ROWS;
        const rows =
          mode === "split"
            ? hunk?.split.slice(start, end)
            : hunk?.unified.slice(start, end).map((line) => [line]);
        return [key, rows || []];
      }),
    });
  }
};
