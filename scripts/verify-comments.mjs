import assert from "node:assert/strict";
import { range, label, contains, currentFile, validAnchor } from "../lib/comments/model.ts";
import { buildFileModel } from "../lib/diff/render.ts";
const start = { hunk: 1, source: 4, line: 25, text: "end" };
const anchor = {
  path: "file.ts",
  fingerprint: "a",
  side: "new",
  start,
  end: start,
  excerpt: "end",
};
const ranged = range(anchor, { hunk: 0, source: 2, line: 3, text: "start" });
assert.equal(label(ranged), "New · L3–25");
assert(contains(ranged, "file.ts", 0, { sourceIndex: 2, newNo: 3, text: "start" }, "new"));
assert(!contains(ranged, "file.ts", 0, { sourceIndex: 2, oldNo: 3, text: "start" }, "old"));
assert(!contains(ranged, "other.ts", 0, { sourceIndex: 2, newNo: 3, text: "start" }, "new"));
assert(validAnchor(ranged));
assert(!validAnchor({ ...ranged, start: null }));
assert.equal(currentFile(ranged, { files: [{ path: "file.ts" }] }, [{ fingerprint: "a" }]), 0);
assert.equal(
  currentFile(ranged, { files: [{ path: "file.ts" }] }, [{ fingerprint: "changed" }]),
  -1,
);
const f = {
  path: "file.ts",
  hunks: [
    {
      header: "",
      oldStart: 1,
      newStart: 1,
      lines: [
        ...Array.from({ length: 90 }, (_, i) => "-const value" + i + " = 1;"),
        ...Array.from({ length: 90 }, (_, i) => "+const value" + i + " = 2;"),
      ],
    },
  ],
};
const m = buildFileModel(f);
for (const mode of ["split", "unified"]) {
  const blocks = m.metadata.hunks[0][mode];
  const rows = mode === "split" ? m.hunks[0].split : m.hunks[0].unified.map((l) => [l]);
  for (let source = 0; source < 180; source++) {
    const bi = blocks.findIndex((b) => b.sources.includes(source));
    assert(bi >= 0);
    assert(
      rows
        .slice(bi * 24, (bi + 1) * 24)
        .some((pair) => pair.some((l) => l?.sourceIndex === source)),
      "Navigation must find the exact block in either layout",
    );
  }
}
console.log(
  "Passed: reverse and cross-hunk ranges, side and file isolation, old diff retention, validated anchors, exact split/unified block navigation.",
);
