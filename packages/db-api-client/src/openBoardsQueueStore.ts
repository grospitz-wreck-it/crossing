import type { Client } from "@libsql/client";
import type { OpenBoardsQueueJob } from "./openBoardsScheduler";

export type ClaimedOpenBoardsJob = OpenBoardsQueueJob & {
  lockToken: string;
  consecutiveFailures: number;
};

type QueueRow = {
  job_key: string;
  direction: "arrivals" | "departures";
  eva_numbers_json: string;
  interval_ms: number;
  priority: number;
  consecutive_failures: number;
};

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * Reconcile the persistent queue with current active demand.
 * Jobs no longer required are deactivated, not deleted, so diagnostics remain.
 */
export async function syncOpenBoardsQueue(
  db: Client,
  jobs: OpenBoardsQueueJob[],
  now = new Date().toISOString(),
): Promise<void> {
  const statements = jobs.map((job) => ({
    sql: `
      INSERT INTO openboards_refresh_jobs (
        job_key, direction, eva_numbers_json, interval_ms, priority,
        is_active, next_due_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(job_key) DO UPDATE SET
        direction = excluded.direction,
        eva_numbers_json = excluded.eva_numbers_json,
        interval_ms = excluded.interval_ms,
        priority = excluded.priority,
        is_active = 1,
        updated_at = excluded.updated_at
    `,
    args: [
      job.jobKey,
      job.direction,
      JSON.stringify(job.evaNumbers),
      job.intervalMs,
      job.priority,
      now,
      now,
    ],
  }));

  if (statements.length) await db.batch(statements, "write");

  const activeKeys = jobs.map((job) => job.jobKey);
  if (!activeKeys.length) {
    await db.execute({
      sql: "UPDATE openboards_refresh_jobs SET is_active = 0, updated_at = ?",
      args: [now],
    });
    return;
  }

  await db.execute({
    sql: `UPDATE openboards_refresh_jobs
          SET is_active = 0, updated_at = ?
          WHERE job_key NOT IN (${placeholders(activeKeys.length)})`,
    args: [now, ...activeKeys],
  });
}

/**
 * Atomically claim one due job. A single UPDATE ... RETURNING statement makes
 * the claim safe across concurrent scheduler instances sharing the same DB.
 */
export async function claimNextOpenBoardsJob(
  db: Client,
  lockToken: string,
  now = new Date(),
  lockMs = 30_000,
): Promise<ClaimedOpenBoardsJob | null> {
  const nowIso = now.toISOString();
  const lockUntil = new Date(now.getTime() + Math.max(5_000, lockMs)).toISOString();
  const result = await db.execute({
    sql: `
      UPDATE openboards_refresh_jobs
      SET lock_token = ?, locked_until = ?, last_started_at = ?,
          last_status = 'running', updated_at = ?
      WHERE job_key = (
        SELECT job_key
        FROM openboards_refresh_jobs
        WHERE is_active = 1
          AND next_due_at <= ?
          AND (locked_until IS NULL OR locked_until <= ?)
        ORDER BY priority ASC, next_due_at ASC, job_key ASC
        LIMIT 1
      )
      AND is_active = 1
      AND (locked_until IS NULL OR locked_until <= ?)
      RETURNING job_key, direction, eva_numbers_json, interval_ms,
                priority, consecutive_failures
    `,
    args: [lockToken, lockUntil, nowIso, nowIso, nowIso, nowIso, nowIso],
  });

  const row = result.rows[0] as unknown as QueueRow | undefined;
  if (!row) return null;

  let evaNumbers: string[];
  try {
    const parsed = JSON.parse(row.eva_numbers_json);
    evaNumbers = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    evaNumbers = [];
  }

  return {
    jobKey: row.job_key,
    direction: row.direction,
    evaNumbers,
    intervalMs: row.interval_ms,
    priority: row.priority,
    consecutiveFailures: row.consecutive_failures,
    lockToken,
  };
}

/**
 * Reserve one account-wide OpenBoards request slot. The row update is atomic,
 * so concurrent workers cannot each maintain their own independent rate cap.
 * Returns the timestamp at which the caller may send its request.
 */
export async function reserveOpenBoardsRequestSlot(
  db: Client,
  nowMs = Date.now(),
  minIntervalMs = 150,
): Promise<number> {
  const interval = Math.max(125, Math.floor(minIntervalMs));
  const result = await db.execute({
    sql: `
      UPDATE openboards_scheduler_state
      SET next_request_at_ms = MAX(next_request_at_ms, ?) + ?,
          updated_at = datetime('now')
      WHERE id = 1
      RETURNING next_request_at_ms - ? AS reserved_at_ms
    `,
    args: [nowMs, interval, interval],
  });
  const row = result.rows[0] as unknown as { reserved_at_ms?: number } | undefined;
  if (!row || !Number.isFinite(Number(row.reserved_at_ms))) {
    throw new Error("OpenBoards global rate limiter state is missing");
  }
  return Number(row.reserved_at_ms);
}

export async function finishOpenBoardsJob(
  db: Client,
  job: ClaimedOpenBoardsJob,
  outcome: { ok: true } | { ok: false; error: string },
  finishedAt = new Date(),
): Promise<void> {
  const finishedIso = finishedAt.toISOString();
  if (outcome.ok) {
    await db.execute({
      sql: `
        UPDATE openboards_refresh_jobs
        SET next_due_at = ?, last_finished_at = ?, last_status = 'success',
            consecutive_failures = 0, locked_until = NULL, lock_token = NULL,
            last_error = NULL, updated_at = ?
        WHERE job_key = ? AND lock_token = ?
      `,
      args: [
        new Date(finishedAt.getTime() + job.intervalMs).toISOString(),
        finishedIso,
        finishedIso,
        job.jobKey,
        job.lockToken,
      ],
    });
    return;
  }

  const failures = job.consecutiveFailures + 1;
  const backoffMs = Math.min(15 * 60_000, 30_000 * (2 ** Math.min(5, failures - 1)));
  await db.execute({
    sql: `
      UPDATE openboards_refresh_jobs
      SET next_due_at = ?, last_finished_at = ?, last_status = 'error',
          consecutive_failures = ?, locked_until = NULL, lock_token = NULL,
          last_error = ?, updated_at = ?
      WHERE job_key = ? AND lock_token = ?
    `,
    args: [
      new Date(finishedAt.getTime() + backoffMs).toISOString(),
      finishedIso,
      failures,
      outcome.error.slice(0, 2000),
      finishedIso,
      job.jobKey,
      job.lockToken,
    ],
  });
}
