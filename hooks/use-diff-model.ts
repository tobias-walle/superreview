import { useCallback, useEffect, useRef, useState } from "react";
import type { FileMeta, ReviewFile, RowPair } from "@/lib/diff/render";
const EMPTY: FileMeta[] = [];
export function useDiffModel(files: ReviewFile[]) {
  const worker = useRef<Worker | null>(null);
  const [modelFiles, setModelFiles] = useState<ReviewFile[] | null>(null);
  const [meta, setMeta] = useState<FileMeta[]>(EMPTY);
  const [failure, setFailure] = useState<{
    files: ReviewFile[];
    message: string;
  } | null>(null);
  const [preparationMs, setPreparationMs] = useState(0);
  const cache = useRef(new Map<string, RowPair[]>());
  const pending = useRef(new Set<string>());
  const [version, setVersion] = useState(0);
  useEffect(() => {
    cache.current.clear();
    pending.current.clear();
    const w = new Worker(new URL("../lib/diff/review.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.type === "ready") {
        setModelFiles(files);
        setMeta(data.files);
        setFailure(null);
        setPreparationMs(data.preparationMs);
      }
      if (data.type === "error") {
        console.error("Diff preparation:", data.message);
        setFailure({
          files,
          message: "Could not prepare this diff. Reload to try again.",
        });
      }
      if (data.type === "blocks") {
        for (const [key, rows] of data.blocks) {
          pending.current.delete(key);
          cache.current.delete(key);
          cache.current.set(key, rows);
        }
        while (cache.current.size > 96) cache.current.delete(cache.current.keys().next().value!);
        setVersion((v) => v + 1);
      }
    };
    w.onerror = () =>
      setFailure({
        files,
        message: "The diff worker could not start. Reload to try again.",
      });
    w.postMessage({ type: "init", files });
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [files]);
  const request = useCallback((keys: string[]) => {
    const missing = keys.filter((k) => !cache.current.has(k) && !pending.current.has(k));
    if (!missing.length) return;
    missing.forEach((k) => pending.current.add(k));
    worker.current?.postMessage({ type: "blocks", keys: missing });
  }, []);
  const getBlock = useCallback((key: string) => cache.current.get(key), []);
  // React renders new input before effects run. Never pair old metadata with new files.
  return {
    meta: modelFiles === files ? meta : EMPTY,
    error: failure?.files === files ? failure.message : "",
    version,
    request,
    getBlock,
    preparationMs,
  };
}
