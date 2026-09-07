import { build } from "esbuild";
import { mkdir, writeFile, copyFile, chmod, readFile, readdir, cp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await mkdir("dist-cli", { recursive: true });
await build({
  entryPoints: ["cli/main.ts"],
  outfile: "dist-cli/superreview.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
});
execFileSync("node_modules/.bin/vite", ["build"], { stdio: "inherit" });
await cp("skill-data", "dist-cli/skill-data", { recursive: true });
await cp("skills", "dist-cli/skills", { recursive: true });
await chmod("dist-cli/superreview.mjs", 0o755);
await copyFile("public/favicon.svg", "dist-cli/web/favicon.svg");
await writeFile(
  "dist-cli/package.json",
  JSON.stringify(
    {
      name: "superreview",
      version: "0.2.1",
      description: "A local Git review workspace with persistent review rounds",
      type: "module",
      bin: { superreview: "./superreview.mjs" },
      engines: { node: ">=22.13.0" },
      files: [
        "superreview.mjs",
        "web",
        "skill-data",
        "skills",
        "README.md",
        "THIRD_PARTY_NOTICES.md",
      ],
      license: "UNLICENSED",
    },
    null,
    2,
  ),
);
await copyFile("docs/CLI.md", "dist-cli/README.md");

// Preserve license texts for bundled dependencies in the distributable package.
let notices = await readFile("THIRD_PARTY_NOTICES.md", "utf8");
const seen = new Set();
async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.name.startsWith("@")) {
      await collect(path);
      continue;
    }
    let pkg;
    try {
      pkg = JSON.parse(await readFile(`${path}/package.json`, "utf8"));
    } catch {
      continue;
    }
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const names = await readdir(path);
    for (const name of names.filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name))) {
      try {
        notices += `\n\n## ${key} — ${name}\n\n` + (await readFile(`${path}/${name}`, "utf8"));
      } catch {
        /* License directories are not text files. */
      }
    }
  }
}
await collect("node_modules");
await writeFile("dist-cli/THIRD_PARTY_NOTICES.md", notices);
