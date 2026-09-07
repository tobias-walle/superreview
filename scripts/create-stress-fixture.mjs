import { writeFileSync } from "node:fs";
const files = Array.from({ length: 1000 }, (_, i) => {
  const count = i === 0 ? 50050 : 50;
  return {
    path:
      i === 0 ? "src/generated/catalog.ts" : `src/features/area-${Math.floor(i / 20)}/file-${i}.ts`,
    status: "A",
    additions: count,
    deletions: 0,
    hunks: [
      {
        header: `@@ -0,0 +1,${count} @@`,
        oldStart: 0,
        newStart: 1,
        lines: Array.from({ length: count }, (_, j) => `+export const item_${i}_${j} = ${j};`),
      },
    ],
  };
});
if (!process.argv[2]) throw Error("Provide a temporary destination JSON path.");
writeFileSync(
  process.argv[2],
  JSON.stringify({
    repository: "stress-fixture",
    repositoryId: "superreview-stress-100k",
    branch: "performance-test",
    files,
  }),
);
console.log("Created 100,000 source lines across 1,000 files, including one 50,050-line chunk.");
