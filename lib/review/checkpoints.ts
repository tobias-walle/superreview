import type { Checkpoint, Evidence } from "./types";
/** A commit ID is deliberately absent: only content and comparison evidence count. */
export function checkpointMatches(
  checkpoint: Checkpoint | undefined,
  evidence: Evidence | undefined,
  fingerprint: string,
) {
  return (
    !!checkpoint &&
    (evidence ? evidence.key === checkpoint.evidence?.key : checkpoint.fingerprint === fingerprint)
  );
}
export function canMarkAutomatically(
  checkpoint: Checkpoint | undefined,
  evidence: Evidence | undefined,
  fingerprint: string,
) {
  return (
    !checkpointMatches(checkpoint, evidence, fingerprint) ||
    (!checkpoint!.manual && !checkpoint!.viewed)
  );
}
