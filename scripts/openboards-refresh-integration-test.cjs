const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const { createClient } = require("@libsql/client");
const {
  syncOpenBoardsQueue,
  claimNextOpenBoardsJob,
  reserveOpenBoardsRequestSlot,
  finishOpenBoardsJob,
} = require("../.tmp/openboards-test/openBoardsQueueStore.js");
const { buildOpenBoardsQueueJobs } = require("../.tmp/openboards-test/openBoardsScheduler.js");
const { readFile } = require("node:fs/promises");

async function main() {
  const db = createClient({ url: "file::memory:" });
  const metrics = {
    sqlOperations: 0,
    changedRows: 0,
    queueSyncChangedRows: 0,
    observationsInserted: 0,
    observationsUpdated: 0,
    observationsDeleted: 0,
  };

  const execute = async (statement) => {
    metrics.sqlOperations += 1;
    const result = await db.execute(statement);
    metrics.changedRows += result.rowsAffected || 0;
    return result;
  };

  try {
    for (const migration of [
      "packages/db-api-client/sql/008_openboards_scheduler.sql",
      "packages/db-api-client/sql/009_openboards_observations.sql",
    ]) {
      await db.executeMultiple(await readFile(migration, "utf8"));
    }

    // Use the real scheduler and queue-store modules, not copied SQL.
    const jobs = buildOpenBoardsQueueJobs([
      { crossingId: "crossing-a", evaNumbers: ["8000105", "8000207"], intervalMs: 120000, priority: 10 },
      { crossingId: "crossing-b", evaNumbers: ["8000105"], intervalMs: 600000, priority: 100 },
    ], { batchSize: 5 });

    const syncBefore = metrics.changedRows;
    await syncOpenBoardsQueue(db, jobs, "2026-11-20T10:00:00.000Z");
    metrics.queueSyncChangedRows += metrics.changedRows - syncBefore;
    assert(jobs.length === 2, "Expected one deduplicated EVA batch for each direction");

    const unchangedBefore = metrics.changedRows;
    await syncOpenBoardsQueue(db, jobs, "2026-11-20T10:00:01.000Z");
    assert(metrics.changedRows === unchangedBefore, "Unchanged queue reconciliation changed database rows");

    const dueAt = new Date("2026-11-20T10:01:00.000Z");
    const claimed = await claimNextOpenBoardsJob(db, "integration-lock-1", dueAt);
    assert(claimed, "Expected one due queue job to be claimed");
    assert(claimed.lockToken === "integration-lock-1", "Claim lock token mismatch");
    assert(claimed.evaNumbers.length > 0, "Claimed job has no EVAs");

    const firstSlot = await reserveOpenBoardsRequestSlot(db, 1000, 150);
    const secondSlot = await reserveOpenBoardsRequestSlot(db, 1000, 150);
    assert(secondSlot - firstSlot === 150, "Global request slot spacing is not 150ms");

    // Exercise the same observation UPSERT and pruning pattern as the Worker.
    const stamp = "2026-11-20T10:01:00.000Z";
    const observation = {
      key: "journey-1|8000105|arrivals",
      journey: "journey-1",
      eva: "8000105",
      direction: "arrivals",
    };
    const upsertSql = `
      INSERT INTO openboards_observations (
        observation_key, journey_id, eva_number, direction, event_time,
        scheduled_time, time_type, line, category, journey_number,
        origin_eva, destination_eva, via_evas_json, route_evas_json,
        route_names_json, platform, cancelled, observed_at, expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(observation_key) DO UPDATE SET
        event_time = excluded.event_time,
        scheduled_time = excluded.scheduled_time,
        time_type = excluded.time_type,
        line = excluded.line,
        category = excluded.category,
        journey_number = excluded.journey_number,
        origin_eva = excluded.origin_eva,
        destination_eva = excluded.destination_eva,
        via_evas_json = excluded.via_evas_json,
        route_evas_json = excluded.route_evas_json,
        route_names_json = excluded.route_names_json,
        platform = excluded.platform,
        cancelled = excluded.cancelled,
        observed_at = excluded.observed_at,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `;
    const observationArgs = [
      observation.key, observation.journey, observation.eva, observation.direction,
      stamp, null, "REAL", "RE", "train", 1, "8000001", "8000999",
      "[]", '["8000001","8000105","8000999"]', "[]", "2", 0,
      stamp, "2026-11-20T11:01:00.000Z", stamp,
    ];

    let result = await execute({ sql: upsertSql, args: observationArgs });
    assert(result.rowsAffected === 1, "Initial observation UPSERT did not insert one row");
    metrics.observationsInserted += result.rowsAffected;

    const refreshedAt = "2026-11-20T10:02:00.000Z";
    observationArgs[17] = refreshedAt;
    observationArgs[18] = "2026-11-20T11:02:00.000Z";
    observationArgs[19] = refreshedAt;
    result = await execute({ sql: upsertSql, args: observationArgs });
    assert(result.rowsAffected === 1, "Refresh UPSERT did not update the existing observation");
    metrics.observationsUpdated += result.rowsAffected;

    await execute({
      sql: `INSERT INTO openboards_observations (
        observation_key, journey_id, eva_number, direction, event_time,
        observed_at, expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["stale|8000105|arrivals", "stale", "8000105", "arrivals", stamp, stamp, "2026-11-20T11:00:00.000Z", stamp],
    });
    await execute({
      sql: `INSERT INTO openboards_observations (
        observation_key, journey_id, eva_number, direction, event_time,
        observed_at, expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["other|8000207|arrivals", "other", "8000207", "arrivals", stamp, stamp, "2026-11-20T11:00:00.000Z", stamp],
    });

    result = await execute({
      sql: `DELETE FROM openboards_observations
            WHERE direction = ?
              AND eva_number IN (?)
              AND observation_key NOT IN (SELECT value FROM json_each(?))`,
      args: ["arrivals", "8000105", JSON.stringify([observation.key])],
    });
    assert(result.rowsAffected === 1, "Pruning should delete only the stale observation for the requested EVA");
    metrics.observationsDeleted += result.rowsAffected;

    await execute({
      sql: `INSERT INTO openboards_refresh_runs
        (job_key, direction, eva_numbers_json, requested_at, completed_at, status, observation_count)
        VALUES (?, ?, ?, ?, ?, 'success', ?)`,
      args: [claimed.jobKey, claimed.direction, JSON.stringify(claimed.evaNumbers), stamp, refreshedAt, 1],
    });

    await finishOpenBoardsJob(db, claimed, { ok: true }, new Date(refreshedAt));
    const queueState = await db.execute({
      sql: "SELECT last_status, consecutive_failures, lock_token FROM openboards_refresh_jobs WHERE job_key = ?",
      args: [claimed.jobKey],
    });
    assert(queueState.rows[0]?.last_status === "success", "Job was not marked successful");
    assert(Number(queueState.rows[0]?.consecutive_failures) === 0, "Successful job did not reset failure count");
    assert(queueState.rows[0]?.lock_token == null, "Successful job lock was not released");

    const observationCount = await db.execute("SELECT COUNT(*) AS count FROM openboards_observations");
    assert(Number(observationCount.rows[0]?.count) === 2, "Unexpected remaining observation count");

    console.log("OpenBoards refresh integration flow OK");
    console.log(JSON.stringify({
      ...metrics,
      queueJobsCreated: jobs.length,
      requestSlotSpacingMs: secondSlot - firstSlot,
      observationsRemaining: Number(observationCount.rows[0].count),
      successfulRunLogs: 1,
    }, null, 2));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
