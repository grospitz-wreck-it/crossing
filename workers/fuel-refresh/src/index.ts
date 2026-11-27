import { createClient, type Client } from "@libsql/client/web";

export interface Env {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  TANKERKOENIG_API_KEY: string;
  FUEL_REFRESH_RUN_TOKEN?: string;
}

type FuelType = "e5" | "e10" | "diesel";
type TankerStation = {
  id: string;
  name?: string;
  brand?: string;
  street?: string;
  houseNumber?: string;
  postCode?: string | number;
  place?: string;
  lat?: number;
  lng?: number;
  dist?: number;
  isOpen?: boolean;
  e5?: number | false;
  e10?: number | false;
  diesel?: number | false;
};
type RefreshTask =
  | { kind: "discovery"; crossingId: string; lat: number; lon: number }
  | { kind: "prices"; stationIds: string[] };

const MIN_API_INTERVAL_MS = 60_000;
const DISCOVERY_INTERVAL_MS = 7 * 24 * 60 * 60_000;
const EMPTY_DISCOVERY_RETRY_MS = 24 * 60 * 60_000;
const PRICE_REFRESH_INTERVAL_MS = 20 * 60_000;
const ERROR_RETRY_MS = 10 * 60_000;
const MAX_STATIONS_PER_PRICE_REQUEST = 10;
const MAX_BATCH_STATEMENTS = 100;

let dbClient: Client | null = null;
let configuredDbKey = "";

function getDb(env: Env): Client {
  const url = env.TURSO_DATABASE_URL?.trim();
  const authToken = env.TURSO_AUTH_TOKEN?.trim();
  if (!url || !authToken) throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN fehlen");

  const key = url + ":" + authToken;
  if (!dbClient || configuredDbKey !== key) {
    dbClient = createClient({ url, authToken });
    configuredDbKey = key;
  }
  return dbClient;
}

function direction(fromLat: number, fromLon: number, toLat: number, toLon: number): string {
  const radians = (value: number) => value * Math.PI / 180;
  const y = Math.sin(radians(toLon - fromLon)) * Math.cos(radians(toLat));
  const x = Math.cos(radians(fromLat)) * Math.sin(radians(toLat)) -
    Math.sin(radians(fromLat)) * Math.cos(radians(toLat)) * Math.cos(radians(toLon - fromLon));
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return ["N", "NO", "O", "SO", "S", "SW", "W", "NW"][Math.round(bearing / 45) % 8];
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function statement(sql: string, args: (string | number | null)[]) {
  return { sql, args };
}

async function saveRefreshState(
  db: Client,
  scopeType: "crossing" | "prices",
  scopeId: string,
  now: number,
  nextAttemptAt: number,
  errorMessage: string | null = null,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO fuel_refresh_state
      (scope_type, scope_id, last_attempt_at, last_success_at, next_attempt_at, error_message, cursor_value, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        last_attempt_at = excluded.last_attempt_at,
        last_success_at = CASE WHEN excluded.error_message IS NULL THEN excluded.last_success_at ELSE fuel_refresh_state.last_success_at END,
        next_attempt_at = excluded.next_attempt_at,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at`,
    args: [scopeType, scopeId, now, errorMessage ? null : now, nextAttemptAt, errorMessage, now],
  });
}

async function findTask(db: Client, now: number): Promise<RefreshTask | null> {
  const discovery = await db.execute({
    sql: `SELECT pc.crossing_id, c.lat, c.lon
      FROM fuel_pilot_crossings pc
      JOIN crossings c ON c.id = pc.crossing_id
      LEFT JOIN fuel_refresh_state rs
        ON rs.scope_type = 'crossing' AND rs.scope_id = pc.crossing_id
      WHERE pc.enabled = 1
        AND c.status = 'active'
        AND c.lat IS NOT NULL
        AND c.lon IS NOT NULL
        AND (rs.scope_id IS NULL OR rs.next_attempt_at <= ?)
      ORDER BY COALESCE(rs.last_success_at, 0) ASC, pc.crossing_id ASC
      LIMIT 1`,
    args: [now],
  });
  const crossing = discovery.rows[0] as Record<string, unknown> | undefined;
  if (crossing) {
    const lat = Number(crossing.lat);
    const lon = Number(crossing.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { kind: "discovery", crossingId: String(crossing.crossing_id), lat, lon };
    }
  }

  const prices = await db.execute({
    sql: `SELECT s.id
      FROM fuel_stations s
      LEFT JOIN fuel_refresh_state rs
        ON rs.scope_type = 'prices' AND rs.scope_id = s.id
      WHERE rs.scope_id IS NULL OR rs.next_attempt_at <= ?
      ORDER BY COALESCE(rs.last_success_at, 0) ASC, s.last_seen_at ASC
      LIMIT ?`,
    args: [now, MAX_STATIONS_PER_PRICE_REQUEST],
  });
  const stationIds = prices.rows.map((row) => String((row as Record<string, unknown>).id)).filter(Boolean);
  return stationIds.length ? { kind: "prices", stationIds } : null;
}

async function discoverStations(
  db: Client,
  task: Extract<RefreshTask, { kind: "discovery" }>,
  apiKey: string,
  now: number,
): Promise<{ discovered: number }> {
  const url = new URL("https://creativecommons.tankerkoenig.de/json/list.php");
  url.searchParams.set("lat", String(task.lat));
  url.searchParams.set("lng", String(task.lon));
  url.searchParams.set("rad", "5");
  url.searchParams.set("type", "all");
  url.searchParams.set("sort", "dist");
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Tankerkönig list.php HTTP ${response.status}`);
  const payload = await response.json() as { ok?: boolean; message?: string; stations?: TankerStation[] };
  if (payload.ok !== true || !Array.isArray(payload.stations)) {
    throw new Error(payload.message || "Tankerkönig lieferte keine gültige Stationsliste.");
  }

  const statements = [];
  let savedCount = 0;
  for (const station of payload.stations) {
    if (
      !station?.id ||
      !station.name ||
      typeof station.lat !== "number" ||
      !Number.isFinite(station.lat) ||
      typeof station.lng !== "number" ||
      !Number.isFinite(station.lng)
    ) continue;

    savedCount += 1;
    statements.push(statement(
      `INSERT INTO fuel_stations
        (id, name, brand, street, house_number, post_code, place, lat, lon, is_open, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, brand = excluded.brand, street = excluded.street,
          house_number = excluded.house_number, post_code = excluded.post_code,
          place = excluded.place, lat = excluded.lat, lon = excluded.lon,
          is_open = excluded.is_open, last_seen_at = excluded.last_seen_at`,
      [
        station.id, station.name, station.brand || null, station.street || null,
        station.houseNumber || null, station.postCode == null ? null : String(station.postCode),
        station.place || null, station.lat, station.lng,
        station.isOpen === true ? 1 : station.isOpen === false ? 0 : null,
        now, now,
      ],
    ));

    const distanceM = typeof station.dist === "number" && Number.isFinite(station.dist)
      ? Math.round(station.dist * 1000) : null;
    const bearing = direction(task.lat, task.lon, station.lat, station.lng);
    statements.push(statement(
      `INSERT INTO crossing_fuel_stations (crossing_id, station_id, distance_m, direction, discovered_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(crossing_id, station_id) DO UPDATE SET
          distance_m = excluded.distance_m, direction = excluded.direction, discovered_at = excluded.discovered_at`,
      [task.crossingId, station.id, distanceM, bearing, now],
    ));

    for (const fuelType of ["e5", "e10", "diesel"] as FuelType[]) {
      const price = station[fuelType];
      if (!validPrice(price)) continue;
      statements.push(statement(
        `INSERT INTO fuel_station_prices (station_id, fuel_type, price, observed_at, fetched_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(station_id, fuel_type) DO UPDATE SET
            price = excluded.price, observed_at = excluded.observed_at, fetched_at = excluded.fetched_at`,
        [station.id, fuelType, price, now, now],
      ));
    }

    // list.php already returned current prices; do not immediately request them again.
    statements.push(statement(
      `INSERT INTO fuel_refresh_state
        (scope_type, scope_id, last_attempt_at, last_success_at, next_attempt_at, error_message, cursor_value, updated_at)
        VALUES ('prices', ?, ?, ?, ?, NULL, NULL, ?)
        ON CONFLICT(scope_type, scope_id) DO UPDATE SET
          last_attempt_at = excluded.last_attempt_at,
          last_success_at = excluded.last_success_at,
          next_attempt_at = excluded.next_attempt_at,
          error_message = NULL,
          updated_at = excluded.updated_at`,
      [station.id, now, now, now + PRICE_REFRESH_INTERVAL_MS, now],
    ));
  }

  for (let index = 0; index < statements.length; index += MAX_BATCH_STATEMENTS) {
    await db.batch(statements.slice(index, index + MAX_BATCH_STATEMENTS), "write");
  }
  const nextAttempt = now + (savedCount ? DISCOVERY_INTERVAL_MS : EMPTY_DISCOVERY_RETRY_MS);
  await saveRefreshState(db, "crossing", task.crossingId, now, nextAttempt);
  return { discovered: savedCount };
}

async function refreshPrices(
  db: Client,
  task: Extract<RefreshTask, { kind: "prices" }>,
  apiKey: string,
  now: number,
): Promise<{ refreshed: number }> {
  const url = new URL("https://creativecommons.tankerkoenig.de/json/prices.php");
  url.searchParams.set("ids", task.stationIds.join(","));
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Tankerkönig prices.php HTTP ${response.status}`);
  const payload = await response.json() as {
    ok?: boolean;
    message?: string;
    prices?: Record<string, { status?: string; e5?: number | false; e10?: number | false; diesel?: number | false }>;
  };
  if (payload.ok !== true || !payload.prices || typeof payload.prices !== "object") {
    throw new Error(payload.message || "Tankerkönig lieferte keine gültigen Preisangaben.");
  }

  const statements = [];
  let refreshed = 0;
  let missing = 0;

  for (const stationId of task.stationIds) {
    const entry = payload.prices[stationId];

    // Tankerkönig can return a successful HTTP response while omitting
    // individual station IDs. Do not advance their successful refresh time:
    // otherwise an old cached price would be treated as fresh for 20 minutes.
    if (!entry || typeof entry !== "object") {
      missing += 1;
      await saveRefreshState(
        db,
        "prices",
        stationId,
        now,
        now + ERROR_RETRY_MS,
        "Tankerkönig hat für diese Tankstelle keine Preisantwort geliefert.",
      );
      continue;
    }

    refreshed += 1;
    const status = entry.status === "open" ? 1 : entry.status === "closed" ? 0 : null;
    if (status !== null) {
      statements.push(statement(
        "UPDATE fuel_stations SET is_open = ?, last_seen_at = ? WHERE id = ?",
        [status, now, stationId],
      ));
    }

    for (const fuelType of ["e5", "e10", "diesel"] as FuelType[]) {
      const price = entry[fuelType];
      if (!validPrice(price)) continue;
      statements.push(statement(
        `INSERT INTO fuel_station_prices (station_id, fuel_type, price, observed_at, fetched_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(station_id, fuel_type) DO UPDATE SET
            price = excluded.price, observed_at = excluded.observed_at, fetched_at = excluded.fetched_at`,
        [stationId, fuelType, price, now, now],
      ));
    }

    // Only stations actually present in Tankerkönig's response receive the
    // normal refresh interval.
    statements.push(statement(
      `INSERT INTO fuel_refresh_state
        (scope_type, scope_id, last_attempt_at, last_success_at, next_attempt_at, error_message, cursor_value, updated_at)
        VALUES ('prices', ?, ?, ?, ?, NULL, NULL, ?)
        ON CONFLICT(scope_type, scope_id) DO UPDATE SET
          last_attempt_at = excluded.last_attempt_at,
          last_success_at = excluded.last_success_at,
          next_attempt_at = excluded.next_attempt_at,
          error_message = NULL,
          updated_at = excluded.updated_at`,
      [stationId, now, now, now + PRICE_REFRESH_INTERVAL_MS, now],
    ));
  }

  for (let index = 0; index < statements.length; index += MAX_BATCH_STATEMENTS) {
    await db.batch(statements.slice(index, index + MAX_BATCH_STATEMENTS), "write");
  }
  return { refreshed, missing, requested: task.stationIds.length };
}

async function runRefresh(env: Env): Promise<Record<string, unknown>> {
  const apiKey = env.TANKERKOENIG_API_KEY?.trim();
  if (!apiKey) throw new Error("TANKERKOENIG_API_KEY fehlt");

  const db = getDb(env);
  const now = Date.now();
  const task = await findTask(db, now);
  if (!task) return { status: "idle", message: "Keine fällige Aktualisierung." };

  // Reserve the global slot before contacting Tankerkönig. This serializes
  // all crossing discovery and price refreshes across concurrent invocations.
  const lockToken = crypto.randomUUID();
  const lock = await db.execute({
    sql: `UPDATE fuel_api_control
      SET last_request_at = ?, lock_until = ?, lock_token = ?, updated_at = ?
      WHERE id = 1 AND lock_until <= ? AND last_request_at <= ?`,
    args: [now, now + 45_000, lockToken, now, now, now - MIN_API_INTERVAL_MS],
  });
  if (Number(lock.rowsAffected) !== 1) {
    const guard = await db.execute(
      "SELECT last_request_at, lock_until FROM fuel_api_control WHERE id = 1 LIMIT 1",
    );
    const row = guard.rows[0] as Record<string, unknown> | undefined;
    return {
      status: "rate_limited",
      retryAfter: Math.max(
        1,
        Math.ceil((
          Math.max(Number(row?.last_request_at || 0) + MIN_API_INTERVAL_MS, Number(row?.lock_until || 0)) - now
        ) / 1000),
      ),
    };
  }

  try {
    const result = task.kind === "discovery"
      ? await discoverStations(db, task, apiKey, now)
      : await refreshPrices(db, task, apiKey, now);

    await db.execute({
      sql: "UPDATE fuel_api_control SET lock_until = 0, lock_token = NULL, updated_at = ? WHERE id = 1 AND lock_token = ?",
      args: [Date.now(), lockToken],
    });
    return { status: "ok", task: task.kind, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Tankerkönig-Fehler";
    const failedAt = Date.now();
    await db.execute({
      sql: "UPDATE fuel_api_control SET lock_until = 0, lock_token = NULL, updated_at = ? WHERE id = 1 AND lock_token = ?",
      args: [failedAt, lockToken],
    });

    if (task.kind === "discovery") {
      await saveRefreshState(db, "crossing", task.crossingId, failedAt, failedAt + ERROR_RETRY_MS, message);
    } else {
      for (const stationId of task.stationIds) {
        await saveRefreshState(db, "prices", stationId, failedAt, failedAt + ERROR_RETRY_MS, message);
      }
    }
    console.error("[FUEL-REFRESH] update failed:", message);
    return { status: "error", task: task.kind, error: message };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "meineschranke-fuel" });
    }

    if (url.pathname === "/run") {
      if (request.method !== "POST") {
        return Response.json({ error: "POST erforderlich." }, { status: 405 });
      }
      const token = env.FUEL_REFRESH_RUN_TOKEN?.trim();
      if (!token || request.headers.get("authorization") !== `Bearer ${token}`) {
        return Response.json({ error: "Nicht autorisiert." }, { status: 401 });
      }
      try {
        const result = await runRefresh(env);
        return Response.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[FUEL-REFRESH] manual run failed:", message);
        return Response.json({ status: "error", error: message }, { status: 500 });
      }
    }

    return new Response("meineschranke-fuel", { status: 200 });
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    try {
      const result = await runRefresh(env);
      console.log("[FUEL-REFRESH] scheduled result", result);
    } catch (error) {
      console.error(
        "[FUEL-REFRESH] scheduled run failed:",
        error instanceof Error ? error.stack || error.message : String(error),
      );
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
