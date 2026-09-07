import assert from "node:assert/strict";
import { buildFileModel, BLOCK_ROWS } from "../lib/diff/render.ts";
import {
  recordDecision,
  recordAutomatic,
  addCoverage,
  coverageComplete,
} from "../lib/diff/viewed.mjs";
let marks = recordAutomatic({}, "version-a");
assert.equal(marks["version-a"].viewed, true);
marks = recordDecision(marks, "version-a", false);
assert.equal(
  recordAutomatic(marks, "version-a")["version-a"].viewed,
  false,
  "Manual unview must survive automatic completion",
);
assert.equal(marks["version-b"], undefined, "New content must not inherit old decisions");
let coverage = addCoverage([], 0, 0.3);
coverage = addCoverage(coverage, 0.7, 1);
assert.equal(coverageComplete(coverage), false, "Jumping over the middle is not complete");
coverage = addCoverage(coverage, 0.3, 0.7);
assert.equal(coverageComplete(coverage), true);
const source = {
  path: "fixture.ts",
  status: "M",
  hunks: [
    {
      header: "@@ -1,3 +1,3 @@",
      oldStart: 1,
      newStart: 1,
      lines: [" same", "-old", "+new", " end"],
    },
  ],
};
const small = buildFileModel(source);
assert.equal(small.metadata.hunks[0].sourceCount, 4);
const ids = small.hunks[0].split.flatMap((pair) =>
  pair.filter(Boolean).map((line) => line.sourceIndex),
);
assert.equal(new Set(ids).size, 4, "Every source line must remain visible in split view");
const sourceLines = 100000;
const huge = {
  path: "huge.ts",
  status: "M",
  hunks: [
    {
      header: "@@ -1,50000 +1,50000 @@",
      oldStart: 1,
      newStart: 1,
      lines: [
        ...Array.from({ length: sourceLines / 2 }, (_, i) => "-const old" + i + " = " + i + ";"),
        ...Array.from({ length: sourceLines / 2 }, (_, i) => "+const new" + i + " = " + i + ";"),
      ],
    },
  ],
};
const start = performance.now();
const model = buildFileModel(huge);
const ms = Math.round(performance.now() - start);
assert.equal(model.metadata.hunks[0].sourceCount, sourceLines);
assert(model.metadata.hunks[0].simplified);
assert(model.metadata.hunks[0].split.every((b) => b.count <= BLOCK_ROWS));
assert.equal(
  model.metadata.hunks[0].unified.reduce((s, b) => s + b.count, 0),
  sourceLines,
);
assert(ms < 10000, `Preparation exceeded 10s: ${ms}ms`);
console.log(
  JSON.stringify({
    passed: true,
    sourceLines,
    preparationMs: ms,
    maxRowsPerBlock: BLOCK_ROWS,
    checks: [
      "manual overrides",
      "content version isolation",
      "skipped coverage",
      "source row identity",
      "large change CPU budget",
    ],
  }),
);
