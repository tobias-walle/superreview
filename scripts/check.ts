import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const CACHE_DIR_NAME = ".check-cache";
const CACHE_DIR = resolve(ROOT, CACHE_DIR_NAME);
const CACHE_VERSION = "check-v1";

const DEFAULT_EXCLUDES = [
  `${CACHE_DIR_NAME}/**`,
  "**/node_modules/**",
  "dist-cli/**",
  "tests/.build/**",
  "coverage/**",
];

const useColor = process.stdout.isTTY && !("NO_COLOR" in process.env);
const color = (code: number, value: string) =>
  useColor ? `\u001b[${code}m${value}\u001b[0m` : value;
const green = (value: string) => color(32, value);
const red = (value: string) => color(31, value);
const yellow = (value: string) => color(33, value);
const dim = (value: string) => color(2, value);

type Step = {
  name: string;
  command: string[];
  filters: string[];
  include: string[];
  exclude?: string[];
  outputs?: string[];
  stage?: number;
};

type StepResult = {
  step: Step;
  passed: boolean;
  skipped: boolean;
  output: string;
  durationMs: number;
};

type OutputChunk = { order: number; text: string };
type RunningProcess = ChildProcessByStdio<null, Readable, Readable>;
type StageGroup<T extends { stage?: number }> = { stage: number; steps: T[] };

const rootInputs = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  ".oxlintrc.json",
  ".oxfmtrc.json",
  "postcss.config.mjs",
  "vite.config.ts",
  "release.config.mjs",
];
const codeInputs = [
  "adapters/**/*.{ts,tsx,mjs}",
  "bin/**/*.{ts,tsx,mjs}",
  "cli/**/*.{ts,tsx,mjs}",
  "client/**/*.{ts,tsx,mjs,json,css,html}",
  "components/**/*.{ts,tsx,mjs}",
  "hooks/**/*.{ts,tsx,mjs}",
  "lib/**/*.{ts,tsx,mjs,json}",
];
const buildInputs = [
  ...codeInputs,
  "scripts/build-cli.mjs",
  "public/**/*",
  "skill-data/**/*",
  "skills/**/*",
  "docs/CLI.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  ...rootInputs,
];

const allSteps: Step[] = [
  {
    name: "format",
    command: ["pnpm", "run", "format:check"],
    filters: ["format"],
    include: ["**/*.{ts,tsx,mts,mjs,js,jsx,json,jsonc,css,scss,md,yaml,yml,html}", ...rootInputs],
    exclude: ["vendor/**", "THIRD_PARTY_NOTICES.md", "pnpm-lock.yaml"],
  },
  {
    name: "lint",
    command: ["pnpm", "run", "lint"],
    filters: ["lint"],
    include: [...codeInputs, "scripts/**/*.{ts,mjs}", "tests/**/*.{ts,tsx,mjs}", ...rootInputs],
  },
  {
    name: "typecheck",
    command: ["pnpm", "run", "typecheck"],
    filters: ["typecheck", "types"],
    include: ["**/*.{ts,tsx,mts}", ...rootInputs],
  },
  {
    name: "test:diff",
    command: ["pnpm", "run", "test:diff"],
    filters: ["test", "diff", "test:diff"],
    include: [
      "adapters/node/git.ts",
      "bin/snapshot.mjs",
      "lib/comments/**/*",
      "lib/diff/**/*",
      "lib/review/**/*",
      "scripts/verify-*.mjs",
      ...rootInputs,
    ],
  },
  {
    name: "build",
    command: ["pnpm", "run", "build"],
    filters: ["build", "test", "review", "ui", "test:review", "test:ui"],
    include: buildInputs,
    outputs: ["dist-cli/superreview.mjs", "dist-cli/web/index.html"],
  },
  {
    name: "test:review",
    command: ["pnpm", "run", "test:review"],
    filters: ["test", "review", "test:review"],
    include: [...buildInputs, "scripts/test-review.mjs", "tests/review/**/*"],
    stage: 1,
  },
  {
    name: "test:ui",
    command: ["pnpm", "run", "test:ui"],
    filters: ["test", "ui", "test:ui"],
    include: [...buildInputs, "tests/*.test.mjs"],
    stage: 1,
  },
];

let outputOrder = 0;
let logQueue = Promise.resolve();

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

async function main(): Promise<void> {
  const started = performance.now();
  const verbose = process.argv.includes("--verbose");
  const force = process.argv.includes("--force");
  const filters = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const steps = selectSteps(filters);

  if (steps.length === 0) {
    console.error(red(`No check steps matched: ${filters.join(", ")}`));
    process.exitCode = 1;
    return;
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const results = await runStepStages(steps, (stageSteps) => runStage(stageSteps, force, verbose));
  await writeCaches(steps);

  if (verbose) await logStepOutputs(results);

  const skipped = results.filter((result) => result.skipped).length;
  const ran = results.length - skipped;
  const details = [ran ? `${ran} passed` : "", skipped ? `${skipped} unchanged` : ""]
    .filter(Boolean)
    .join(", ");
  await logLine(
    `${green("✓")} ${results.length} checks: ${details} ${dim(formatDuration(performance.now() - started))}`,
  );
}

function selectSteps(filters: string[]): Step[] {
  if (filters.length === 0) return allSteps;
  return allSteps.filter((step) =>
    filters.some((filter) => step.name.startsWith(filter) || step.filters.includes(filter)),
  );
}

function groupStepsByStage<T extends { stage?: number }>(steps: T[]): StageGroup<T>[] {
  const groups = new Map<number, T[]>();
  for (const step of steps) {
    const stage = step.stage ?? 0;
    groups.set(stage, [...(groups.get(stage) ?? []), step]);
  }
  return [...groups]
    .sort(([left], [right]) => left - right)
    .map(([stage, stageSteps]) => ({ stage, steps: stageSteps }));
}

async function runStepStages<T extends { stage?: number }, R>(
  steps: T[],
  run: (steps: T[], stage: number) => Promise<R[]>,
): Promise<R[]> {
  const results: R[] = [];
  for (const group of groupStepsByStage(steps))
    results.push(...(await run(group.steps, group.stage)));
  return results;
}

async function runStage(steps: Step[], force: boolean, verbose: boolean): Promise<StepResult[]> {
  const files = await listCheckableFiles();
  const skipped: StepResult[] = [];
  const runnable: Step[] = [];

  for (const step of steps) {
    const hash = await hashFiles(files.filter((file) => shouldIncludeFile(step, file)));
    const outputsExist = (step.outputs ?? []).every((path) => existsSync(resolve(ROOT, path)));
    if (!force && outputsExist && (await readCachedHash(step.name)) === hash) {
      skipped.push({ step, passed: true, skipped: true, output: "", durationMs: 0 });
    } else {
      runnable.push(step);
    }
  }

  return [...skipped, ...(await runParallel(runnable, verbose))];
}

async function runParallel(steps: Step[], verbose: boolean): Promise<StepResult[]> {
  if (steps.length === 0) return [];

  const running = new Map<string, RunningProcess>();
  const cancelled = new Set<string>();
  let failed = false;

  const results = await Promise.all(
    steps.map(async (step) => {
      const result = await runStep(step, running);
      if (result.passed) {
        if (verbose) await logResult(result);
        return result;
      }
      if (failed) {
        cancelled.add(step.name);
        return result;
      }

      failed = true;
      await logResult(result);
      await logStepOutputs([result]);
      for (const [name, child] of running) {
        if (name !== step.name) {
          cancelled.add(name);
          child.kill();
        }
      }
      return result;
    }),
  );

  if (results.some((result) => !result.passed)) {
    if (cancelled.size > 0) {
      await logLine(`${yellow("↯")} cancelled: ${[...cancelled].sort().join(", ")}`);
    }
    process.exit(1);
  }
  return results;
}

async function runStep(step: Step, running: Map<string, RunningProcess>): Promise<StepResult> {
  const started = performance.now();
  const [command, ...args] = step.command;
  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  running.set(step.name, child);
  const [output, exitCode] = await Promise.all([collectOutput(child), waitForExit(child)]);
  running.delete(step.name);
  return {
    step,
    passed: exitCode === 0,
    skipped: false,
    output,
    durationMs: performance.now() - started,
  };
}

function waitForExit(child: RunningProcess): Promise<number | null> {
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", resolveExit);
  });
}

async function collectOutput(child: RunningProcess): Promise<string> {
  const chunks: OutputChunk[] = [];
  await Promise.all([collectStream(child.stdout, chunks), collectStream(child.stderr, chunks)]);
  return chunks
    .sort((left, right) => left.order - right.order)
    .map((chunk) => chunk.text)
    .join("")
    .trim();
}

function collectStream(stream: RunningProcess["stdout"], chunks: OutputChunk[]): Promise<void> {
  return new Promise((resolveStream, rejectStream) => {
    stream.on("data", (chunk: Buffer) =>
      chunks.push({ order: outputOrder++, text: chunk.toString() }),
    );
    stream.once("error", rejectStream);
    stream.once("end", resolveStream);
  });
}

async function listCheckableFiles(): Promise<string[]> {
  const child = spawn("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const [stdout, exitCode] = await Promise.all([collectStdout(child), waitForExit(child)]);
  if (exitCode !== 0) throw new Error("Failed to list Git files");
  return stdout
    .split("\n")
    .filter(Boolean)
    .filter((path) => !matchesGlobList(path, DEFAULT_EXCLUDES))
    .sort();
}

function collectStdout(child: RunningProcess): Promise<string> {
  return new Promise((resolveOutput, rejectOutput) => {
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stdout.once("error", rejectOutput);
    child.stdout.once("end", () => resolveOutput(Buffer.concat(chunks).toString()));
  });
}

function shouldIncludeFile(step: Step, path: string): boolean {
  if (path === "scripts/check.ts") return true;
  if (matchesGlobList(path, step.exclude ?? [])) return false;
  return matchesGlobList(path, step.include);
}

async function hashFiles(paths: string[]): Promise<string> {
  const hash = createHash("sha256");
  hash.update(CACHE_VERSION);
  hash.update(`\0${process.version}\0${process.platform}\0${process.arch}\0`);
  for (const path of paths) {
    const absolutePath = resolve(ROOT, path);
    if (!existsSync(absolutePath)) continue;
    hash.update(path);
    hash.update("\0");
    hash.update(await readFile(absolutePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function readCachedHash(stepName: string): Promise<string | null> {
  const path = cachePath(stepName);
  return existsSync(path) ? (await readFile(path, "utf8")).trim() : null;
}

async function writeCaches(steps: Step[]): Promise<void> {
  const files = await listCheckableFiles();
  await Promise.all(
    steps.map(async (step) => {
      const inputs = files.filter((file) => shouldIncludeFile(step, file));
      await writeFile(cachePath(step.name), `${await hashFiles(inputs)}\n`);
    }),
  );
}

function cachePath(stepName: string): string {
  return join(CACHE_DIR, `${stepName.replace(/[^a-z0-9-]/gi, "_")}.sha256`);
}

function matchesGlobList(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*") {
      if (next === "*" && pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else if (next === "*") {
        source += ".*";
        index++;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if (char === "{") {
      const end = pattern.indexOf("}", index + 1);
      if (end !== -1) {
        source += `(?:${pattern
          .slice(index + 1, end)
          .split(",")
          .map(escapeRegExp)
          .join("|")})`;
        index = end;
        continue;
      }
    }
    source += escapeRegExp(char);
  }
  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

async function logResult(result: StepResult): Promise<void> {
  await logLine(
    `${result.passed ? green("✓") : red("✗")} ${result.step.name} ${dim(formatDuration(result.durationMs))}`,
  );
}

async function logStepOutputs(results: StepResult[]): Promise<void> {
  await enqueueLog(() => {
    for (const { step, output } of results) {
      if (!output) continue;
      console.log(dim(`--- ${step.name} output ---`));
      console.log(output);
      console.log(dim("--------------------"));
    }
  });
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

async function logLine(message: string): Promise<void> {
  await enqueueLog(() => console.log(message));
}

function enqueueLog(action: () => void): Promise<void> {
  const next = logQueue.then(action, action);
  logQueue = next.catch(() => undefined);
  return next;
}
