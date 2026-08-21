import { getDb } from "./db.js";

export async function ensureSchema() {
  const db = getDb();

  await db.batch(
    [
      {
        sql: `
          CREATE TABLE IF NOT EXISTS mobilithek_train_snapshot (
            id TEXT PRIMARY KEY,
            line TEXT NOT NULL,
            category TEXT NOT NULL,
            journey_number INTEGER,
            journey_ref TEXT,
            origin TEXT,
            destination TEXT,
            route_json TEXT NOT NULL,
            delay_minutes INTEGER NOT NULL DEFAULT 0,
            actual_time TEXT NOT NULL,
            scheduled_time TEXT NOT NULL,
            direction TEXT,
            source_subscription_id TEXT NOT NULL,
            refreshed_at TEXT NOT NULL
          )
        `,
        args: [],
      },
      {
        sql: `
          CREATE INDEX IF NOT EXISTS idx_mobilithek_train_actual_time
          ON mobilithek_train_snapshot(actual_time)
        `,
        args: [],
      },
      {
        sql: `
          CREATE INDEX IF NOT EXISTS idx_mobilithek_train_line
          ON mobilithek_train_snapshot(line)
        `,
        args: [],
      },
      {
        sql: `
          CREATE TABLE IF NOT EXISTS mobilithek_refresh_status (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            started_at TEXT,
            finished_at TEXT,
            status TEXT NOT NULL,
            subscription_count INTEGER NOT NULL DEFAULT 0,
            successful_subscriptions INTEGER NOT NULL DEFAULT 0,
            failed_subscriptions INTEGER NOT NULL DEFAULT 0,
            event_count INTEGER NOT NULL DEFAULT 0,
            error TEXT
          )
        `,
        args: [],
      },
    ],
    "write",
  );

  console.log("[Mobilithek Worker] Turso schema ready");
}
