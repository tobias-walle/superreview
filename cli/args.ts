export function parseArgs(args: string[]) {
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
    submission: 0,
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
  const commands = ["list", "open", "archive", "reopen", "export"];
  if (commands.includes(args[0])) {
    options.command = args.shift()!;
    if (options.command !== "list") options.id = args.shift() || "";
  }
  const value = (i: number, flag: string) => {
    if (!args[i]) throw new Error(`${flag} requires a value`);
    return args[i];
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
    else if (arg === "--port") {
      options.port = Number(value(++i, arg));
      if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)
        throw new Error("Invalid port");
    } else if (arg === "--submission") {
      options.submission = Number(value(++i, arg));
      if (!Number.isInteger(options.submission) || options.submission < 1)
        throw new Error("Invalid submission number");
    } else if (arg === "--no-open") options.open = false;
    else if (arg === "--json") options.json = true;
    else if (arg.startsWith("--color=")) {
      options.color = arg.slice(8);
      if (!["auto", "always", "never"].includes(options.color))
        throw new Error("Use --color=auto|always|never");
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else options.refs.push(arg);
  }
  if (commands.includes(options.command) && options.command !== "list" && !options.id)
    throw new Error("Specify a review ID. Use superreview list.");
  return options;
}
export const help = `superreview 0.2.1 — review changes, keep the conversation

  superreview                         Working tree vs HEAD, including untracked
  superreview main                    Working tree vs main
  superreview main..feature           Compare two commits
  superreview main...feature          Compare merge base to feature
  superreview main feature            Compare two commits
  superreview --cached                 Staged changes only
  superreview -- src/app.ts            Limit to repository-relative paths

  superreview --new --name "Auth"      Start another review
  superreview skill read               Read version-matched agent instructions
  superreview list                     List saved reviews
  superreview open <id>                 Open the saved snapshot
  superreview archive <id>              Archive a review
  superreview reopen <id>               Reopen an archived review
  superreview export <id> --submission 1  Export a submitted round as Markdown

  --no-open  --port <number>  --json  --color=auto|always|never

Reviews are saved in .superreview in this worktree. No code or index changes.
GitHub/GitLab sync and guided reviews are reserved for a future release.
`;
