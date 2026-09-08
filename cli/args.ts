import { version } from "./version";

export function parseArgs(input: string[]) {
  const args = [...input];
  const options = {
    refs: [] as string[],
    paths: [] as string[],
    cached: false,
    fresh: false,
    name: "",
    port: 0,
    open: true,
    json: false,
    color: "auto",
    command: "serve",
    id: "",
    threadId: "",
    submission: 0,
    snapshot: "",
    path: "",
    side: "new" as "old" | "new",
    line: 0,
    endLine: 0,
    fileComment: false,
    body: "",
    bodyFile: "",
    author: "Superreview agent",
    requestId: "",
    expectedSequence: 0,
  };
  if (args[0] === "skill") {
    if (args.length === 2 && ["--help", "-h"].includes(args[1])) {
      options.command = "help";
      return options;
    }
    if (args[1] !== "read" || args.slice(2).some((arg) => arg !== "--json") || args.length > 3)
      throw new Error("Usage: superreview skill read [--json]");
    options.command = "skill";
    options.json = args.includes("--json");
    return options;
  }
  const commands = [
    "create",
    "list",
    "open",
    "archive",
    "reopen",
    "export",
    "threads",
    "reply",
    "comment",
  ];
  if (commands.includes(args[0])) {
    options.command = args.shift()!;
    if (!["create", "list"].includes(options.command)) options.id = args.shift() || "";
    if (options.command === "reply") options.threadId = args.shift() || "";
  }
  const value = (i: number, flag: string) => {
    if (!args[i]) throw new Error(`${flag} requires a value`);
    return args[i];
  };
  const positiveInteger = (i: number, flag: string) => {
    const parsed = Number(value(i, flag));
    if (!Number.isInteger(parsed) || parsed < 1)
      throw new Error(`${flag} requires a positive integer`);
    return parsed;
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      options.paths = args.slice(i + 1);
      break;
    }
    if (arg === "--help" || arg === "-h") options.command = "help";
    else if (arg === "--version") options.command = "version";
    else if (arg === "--cached" || arg === "--staged") options.cached = true;
    else if (arg === "--new") options.fresh = true;
    else if (arg === "--review") options.id = value(++i, arg);
    else if (arg === "--name") options.name = value(++i, arg);
    else if (arg === "--snapshot") options.snapshot = value(++i, arg);
    else if (arg === "--path") options.path = value(++i, arg);
    else if (arg === "--side") {
      const side = value(++i, arg);
      if (side !== "old" && side !== "new") throw new Error("Use --side old|new");
      options.side = side;
    } else if (arg === "--line") options.line = positiveInteger(++i, arg);
    else if (arg === "--end-line") options.endLine = positiveInteger(++i, arg);
    else if (arg === "--file-comment") options.fileComment = true;
    else if (arg === "--body") options.body = value(++i, arg);
    else if (arg === "--body-file") options.bodyFile = value(++i, arg);
    else if (arg === "--author") options.author = value(++i, arg);
    else if (arg === "--request-id") options.requestId = value(++i, arg);
    else if (arg === "--expected-sequence") options.expectedSequence = positiveInteger(++i, arg);
    else if (arg === "--port") {
      options.port = Number(value(++i, arg));
      if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)
        throw new Error("Invalid port");
    } else if (arg === "--submission") options.submission = positiveInteger(++i, arg);
    else if (arg === "--no-open") options.open = false;
    else if (arg === "--json") options.json = true;
    else if (arg.startsWith("--color=")) {
      options.color = arg.slice(8);
      if (!["auto", "always", "never"].includes(options.color))
        throw new Error("Use --color=auto|always|never");
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else options.refs.push(arg);
  }
  if (
    ["open", "archive", "reopen", "export", "threads", "reply", "comment"].includes(
      options.command,
    ) &&
    !options.id
  )
    throw new Error("Specify a review ID. Use superreview list.");
  if (options.command === "reply" && !options.threadId) throw new Error("Specify a thread ID");
  if (options.command === "create" && options.id)
    throw new Error("create always starts a new review. Do not use --review.");
  return options;
}
export const help = `superreview ${version} - review changes, keep the conversation

  superreview                         Open or resume a working-tree review
  superreview main...HEAD             Open a branch review
  superreview --cached                Open a staged review
  superreview -- src/app.ts           Limit the review to literal paths

  superreview create main...HEAD --name "Auth" --json
                                      Create and capture a new review, then exit
  superreview list --json             List saved reviews
  superreview open <id>               Open the exact saved snapshot
  superreview threads <id> --json     Read current threads and submission changes
  superreview export <id>             Export the latest submitted round
  superreview reply <id> <thread-id> --body-file reply.md --json
                                      Add an agent reply
  superreview comment <id> --snapshot <snapshot-id> --path src/app.ts \\
    --side new --line 42 --body-file comment.md --json
                                      Add an agent line or range comment
  superreview archive <id>            Archive a review
  superreview reopen <id>             Reopen an archived review
  superreview skill read              Read version-matched agent instructions

Comment options:
  --end-line <number>  --file-comment  --author <name>
  --request-id <id>  --expected-sequence <number>
  --body <text>  --body-file <path|->

General options:
  --new  --name <title>  --no-open  --port <number>  --json
  --color=auto|always|never  --submission <number>

Reviews are saved in .superreview in this worktree. No code or index changes.
GitHub/GitLab sync is not implemented.
`;
