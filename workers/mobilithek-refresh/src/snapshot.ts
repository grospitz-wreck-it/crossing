import { getDb } from "./db.js";
import type { MobilithekTrainEvent } from "@crossing/db-api-client";

const BATCH_SIZE = 500;

type SnapshotEvent = {
  subscriptionId: string;
  event: MobilithekTrainEvent;
};

type SnapshotRow = {
  id: string;
  line: string;
  category: string;
  journey_number: string | null;
  journey_ref: string | null;
  origin: string | null;
  destination: string | null;
  route_json: string;
  calls_json: string;
  delay_minutes: number;
  actual_time: string;
  scheduled_time: string;
  direction: string | null;
  source_subscription_id: string;
  refreshed_at: string;
};

type ExistingSnapshotRow = Omit<SnapshotRow, "refreshed_at">;

function serializeCalls(calls: MobilithekTrainEvent["calls"]): string {
  return JSON.stringify(calls ?? [], (_, value) =>
    value instanceof Date ? value.toISOString() : value,
  );
}

function toSnapshotRow(
  subscriptionId: string,
  event: MobilithekTrainEvent,
  refreshedAt: string,
): SnapshotRow {
  // journeyRef is the stable identity of the dated journey. actualTime must
  // not be part of the key: as a train progresses, actualTime/scheduledTime
  // move to the next relevant stop and would otherwise turn one journey into
  // DELETE + INSERT on every refresh.
  const journeyIdentity = event.journeyRef || event.id;

  return {
    id: `${subscriptionId}:${journeyIdentity}`,
    line: event.line,
    category: event.category,
    journey_number: event.journeyNumber ?? null,
    journey_ref: event.journeyRef ?? null,
    origin: event.origin ?? null,
    destination: event.destination ?? null,
    route_json: JSON.stringify(event.route ?? []),
    calls_json: serializeCalls(event.calls),
    delay_minutes: event.delayMinutes ?? 0,
    actual_time: event.actualTime.toISOString(),
    scheduled_time: event.scheduledTime.toISOString(),
    direction: event.direction ?? null,
    source_subscription_id: subscriptionId,
    refreshed_at: refreshedAt,
  };
}

function sameSnapshotRow(
  existing: ExistingSnapshotRow,
  incoming: SnapshotRow,
): boolean {
  return (
    existing.line === incoming.line &&
    existing.category === incoming.category &&
    existing.journey_number === incoming.journey_number &&
    existing.journey_ref === incoming.journey_ref &&
    existing.origin === incoming.origin &&
    existing.destination === incoming.destination &&
    existing.route_json === incoming.route_json &&
    existing.calls_json === incoming.calls_json &&
    existing.delay_minutes === incoming.delay_minutes &&
    existing.actual_time === incoming.actual_time &&
    existing.scheduled_time === incoming.scheduled_time &&
    existing.direction === incoming.direction &&
    existing.source_subscription_id === incoming.source_subscription_id
  );
}

function upsertStatement(row: SnapshotRow) {
  return {
    sql: `
      INSERT INTO mobilithek_train_snapshot (
        id,
        line,
        category,
        journey_number,
        journey_ref,
        origin,
        destination,
        route_json,
        calls_json,
        delay_minutes,
        actual_time,
        scheduled_time,
        direction,
        source_subscription_id,
        refreshed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        line = excluded.line,
        category = excluded.category,
        journey_number = excluded.journey_number,
        journey_ref = excluded.journey_ref,
        origin = excluded.origin,
        destination = excluded.destination,
        route_json = excluded.route_json,
        calls_json = excluded.calls_json,
        delay_minutes = excluded.delay_minutes,
        actual_time = excluded.actual_time,
        scheduled_time = excluded.scheduled_time,
        direction = excluded.direction,
        source_subscription_id = excluded.source_subscription_id,
        refreshed_at = excluded.refreshed_at
    `,
    args: [
      row.id,
      row.line,
      row.category,
      row.journey_number,
      row.journey_ref,
      row.origin,
      row.destination,
      row.route_json,
      row.calls_json,
      row.delay_minutes,
      row.actual_time,
      row.scheduled_time,
      row.direction,
      row.source_subscription_id,
      row.refreshed_at,
    ],
  };
}

export async function writeSnapshot(
  events: SnapshotEvent[],
  refreshStartedAt: string,
  stats: {
    subscriptionCount: number;
    successful: number;
    failed: number;
  },
) {
  const db = getDb();
  const refreshedAt = new Date().toISOString();

  const incoming = new Map<string, SnapshotRow>();
  for (const { subscriptionId, event } of events) {
    const row = toSnapshotRow(subscriptionId, event, refreshedAt);
    incoming.set(row.id, row);
  }

  const existingResult = await db.execute(`
    SELECT
      id,
      line,
      category,
      journey_number,
      journey_ref,
      origin,
      destination,
      route_json,
      calls_json,
      delay_minutes,
      actual_time,
      scheduled_time,
      direction,
      source_subscription_id
    FROM mobilithek_train_snapshot
  `);

  const existing = new Map<string, ExistingSnapshotRow>();
  for (const row of existingResult.rows as unknown as ExistingSnapshotRow[]) {
    existing.set(row.id, row);
  }

  const changed: SnapshotRow[] = [];
  for (const row of incoming.values()) {
    const previous = existing.get(row.id);
    if (!previous || !sameSnapshotRow(previous, row)) {
      changed.push(row);
    }
  }

  const deletedIds = [...existing.keys()].filter((id) => !incoming.has(id));

  const statements: Array<ReturnType<typeof upsertStatement> | {
    sql: string;
    args: string[];
  }> = [];

  for (const row of changed) {
    statements.push(upsertStatement(row));
  }

  for (const id of deletedIds) {
    statements.push({
      sql: "DELETE FROM mobilithek_train_snapshot WHERE id = ?",
      args: [id],
    });
  }

  for (let offset = 0; offset < statements.length; offset += BATCH_SIZE) {
    const chunk = statements.slice(offset, offset + BATCH_SIZE);
    await db.batch(chunk, "write");
    console.log(
      `[Mobilithek Worker] snapshot diff progress: ${Math.min(
        offset + chunk.length,
        statements.length,
      )}/${statements.length}`,
    );
  }

  await db.execute({
    sql: `
      INSERT INTO mobilithek_refresh_status (
        id,
        started_at,
        finished_at,
        status,
        subscription_count,
        successful_subscriptions,
        failed_subscriptions,
        event_count,
        error
      ) VALUES (1, ?, ?, 'success', ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        status = excluded.status,
        subscription_count = excluded.subscription_count,
        successful_subscriptions = excluded.successful_subscriptions,
        failed_subscriptions = excluded.failed_subscriptions,
        event_count = excluded.event_count,
        error = NULL
    `,
    args: [
      refreshStartedAt,
      refreshedAt,
      stats.subscriptionCount,
      stats.successful,
      stats.failed,
      events.length,
    ],
  });

  console.log(
    `[Mobilithek Worker] snapshot diff: incoming=${incoming.size} ` +
      `existing=${existing.size} changed=${changed.length} ` +
      `deleted=${deletedIds.length} unchanged=${incoming.size - changed.length}`,
  );
  console.log(
    `[Mobilithek Worker] snapshot written: ${events.length} events`,
  );
}
