import { getDb } from "./db.js";
import type { MobilithekTrainEvent } from "@crossing/db-api-client";

export async function writeSnapshot(
  events: Array<{
    subscriptionId: string;
    event: MobilithekTrainEvent;
  }>,
  refreshStartedAt: string,
) {
  const db = getDb();
  const refreshedAt = new Date().toISOString();

  const statements = [
    {
      sql: "DELETE FROM mobilithek_train_snapshot",
      args: [],
    },
    ...events.map(({ subscriptionId, event }) => ({
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
    })),
  ];

  await db.batch(statements, "write");

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
      ) VALUES (1, ?, ?, 'success', 0, 0, 0, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        status = excluded.status,
        event_count = excluded.event_count,
        error = NULL
    `,
    args: [
      refreshStartedAt,
      refreshedAt,
      events.length,
    ],
  });

  console.log(
    `[Mobilithek Worker] snapshot written: ${events.length} events`,
  );
}
