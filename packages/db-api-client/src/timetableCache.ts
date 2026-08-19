import { createClient } from "@libsql/client";

const dbUrl = process.env.TURSO_DATABASE_URL;
const dbToken = process.env.TURSO_AUTH_TOKEN;

const db = dbUrl && dbToken
  ? createClient({ url: dbUrl, authToken: dbToken })
  : null;

export type TimetableCacheKind = "plan" | "fchg";

function ttlFor(kind: TimetableCacheKind) {
  return kind === "fchg" ? 30_000 : 60_000;
}

function keyFor(kind: TimetableCacheKind, eva: string, slot: string) {
  return `${kind}:${String(eva).trim()}:${slot}`;
}

export async function getTimetableCache(
  kind: TimetableCacheKind,
  eva: string,
  slot: string
): Promise<string | null> {
  if (!db) return null;

  const key = keyFor(kind, eva, slot);
  const result = await db.execute({
    sql: `
      SELECT payload
      FROM db_timetable_cache
      WHERE cache_key = ?
        AND expires_at > datetime('now')
      LIMIT 1
    `,
    args: [key],
  });

  const payload = result.rows[0]?.payload;
  return payload == null ? null : String(payload);
}

export async function setTimetableCache(
  kind: TimetableCacheKind,
  eva: string,
  slot: string,
  payload: string
): Promise<void> {
  if (!db) return;

  const key = keyFor(kind, eva, slot);
  const expiresAt = new Date(Date.now() + ttlFor(kind)).toISOString().replace("T", " ").replace("Z", "");

  await db.execute({
    sql: `
      INSERT INTO db_timetable_cache
        (cache_key, kind, eva, slot, payload, expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload = excluded.payload,
        expires_at = excluded.expires_at,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [key, kind, String(eva).trim(), slot, payload, expiresAt],
  });
}

export async function cleanupTimetableCache(): Promise<void> {
  if (!db) return;

  await db.execute({
    sql: `
      DELETE FROM db_timetable_cache
      WHERE expires_at < datetime('now', '-2 days')
    `,
  });
}
