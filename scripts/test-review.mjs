import { build } from "esbuild";
import { execFileSync } from "node:child_process";
await build({
  entryPoints: [
    "tests/review/review.test.ts",
    "tests/review/guide.test.ts",
    "tests/review/guide-publication.test.ts",
    "tests/review/guide-projection.test.ts",
    "tests/review/guide-renderer.test.tsx",
    "tests/review/guide-workspace.test.tsx",
    "tests/review/components.test.tsx",
    "tests/review/selection.test.ts",
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
    "tests/.build/guide.test.mjs",
    "tests/.build/guide-publication.test.mjs",
    "tests/.build/guide-projection.test.mjs",
    "tests/.build/guide-renderer.test.mjs",
    "tests/.build/guide-workspace.test.mjs",
    "tests/.build/components.test.mjs",
    "tests/.build/selection.test.mjs",
    "tests/.build/skill.test.mjs",
  ],
  {
    stdio: "inherit",
  },
);
