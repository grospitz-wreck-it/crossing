import { db } from "./db";

let schemaPromise: Promise<void> | null = null;

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    try {
      await db.execute("ALTER TABLE crossings ADD COLUMN osm_route_json TEXT");
    } catch {
      // Column already exists on installations that have been migrated.
    }

    await db.execute(`
      CREATE TABLE IF NOT EXISTS crossing_forecast_cache (
        crossing_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        generated_at INTEGER NOT NULL
      )
    `);
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

/*
 * Write-blocked development environment:
 *
 * During the Turso write-limit period, cache reads must not trigger
 * schema creation/migration writes. The actual cache table will be
 * created normally again once writes are available.
 */
const TURSO_WRITES_BLOCKED =
  process.env.TURSO_WRITES_BLOCKED === "true";

export async function readCrossingForecastCache<T>(crossingId: string, maxAgeMs: number): Promise<T | null> {
  try {
    if (TURSO_WRITES_BLOCKED) return null;

    await ensureSchema();
    const result = await db.execute({
      sql: `SELECT payload, generated_at FROM crossing_forecast_cache WHERE crossing_id = ? LIMIT 1`,
      args: [crossingId],
    });
    const row: any = result.rows[0];
    if (!row) return null;
    const generatedAt = Number(row.generated_at || 0);
    if (!generatedAt || Date.now() - generatedAt > maxAgeMs) return null;
    return JSON.parse(String(row.payload)) as T;
  } catch (error) {
    console.warn("Failed to read crossing forecast cache:", error);
    return null;
  }
}

export async function writeCrossingForecastCache(crossingId: string, payload: unknown): Promise<void> {
  try {
    await ensureSchema();
    await db.execute({
      sql: `INSERT INTO crossing_forecast_cache (crossing_id, payload, generated_at) VALUES (?, ?, ?) ON CONFLICT(crossing_id) DO UPDATE SET payload = excluded.payload, generated_at = excluded.generated_at`,
      args: [crossingId, JSON.stringify(payload), Date.now()],
    });
  } catch (error) {
    console.warn("Failed to write crossing forecast cache:", error);
  }
}

export async function loadCrossingOsmRoute(crossingId: string): Promise<any | null> {
  try {
    await ensureSchema();
    const result = await db.execute({
      sql: `SELECT osm_route_json FROM crossings WHERE id = ? LIMIT 1`,
      args: [crossingId],
    });
    const value = result.rows[0] as any;
    if (!value?.osm_route_json) return null;
    return JSON.parse(String(value.osm_route_json));
  } catch (error) {
    console.warn("Failed to load crossing OSM route:", error);
    return null;
  }
}
