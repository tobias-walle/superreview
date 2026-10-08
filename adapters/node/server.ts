import { createServer, type IncomingMessage } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { CaptureProgress, Session } from "../../lib/review/types";
import type { JsonlStore } from "./jsonl-store";
import { capture, type Comparison } from "./git";
import { commandSchema, draftsSchema } from "../../lib/review/validation";
import { startTiming, type TimingLogger } from "./diagnostics";
import { z } from "zod";
import type { GuideBundle } from "../../lib/review/guide";

const importEnvelope = z
  .object({
    bundle: z.unknown(),
    sequence: z.number().int().nonnegative(),
    id: z.string().min(1).max(100),
    authorName: z.string().min(1).max(200),
  })
  .strict();
// JSON escaping can expand a document byte to six bytes. Keep room for
// a maximum-size authoring bundle and its publication envelope.
const GUIDE_REQUEST_BYTES = 32 * 1024 * 1024;
const COMMAND_REQUEST_BYTES = 4 * 1024 * 1024;

const initialProgress: CaptureProgress = { phase: "discovering", completed: 0, total: 0 };

async function body(req: IncomingMessage, limit = COMMAND_REQUEST_BYTES) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export async function startServer(options: {
  store: JsonlStore;
  root: string;
  comparison: Comparison;
  web: string;
  port: number;
  qaOrigin?: string;
  initialCapture?: boolean;
  onTiming?: TimingLogger;
}) {
  const { store, root, comparison, web } = options;
  let writeQueue: Promise<unknown> = Promise.resolve();
  let activeCapture: Promise<Session> | null = null;
  let captureState:
    | { status: "ready" }
    | { status: "capturing"; progress: CaptureProgress }
    | { status: "error"; error: string } = options.initialCapture
    ? { status: "capturing", progress: initialProgress }
    : store.state.snapshotId
      ? { status: "ready" }
      : { status: "error", error: "No snapshot has been captured." };
  const enqueue = <T>(work: () => Promise<T>) => {
    const result = writeQueue.then(work, work);
    writeQueue = result.catch(() => {});
    return result;
  };
  const session = async (): Promise<Session> => {
    const drafts = await store.draftState();
    const base = {
      state: store.state,
      drafts: drafts.drafts,
      draftRevision: drafts.revision,
    };
    if (captureState.status !== "ready") return { ...base, ...captureState };
    if (!store.state.snapshotId)
      return { ...base, status: "error", error: "No snapshot has been captured." };
    return { ...base, status: "ready", snapshot: await store.snapshot(store.state.snapshotId) };
  };
  const startCapture = (view: "full" | "since" = "full") => {
    if (activeCapture) return activeCapture;
    captureState = { status: "capturing", progress: initialProgress };
    const task = enqueue(async () => {
      const finishCapture = startTiming(options.onTiming, `capture (${view})`);
      try {
        if (store.state.archived) throw new Error("Archived reviews are read-only");
        const snapshot = await capture(
          root,
          comparison,
          store,
          view,
          (progress) => {
            captureState = { status: "capturing", progress };
          },
          options.onTiming,
        );
        captureState = {
          status: "capturing",
          progress: {
            phase: "saving",
            completed: snapshot.data.files.length,
            total: snapshot.data.files.length,
          },
        };
        const finishSave = startTiming(options.onTiming, "capture: save snapshot");
        await store.capture(snapshot);
        finishSave(`${snapshot.data.files.length} files`);
        captureState = { status: "ready" };
        finishCapture(`${snapshot.data.files.length} files`);
        return session();
      } catch (error: any) {
        captureState = { status: "error", error: error.message };
        finishCapture(`failed: ${error.message}`);
        throw error;
      }
    });
    activeCapture = task;
    const clear = () => {
      if (activeCapture === task) activeCapture = null;
    };
    void task.then(clear, clear);
    return task;
  };
  const server = createServer((req, res) => {
    const run = async () => {
      try {
        const host = `127.0.0.1:${(server.address() as { port: number }).port}`;
        if (req.headers.host !== host)
          throw Object.assign(new Error("Invalid host"), { status: 403 });
        if (
          req.headers.origin &&
          req.headers.origin !== `http://${host}` &&
          req.headers.origin !== options.qaOrigin
        )
          throw Object.assign(new Error("Invalid origin"), { status: 403 });
        const url = new URL(req.url || "/", `http://${host}`);
        if (url.pathname.startsWith("/api/")) {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          let result: unknown;
          if (req.method === "GET" && url.pathname === "/api/session") result = await session();
          else if (req.method === "GET" && url.pathname.startsWith("/api/snapshots/"))
            result = await store.snapshot(url.pathname.slice("/api/snapshots/".length));
          else if (req.method === "GET" && url.pathname.startsWith("/api/guides/"))
            result = await store.guide(url.pathname.slice("/api/guides/".length));
          else if (req.method === "GET" && url.pathname.startsWith("/api/objects/"))
            result = {
              content: (
                await store.readObject(url.pathname.slice("/api/objects/".length))
              ).toString("utf8"),
            };
          else if (req.method === "POST") {
            if (
              req.headers["x-superreview"] !== "1" ||
              !req.headers["content-type"]?.startsWith("application/json")
            )
              throw Object.assign(new Error("Invalid request headers"), {
                status: 403,
              });
            const value = await body(
              req,
              url.pathname === "/api/guides/import" ? GUIDE_REQUEST_BYTES : COMMAND_REQUEST_BYTES,
            );
            if (url.pathname === "/api/commands") {
              if (
                !Number.isInteger(value.sequence) ||
                typeof value.id !== "string" ||
                value.id.length > 100
              )
                throw new Error("Invalid command envelope");
              result = await enqueue(() =>
                store.execute(commandSchema.parse(value.command), value.sequence, value.id),
              );
            } else if (url.pathname === "/api/guides/import") {
              const publication = importEnvelope.parse(value);
              result = await enqueue(() =>
                store.importGuide(
                  publication.bundle as GuideBundle,
                  publication.sequence,
                  publication.id,
                  publication.authorName,
                ),
              );
            } else if (url.pathname === "/api/drafts") {
              if (!Number.isInteger(value.revision)) throw new Error("Invalid draft revision");
              result = await enqueue(async () => ({
                revision: await store.saveDrafts(draftsSchema.parse(value.drafts), value.revision),
              }));
            } else if (url.pathname === "/api/refresh") {
              result = await startCapture(value.view === "since" ? "since" : "full");
            } else throw Object.assign(new Error("Not found"), { status: 404 });
          } else throw Object.assign(new Error("Not found"), { status: 404 });
          res.end(JSON.stringify(result));
          return;
        }
        if (req.method !== "GET")
          throw Object.assign(new Error("Method not allowed"), { status: 405 });
        const path = resolve(web, "." + decodeURIComponent(url.pathname));
        if (path !== resolve(web) && !path.startsWith(resolve(web) + sep))
          throw Object.assign(new Error("Not found"), { status: 404 });
        const target = url.pathname === "/" ? join(web, "index.html") : path;
        const mime: Record<string, string> = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".woff2": "font/woff2",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".tgz": "application/gzip",
        };
        if (!(await stat(target)).isFile())
          throw Object.assign(new Error("Not found"), { status: 404 });
        res.setHeader("Content-Type", mime[extname(target)] || "application/octet-stream");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.end(await readFile(target));
      } catch (error: any) {
        res.statusCode = error.status || (error.code === "ENOENT" ? 404 : 400);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: error.message, diagnostics: error.diagnostics }));
      }
    };
    void run();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", resolve);
  });
  return {
    server,
    startCapture,
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
  };
}
