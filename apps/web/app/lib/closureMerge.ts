/**
 * Shared closure-merging policy.
 *
 * 45 seconds is the established default gap. Keep the policy in one place
 * so the live status and admin forecast cannot silently diverge.
 */
export const DEFAULT_CLOSURE_MERGE_GAP_SECONDS = 45;

const MIN_MERGE_GAP_SECONDS = 0;
const MAX_MERGE_GAP_SECONDS = 180;

/**
 * Resolve an optional per-crossing override. Until a validated learned value
 * is available, the established 45-second default remains authoritative.
 */
export function resolveClosureMergeGapSeconds(
  configuredGapSeconds?: unknown,
): number {
  const configured = Number(configuredGapSeconds);
  if (!Number.isFinite(configured)) {
    return DEFAULT_CLOSURE_MERGE_GAP_SECONDS;
  }

  return Math.min(
    MAX_MERGE_GAP_SECONDS,
    Math.max(MIN_MERGE_GAP_SECONDS, Math.round(configured)),
  );
}

export function shouldMergeClosures(
  previousEnd: Date,
  nextStart: Date,
  mergeGapSeconds = DEFAULT_CLOSURE_MERGE_GAP_SECONDS,
): boolean {
  return nextStart.getTime() <=
    previousEnd.getTime() + mergeGapSeconds * 1000;
}
