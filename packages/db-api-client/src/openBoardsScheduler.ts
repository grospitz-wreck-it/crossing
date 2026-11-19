/**
 * Pure planning helpers for the persistent OpenBoards refresh queue.
 *
 * This module does not perform network requests or database writes.
 * Queue persistence and distributed claiming are deliberately handled by
 * the dedicated refresh runner, not by Vercel request handlers.
 */

export type OpenBoardsDirection = "arrivals" | "departures";

export type OpenBoardsQueueJob = {
  jobKey: string;
  direction: OpenBoardsDirection;
  evaNumbers: string[];
  intervalMs: number;
  priority: number;
};

export type OpenBoardsQueueDemand = {
  crossingId: string;
  evaNumbers: string[];
  intervalMs?: number;
  priority?: number;
};

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_PRIORITY = 100;
const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 20;

function uniqueSortedEvas(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "en"));
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function stableJobKey(direction: OpenBoardsDirection, evas: string[]): string {
  // EVA lists are sorted before key generation, so identical demand from
  // different crossings collapses to the same persistent queue job.
  return `openboards:${direction}:${evas.join(",")}`;
}

/**
 * Build globally deduplicated jobs from all active crossing demand.
 *
 * Same EVA sets are merged across crossings. Each direction is a separate
 * request because OpenBoards exposes separate arrivals/departures endpoints.
 * The default batch size remains conservative until DB confirms a maximum.
 */
export function buildOpenBoardsQueueJobs(
  demand: OpenBoardsQueueDemand[],
  options: { batchSize?: number; defaultIntervalMs?: number } = {},
): OpenBoardsQueueJob[] {
  const requestedBatchSize = Number(options.batchSize ?? DEFAULT_BATCH_SIZE);
  const batchSize = Number.isFinite(requestedBatchSize)
    ? Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(requestedBatchSize)))
    : DEFAULT_BATCH_SIZE;
  const defaultIntervalMs = Math.max(
    5_000,
    Math.floor(Number(options.defaultIntervalMs ?? DEFAULT_INTERVAL_MS)),
  );

  const evaMeta = new Map<string, { intervalMs: number; priority: number }>();
  for (const item of demand) {
    const intervalMs = Math.max(5_000, Math.floor(Number(item.intervalMs ?? defaultIntervalMs)));
    const priority = Math.floor(Number(item.priority ?? DEFAULT_PRIORITY));
    for (const eva of uniqueSortedEvas(item.evaNumbers || [])) {
      const previous = evaMeta.get(eva);
      evaMeta.set(eva, previous
        ? {
            intervalMs: Math.min(previous.intervalMs, intervalMs),
            priority: Math.min(previous.priority, priority),
          }
        : { intervalMs, priority });
    }
  }

  const allEvas = [...evaMeta.keys()].sort((a, b) => a.localeCompare(b, "en"));
  const jobs: OpenBoardsQueueJob[] = [];

  for (const direction of ["arrivals", "departures"] as const) {
    for (const batch of chunks(allEvas, batchSize)) {
      const meta = batch.reduce(
        (acc, eva) => ({
          intervalMs: Math.min(acc.intervalMs, evaMeta.get(eva)!.intervalMs),
          priority: Math.min(acc.priority, evaMeta.get(eva)!.priority),
        }),
        { intervalMs: Number.MAX_SAFE_INTEGER, priority: Number.MAX_SAFE_INTEGER },
      );
      jobs.push({
        jobKey: stableJobKey(direction, batch),
        direction,
        evaNumbers: batch,
        intervalMs: meta.intervalMs,
        priority: meta.priority,
      });
    }
  }

  return jobs.sort((a, b) =>
    a.priority - b.priority ||
    a.direction.localeCompare(b.direction) ||
    a.jobKey.localeCompare(b.jobKey),
  );
}

/**
 * Distribute initial due times across a scheduling window. This prevents a
 * newly activated region from firing every station request at once.
 */
export function staggerOpenBoardsJobs(
  jobs: OpenBoardsQueueJob[],
  nowMs = Date.now(),
  windowMs = 60_000,
): Array<OpenBoardsQueueJob & { nextDueAt: string }> {
  if (!jobs.length) return [];
  const safeWindow = Math.max(1, Math.floor(windowMs));
  const ordered = [...jobs].sort((a, b) =>
    a.priority - b.priority || a.jobKey.localeCompare(b.jobKey),
  );
  const slotMs = Math.max(1, Math.floor(safeWindow / ordered.length));

  return ordered.map((job, index) => ({
    ...job,
    nextDueAt: new Date(nowMs + Math.min(safeWindow - 1, index * slotMs)).toISOString(),
  }));
}
