import { createServer, type IncomingMessage } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { JsonlStore } from "./jsonl-store";
import { capture, type Comparison } from "./git";
import { commandSchema, draftsSchema } from "../../lib/review/validation";

async function body(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024)
      throw Object.assign(new Error("Request too large"), { status: 413 });
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
}) {
  const { store, root, comparison, web } = options;
  let queue: Promise<unknown> = Promise.resolve();
  const session = async () => {
    const drafts = await store.draftState();
    return {
      state: store.state,
      snapshot: await store.snapshot(store.state.snapshotId),
      drafts: drafts.drafts,
      draftRevision: drafts.revision,
    };
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
          else if (req.method === "POST") {
            if (
              req.headers["x-superreview"] !== "1" ||
              !req.headers["content-type"]?.startsWith("application/json")
            )
              throw Object.assign(new Error("Invalid request headers"), {
                status: 403,
              });
            const value = await body(req);
            if (url.pathname === "/api/commands") {
              if (
                !Number.isInteger(value.sequence) ||
                typeof value.id !== "string" ||
                value.id.length > 100
              )
                throw new Error("Invalid command envelope");
              result = await store.execute(
                commandSchema.parse(value.command),
                value.sequence,
                value.id,
              );
            } else if (url.pathname === "/api/drafts") {
              if (!Number.isInteger(value.revision)) throw new Error("Invalid draft revision");
              result = {
                revision: await store.saveDrafts(draftsSchema.parse(value.drafts), value.revision),
              };
            } else if (url.pathname === "/api/refresh") {
              if (store.state.archived) throw new Error("Archived reviews are read-only");
              const snapshot = await capture(
                root,
                comparison,
                store,
                value.view === "since" ? "since" : "full",
              );
              await store.capture(snapshot);
              result = await session();
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
        res.end(JSON.stringify({ error: error.message }));
      }
    };
    queue = queue.then(run, run);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", resolve);
  });
  return {
    server,
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
  };
}
