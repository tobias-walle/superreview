import { readFile } from "node:fs/promises";

/** Instructions are packaged next to the executable, never loaded from the worktree. */
export async function readSkill(json: boolean) {
  const content = await readFile(new URL("./skill-data/review.md", import.meta.url), "utf8");
  return json ? JSON.stringify({ name: "superreview", content }) + "\n" : content;
}
