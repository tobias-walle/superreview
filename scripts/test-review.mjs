import { build } from "esbuild";
import { execFileSync } from "node:child_process";
await build({
  entryPoints: [
    "tests/review/review.test.ts",
    "tests/review/components.test.tsx",
    "tests/review/skill.test.ts",
  ],
  outdir: "tests/.build",
  outExtension: { ".js": ".mjs" },
  packages: "external",
  alias: { "@": process.cwd() },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
});
execFileSync(
  process.execPath,
  [
    "--test",
    "tests/.build/review.test.mjs",
    "tests/.build/components.test.mjs",
    "tests/.build/skill.test.mjs",
  ],
  {
    stdio: "inherit",
  },
);
