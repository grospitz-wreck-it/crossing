import { createClient } from "@libsql/client";

const DEFAULT_LIMIT = 60;
const MIN_LIMIT = 1;
const MAX_LIMIT = 60;
const WINDOW_MS = 60_000;

const dbUrl = process.env.TURSO_DATABASE_URL;
const dbToken = process.env.TURSO_AUTH_TOKEN;

const db = dbUrl && dbToken
  ? createClient({ url: dbUrl, authToken: dbToken })
  : null;

function getLimit() {
  const configured = Number(process.env.DB_API_RATE_LIMIT_PER_MINUTE ?? DEFAULT_LIMIT);
  if (!Number.isFinite(configured)) return DEFAULT_LIMIT;
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, Math.floor(configured)));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Global sliding-window limiter for the DB Timetables API.
 *
 * The reservation itself is written to Turso inside a WRITE transaction, so
 * multiple Vercel instances cannot reserve the same slot concurrently.
 * A request is counted before the external API call starts: a failed DB API
 * request still consumed a quota slot and therefore must count.
 */
export async function acquireDbApiSlot(meta: {
  eva?: string;
  requestType: string;
}) {
  if (!db) {
    throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN fehlen für den DB-API-Rate-Limiter.");
  }

  const limit = getLimit();

  while (true) {
    const tx = await db.transaction("write");
    let waitMs = 500;

    try {
      const result = await tx.execute({
        sql: `
          SELECT
            COUNT(*) AS request_count,
            MIN(created_at) AS oldest_request
          FROM api_usage_log
          WHERE api_name = 'db-timetables'
            AND cache_hit = 0
            AND created_at >= datetime('now', '-60 seconds')
        `,
      });

      const row = result.rows[0] as Record<string, unknown> | undefined;
      const count = asNumber(row?.request_count);

      if (count < limit) {
        await tx.execute({
          sql: `
            INSERT INTO api_usage_log
              (api_name, eva, request_type, cache_hit)
            VALUES (?, ?, ?, 0)
          `,
          args: [
            "db-timetables",
            meta.eva ?? null,
            meta.requestType,
          ],
        });

        await tx.commit();
        return;
      }

      const oldest = row?.oldest_request
        ? new Date(String(row.oldest_request)).getTime()
        : Date.now();

      waitMs = Math.max(250, Math.min(2_000, oldest + WINDOW_MS - Date.now() + 50));
      await tx.rollback();
    } finally {
      tx.close();
    }

    await sleep(waitMs);
  }
}

export async function getDbApiUsage() {
  if (!db) {
    throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN fehlen für den DB-API-Counter.");
  }

  // One index-backed scan from local midnight replaces several independent
  // COUNT(*) subqueries over the full usage history.
  const result = await db.execute({
    sql: `
      SELECT
        SUM(CASE
          WHEN cache_hit = 0 AND created_at >= datetime('now', '-60 seconds')
          THEN 1 ELSE 0
        END) AS current_window,
        SUM(CASE
          WHEN cache_hit = 0 AND created_at >= datetime('now', '-60 minutes')
          THEN 1 ELSE 0
        END) AS last_hour,
        SUM(CASE WHEN cache_hit = 0 THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) AS cache_hits_today,
        MIN(CASE
          WHEN cache_hit = 0 AND created_at >= datetime('now', '-60 seconds')
          THEN created_at
        END) AS oldest_request
      FROM api_usage_log
      WHERE api_name = 'db-timetables'
        AND created_at >= datetime('now', 'localtime', 'start of day', 'utc')
    `,
  });

  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  const limit = getLimit();
  const current = asNumber(row.current_window);

  // Keep the EVA breakdown for the dedicated API details screen. The
  // composite index in 010_api_usage_log_indexes.sql makes this a bounded
  // 24-hour range scan rather than a full-table scan.
  const evaResult = await db.execute({
    sql: `
      SELECT eva, COUNT(*) AS requests
      FROM api_usage_log
      WHERE api_name = 'db-timetables'
        AND cache_hit = 0
        AND created_at >= datetime('now', '-24 hours')
        AND eva IS NOT NULL
      GROUP BY eva
      ORDER BY requests DESC
      LIMIT 25
    `,
  });

  return {
    limitPerMinute: limit,
    currentWindow: current,
    remaining: Math.max(0, limit - current),
    utilizationPercent: Math.round((current / limit) * 1000) / 10,
    lastHour: asNumber(row.last_hour),
    today: asNumber(row.today),
    cacheHitsToday: asNumber(row.cache_hits_today),
    oldestRequest: row.oldest_request ? String(row.oldest_request) : null,
    byEva: evaResult.rows.map((item) => ({
      eva: item.eva ? String(item.eva) : null,
      requests: asNumber(item.requests),
    })),
  };
}
