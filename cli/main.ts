import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { readSkill } from "./skill";
import { parseArgs, help } from "./args";
import { version } from "./version";
import { repository, capture, git, type Comparison } from "../adapters/node/git";
import { JsonlStore, atomicJson, listReviews, lockRepository } from "../adapters/node/jsonl-store";
import { startServer } from "../adapters/node/server";
import {
  agentAuthor,
  commentAnchor,
  commentBody,
  executeReviewWrite,
  replyCommand,
  threadOutput,
} from "./review-commands";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    console.log(help);
    return;
  }
  if (options.command === "version") {
    console.log(version);
    return;
  }
  if (options.command === "skill") {
    process.stdout.write(await readSkill(options.json));
    return;
  }
  const repo = repository(process.cwd()),
    root = join(repo.root, ".superreview");
  const colored =
    options.color === "always" ||
    (options.color === "auto" && !!process.stdout.isTTY && !("NO_COLOR" in process.env));
  const paint = (text: string, color: number) => (colored ? `\x1b[${color}m${text}\x1b[0m` : text);
  if (["list", "export", "threads"].includes(options.command)) {
    const reviews = await listReviews(root);
    if (options.command === "list") {
      if (options.json)
        console.log(
          JSON.stringify(
            reviews.map((s) => ({
              id: s.identity.id,
              title: s.identity.title,
              archived: s.archived,
              submissions: s.submissions.length,
              sequence: s.sequence,
              snapshotId: s.snapshotId,
              worktree: s.identity.binding.worktree,
              branch: s.identity.binding.branch,
            })),
          ),
        );
      else
        console.log(
          reviews.length
            ? reviews
                .map(
                  (s) =>
                    `${paint(s.identity.id, 35)}  ${s.identity.title}  ${paint(s.archived ? "archived" : "active", s.archived ? 90 : 32)}  ${s.submissions.length} submissions`,
                )
                .join("\n")
            : "No reviews yet. Run superreview to start.",
        );
    } else {
      const review = reviews.find((s) => s.identity.id === options.id);
      if (!review) throw new Error("Review not found");
      if (options.command === "export") {
        const submission = options.submission
          ? review.submissions.find((s) => s.number === options.submission)
          : review.submissions.at(-1);
        if (!submission) throw new Error("No matching submission");
        process.stdout.write(
          options.json ? JSON.stringify(submission) + "\n" : submission.markdown,
        );
      } else {
        const store = new JsonlStore(root, review.identity.id);
        const drafts = await store.draftState();
        const output = threadOutput(review, options.submission, drafts.drafts.length);
        if (options.json) console.log(JSON.stringify(output));
        else {
          console.log(
            `${review.identity.title}  ${review.identity.id}  sequence ${review.sequence}`,
          );
          if (drafts.drafts.length)
            console.log(`${drafts.drafts.length} unfinished drafts are not submitted feedback.`);
          for (const thread of output.threads) {
            console.log(
              `\n${thread.id}  ${thread.anchor.path}  ${thread.resolved ? "resolved" : "open"}`,
            );
            for (const message of thread.messages)
              console.log(
                `  ${message.author?.name || "Legacy author unknown"}${message.author?.kind === "agent" ? " [Agent]" : ""}: ${message.deleted ? "[deleted]" : message.body}`,
              );
          }
        }
      }
    }
    return;
  }
  if (options.command === "reply" || options.command === "comment") {
    if (options.requestId.length > 100) throw new Error("Request ID is too long");
    if (options.refs.length || options.paths.length)
      throw new Error(`${options.command} does not accept Git revisions or path arguments`);
    const text = await commentBody(options.body, options.bodyFile);
    const author = agentAuthor(options.author);
    const result = await executeReviewWrite({
      root,
      reviewId: options.id,
      expectedSequence: options.expectedSequence,
      requestId: options.requestId || undefined,
      command: async (context, requestId) => {
        if (options.command === "reply") {
          const thread = context.state.threads.find((entry) => entry.id === options.threadId);
          if (!thread) throw new Error("Thread not found");
          return replyCommand(thread, text, author, requestId);
        }
        if (!options.snapshot) throw new Error("Agent comments require --snapshot <id>");
        if (!options.path)
          throw new Error("Agent comments require --path <repository-relative-path>");
        const snapshot = await context.snapshotById(options.snapshot);
        const anchor = commentAnchor({
          snapshot,
          path: options.path,
          side: options.side,
          line: options.line,
          endLine: options.endLine,
          fileComment: options.fileComment,
        });
        const now = Date.now();
        return {
          type: "thread",
          thread: {
            id: requestId,
            anchor,
            created: now,
            messages: [{ id: `${requestId}-message`, body: text, author, created: now }],
          },
        };
      },
    });
    const changedThread =
      options.command === "reply"
        ? result.state.threads.find((entry) => entry.id === options.threadId)
        : result.state.threads.find((entry) => entry.id === result.requestId);
    if (!changedThread) throw new Error("The request ID was already used for another operation");
    const output = {
      reviewId: options.id,
      threadId: changedThread?.id,
      messageId:
        options.command === "reply"
          ? changedThread.messages.find((message) => message.id === result.requestId)?.id
          : `${result.requestId}-message`,
      sequence: result.state.sequence,
      requestId: result.requestId,
    };
    if (!output.messageId) throw new Error("The request ID was already used for another operation");
    console.log(
      options.json
        ? JSON.stringify(output)
        : `${options.command === "reply" ? "Added agent reply" : "Added agent comment"} ${output.threadId}`,
    );
    return;
  }
  const unlock = await lockRepository(root);
  let running = false;
  try {
    await mkdir(join(root, "cache"), { recursive: true });
    try {
      await readFile(join(root, "config.json"));
    } catch {
      await atomicJson(join(root, "config.json"), {
        schema: 1,
        format: "jsonl",
        comparison: "histogram",
        wordDiff: "delta",
      });
    }
    const exclude = git(repo.root, ["rev-parse", "--git-path", "info/exclude"]).toString().trim();
    const excludePath = resolve(repo.root, exclude);
    // Local Git metadata only; never edit the repository's shared .gitignore.
    let ignored = "";
    try {
      ignored = await readFile(excludePath, "utf8");
    } catch {}
    if (!ignored.split("\n").includes("/.superreview/")) {
      await mkdir(dirname(excludePath), { recursive: true });
      await appendFile(excludePath, "\n/.superreview/\n");
    }
    const reviews = await listReviews(root, true);
    let found = options.id ? reviews.find((s) => s.identity.id === options.id) : undefined;
    if (options.id && !found) throw new Error("Review not found");
    const comparison: Comparison = {
      refs: options.refs,
      paths: options.paths,
      cached: options.cached,
    };
    const comparisonKey = JSON.stringify(comparison);
    const targetOf = (spec: Comparison) => {
      const target =
        spec.refs.length === 2
          ? spec.refs[1]
          : spec.refs[0]?.includes("..")
            ? spec.refs[0].split(/\.{2,3}/)[1] || "HEAD"
            : "HEAD";
      return /^HEAD(?:[~^].*)?$/.test(target) || target === repo.branch ? "branch" : target;
    };
    const bindingTarget = targetOf(comparison);
    if (!found && !options.fresh && options.command !== "create")
      found = [...reviews]
        .sort((a, b) => b.identity.created - a.identity.created)
        .find(
          (s) =>
            !s.archived &&
            s.identity.binding.branch === repo.branch &&
            s.identity.binding.worktree === repo.root &&
            (s.identity.binding.target ||
              targetOf(
                JSON.parse(
                  s.identity.binding.comparison ||
                    JSON.stringify({ refs: [], paths: [], cached: false }),
                ),
              )) === bindingTarget,
        );
    const store = new JsonlStore(root, found?.identity.id || randomUUID().slice(0, 8));
    if (found) await store.load(true);
    else
      await store.create({
        schema: 1,
        id: store.id,
        title: options.name || `${repo.branch} review`,
        created: Date.now(),
        binding: {
          repository: repo.id,
          worktree: repo.root,
          branch: repo.branch,
          comparison: comparisonKey,
          target: bindingTarget,
        },
      });
    if (options.command === "archive" || options.command === "reopen") {
      await store.execute(
        { type: "archive", archived: options.command === "archive" },
        store.state.sequence,
        randomUUID(),
      );
      console.log(
        options.json
          ? JSON.stringify({ id: store.id, archived: store.state.archived })
          : `${store.state.archived ? "Archived" : "Reopened"} ${store.id}`,
      );
      return;
    }
    const savedComparison: Comparison =
      options.command === "open" && store.state.snapshotId
        ? (await store.snapshot(store.state.snapshotId)).comparison ||
          JSON.parse(store.state.identity.binding.comparison || comparisonKey)
        : comparison;
    if (options.command === "create") {
      await store.capture(await capture(repo.root, savedComparison, store));
      const snapshot = await store.snapshot(store.state.snapshotId);
      console.log(
        options.json
          ? JSON.stringify({
              reviewId: store.id,
              title: store.state.identity.title,
              snapshotId: snapshot.id,
              files: snapshot.data.files.length,
            })
          : `Created ${store.state.identity.title}  ${store.id}\n${snapshot.data.files.length} changed files`,
      );
      return;
    }
    const initialCapture = options.command !== "open" || !store.state.snapshotId;
    const { server, url, startCapture } = await startServer({
      store,
      root: repo.root,
      comparison: savedComparison,
      web: join(dirname(fileURLToPath(import.meta.url)), "web"),
      port: options.port,
      qaOrigin: process.env.SUPERREVIEW_QA_ORIGIN,
      initialCapture,
    });
    running = true;
    await atomicJson(join(root, "writer.lock", "server.json"), { url, reviewId: store.id });
    const snapshot = initialCapture ? undefined : await store.snapshot(store.state.snapshotId);
    if (options.json)
      console.log(
        JSON.stringify({
          url,
          reviewId: store.id,
          title: store.state.identity.title,
          status: initialCapture ? "capturing" : "ready",
          ...(snapshot ? { snapshotId: snapshot.id, files: snapshot.data.files.length } : {}),
        }),
      );
    else
      console.log(
        `\n${paint("superreview", 35)}  ${repo.branch}\n${store.state.identity.title}  ${paint(store.id, 90)}\n${snapshot ? `${snapshot.data.files.length} changed files` : "Preparing changes…"} · ${store.state.submissions.length} submissions\n\n${paint(url, 36)}\n${paint("Ctrl+C to stop · review saved locally", 90)}\n`,
      );
    if (options.open) {
      const [program, args] =
        process.platform === "darwin"
          ? ["open", [url]]
          : process.platform === "win32"
            ? ["cmd", ["/c", "start", "", url]]
            : ["xdg-open", [url]];
      const child = spawn(program as string, args as string[], {
        stdio: "ignore",
        detached: true,
      });
      child.on("error", () => {});
      child.unref();
    }
    const captureTask = initialCapture
      ? startCapture().catch((error) => {
          console.error(
            options.json
              ? JSON.stringify({ error: error.message })
              : `superreview: ${error.message}`,
          );
        })
      : Promise.resolve();
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      server.close(() => {
        void captureTask.finally(() => unlock().then(() => process.exit(0)));
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } finally {
    if (!running) await unlock();
  }
}
main().catch((error) => {
  const json = process.argv.includes("--json");
  console.error(json ? JSON.stringify({ error: error.message }) : `superreview: ${error.message}`);
  process.exitCode = 1;
});
