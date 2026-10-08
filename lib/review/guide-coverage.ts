import type { Snapshot } from "./types";
import type { GuideFileMarker, GuideInterval, GuideInventory } from "./guide";

export function unionGuideIntervals(intervals: readonly GuideInterval[]): GuideInterval[] {
  const sorted = intervals.map((interval) => ({ ...interval })).sort((a, b) => a.start - b.start);
  const result: GuideInterval[] = [];
  for (const interval of sorted) {
    const previous = result.at(-1);
    if (previous && interval.start <= previous.end + 1)
      previous.end = Math.max(previous.end, interval.end);
    else result.push(interval);
  }
  return result;
}

function appendLine(intervals: GuideInterval[], line: number) {
  const previous = intervals.at(-1);
  if (previous && previous.end + 1 === line) previous.end = line;
  else intervals.push({ start: line, end: line });
}

/** Build the denominator directly from immutable diff rows and version evidence.
 * Since-reviewed projections omit changes or replace the old side and cannot be
 * used as a complete guide inventory. Legacy captures can be inspected, but the
 * publication boundary must require explicit full provenance before publishing.
 */
export function guideInventory(snapshot: Snapshot): GuideInventory {
  if (snapshot.captureView === "since-reviewed")
    throw new Error(
      "Guide inventory requires a full capture. Recapture with the full view, not Since reviewed.",
    );
  const paths = new Set(snapshot.data.files.map((file) => file.path));
  if (paths.size !== snapshot.data.files.length)
    throw new Error("Snapshot contains duplicate file paths");
  for (const path of Object.keys(snapshot.evidence)) {
    if (!paths.has(path))
      throw new Error(
        `Snapshot diff omits captured evidence for ${path}. Recapture a full snapshot.`,
      );
  }
  return {
    snapshotId: snapshot.id,
    files: snapshot.data.files.map((file, fileIndex) => {
      const evidence = snapshot.evidence[file.path];
      if (!evidence) throw new Error(`Snapshot has no content evidence for ${file.path}`);
      if (
        file.sourceObjects &&
        (file.sourceObjects.old !== evidence.before.object ||
          file.sourceObjects.new !== evidence.after.object)
      )
        throw new Error(
          `Snapshot diff does not match full content evidence for ${file.path}. Recapture a full snapshot.`,
        );
      const old: GuideInterval[] = [];
      const added: GuideInterval[] = [];
      for (const hunk of file.hunks) {
        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;
        for (const line of hunk.lines) {
          if (line.startsWith("\\")) continue;
          if (line.startsWith("-")) appendLine(old, oldLine);
          if (line.startsWith("+")) appendLine(added, newLine);
          if (!line.startsWith("+")) oldLine++;
          if (!line.startsWith("-")) newLine++;
        }
      }
      const markers: GuideFileMarker[] = [];
      if (evidence.before.object === null) markers.push("added");
      if (evidence.after.object === null) markers.push("deleted");
      if (evidence.before.mode !== evidence.after.mode) markers.push("mode");
      if (file.binary) markers.push("binary");
      if (evidence.before.mode === "160000" || evidence.after.mode === "160000")
        markers.push("submodule");
      // Preserve any content change with no textual rows, including empty files
      // and future non-text formats, rather than allowing it out of the denominator.
      if (!old.length && !added.length && evidence.before.object !== evidence.after.object)
        markers.push("non-text");
      return {
        path: file.path,
        fileIndex,
        fingerprint: file.fingerprint,
        evidence,
        old: unionGuideIntervals(old),
        new: unionGuideIntervals(added),
        markers,
      };
    }),
  };
}
