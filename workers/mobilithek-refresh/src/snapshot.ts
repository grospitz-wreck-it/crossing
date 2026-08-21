import { getDb } from "./db.js";
import type { MobilithekTrainEvent } from "@crossing/db-api-client";

const BATCH_SIZE = 500;

type SnapshotEvent = {
  subscriptionId: string;
  event: MobilithekTrainEvent;
};

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

  // Alte Snapshot-Daten nur einmal am Anfang entfernen.
  await db.execute("DELETE FROM mobilithek_train_snapshot");

  let written = 0;

  for (let offset = 0; offset < events.length; offset += BATCH_SIZE) {
    const chunk = events.slice(offset, offset + BATCH_SIZE);

    const statements = chunk.map(({ subscriptionId, event }) => ({
      sql: `
        INSERT OR IGNORE INTO mobilithek_train_snapshot (
          id,
          line,
          category,
          journey_number,
          journey_ref,
          origin,
          destination,
          route_json,
          delay_minutes,
          actual_time,
          scheduled_time,
          direction,
          source_subscription_id,
          refreshed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        `${subscriptionId}:${event.id}:${event.actualTime.getTime()}:${event.journeyRef}`,
        event.line,
        event.category,
        event.journeyNumber,
        event.journeyRef,
        event.origin ?? null,
        event.destination ?? null,
        JSON.stringify(event.route ?? []),
        event.delayMinutes ?? 0,
        event.actualTime.toISOString(),
        event.scheduledTime.toISOString(),
        event.direction ?? null,
        subscriptionId,
        refreshedAt,
      ],
    }));

    await db.batch(statements, "write");

    written += chunk.length;

    console.log(
      `[Mobilithek Worker] snapshot progress: ${written}/${events.length}`,
    );
  }

  // Erst wenn ALLE Snapshot-Chunks erfolgreich geschrieben wurden,
  // markieren wir den Refresh als erfolgreich.
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
    `[Mobilithek Worker] snapshot written: ${events.length} events`,
  );
}
