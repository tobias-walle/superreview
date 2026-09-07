// Explicit decisions win over automatic visibility until this content changes.
export function recordDecision(records, fingerprint, viewed) {
  return { ...records, [fingerprint]: { viewed, manual: true } };
}
export function recordAutomatic(records, fingerprint) {
  if (records[fingerprint]?.manual || records[fingerprint]?.viewed) return records;
  return { ...records, [fingerprint]: { viewed: true, manual: false } };
}
export function addCoverage(ranges, start, end) {
  const result = [];
  for (const [a, b] of [...ranges, [Math.max(0, start), Math.min(1, end)]].sort(
    (a, b) => a[0] - b[0],
  )) {
    const last = result.at(-1);
    if (last && a <= last[1] + 0.002) last[1] = Math.max(last[1], b);
    else result.push([a, b]);
  }
  return result;
}
export function coverageComplete(ranges) {
  return ranges.length === 1 && ranges[0][0] <= 0.002 && ranges[0][1] >= 0.998;
}
