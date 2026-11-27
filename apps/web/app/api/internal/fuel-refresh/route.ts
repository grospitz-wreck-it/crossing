import { randomUUID } from "node:crypto";
import { db } from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

function direction(fromLat: number, fromLon: number, toLat: number, toLon: number) {
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
  scopeType: string,
  scopeId: string,
  now: number,
  nextAttemptAt: number,
  errorMessage: string | null = null,
) {
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

async function findTask(now: number): Promise<RefreshTask | null> {
  const discovery = await db.execute({
    sql: `SELECT pc.crossing_id, c.lat, c.lon
      FROM fuel_pilot_crossings pc
      JOIN crossings c ON c.id = pc.crossing_id
      LEFT JOIN fuel_refresh_state rs
        ON rs.scope_type = 'crossing' AND rs.scope_id = pc.crossing_id
      WHERE pc.enabled = 1
        AND c.status = 'active'
        AND (rs.scope_id IS NULL OR rs.next_attempt_at <= ?)
      ORDER BY COALESCE(rs.last_success_at, 0) ASC, pc.crossing_id ASC
      LIMIT 1`,
    args: [now],
  });
  const crossing = discovery.rows[0] as any;
  if (crossing && Number.isFinite(Number(crossing.lat)) && Number.isFinite(Number(crossing.lon))) {
    return {
      kind: "discovery",
      crossingId: String(crossing.crossing_id),
      lat: Number(crossing.lat),
      lon: Number(crossing.lon),
    };
  }

  const prices = await db.execute({
    sql: `SELECT s.id
      FROM fuel_stations s
      LEFT JOIN fuel_refresh_state rs
        ON rs.scope_type = 'station' AND rs.scope_id = s.id
      WHERE rs.scope_id IS NULL OR rs.next_attempt_at <= ?
      ORDER BY COALESCE(rs.last_success_at, 0) ASC, s.last_seen_at ASC
      LIMIT 10`,
    args: [now],
  });
  const stationIds = prices.rows.map((row: any) => String(row.id)).filter(Boolean);
  return stationIds.length ? { kind: "prices", stationIds } : null;
}

async function discoverStations(task: Extract<RefreshTask, { kind: "discovery" }>, apiKey: string, now: number) {
  const url = new URL("https://creativecommons.tankerkoenig.de/json/list.php");
  url.searchParams.set("lat", String(task.lat));
  url.searchParams.set("lng", String(task.lon));
  url.searchParams.set("rad", "5");
  url.searchParams.set("type", "all");
  url.searchParams.set("sort", "price");
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Tankerkönig list.php HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.ok !== true || !Array.isArray(payload.stations)) {
    throw new Error(payload?.message || "Tankerkönig lieferte keine gültige Stationsliste.");
  }

  const stations = payload.stations as TankerStation[];
  const statements = [];
  for (const station of stations) {
    if (!station?.id || !station.name) continue;
    const lat = validPrice(station.lat) || typeof station.lat === "number" ? station.lat : null;
    const lon = typeof station.lng === "number" ? station.lng : null;
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
        station.place || null, lat, lon,
        station.isOpen === true ? 1 : station.isOpen === false ? 0 : null,
        now, now,
      ],
    ));
    const distanceM = typeof station.dist === "number" && Number.isFinite(station.dist)
      ? Math.round(station.dist * 1000) : null;
    const bearing = lat !== null && lon !== null ? direction(task.lat, task.lon, lat, lon) : null;
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
  }

  if (statements.length) await db.batch(statements, "write");
  const nextAttempt = now + (stations.length ? DISCOVERY_INTERVAL_MS : EMPTY_DISCOVERY_RETRY_MS);
  await saveRefreshState("crossing", task.crossingId, now, nextAttempt);
  return { discovered: stations.length };
}

async function refreshPrices(task: Extract<RefreshTask, { kind: "prices" }>, apiKey: string, now: number) {
  const url = new URL("https://creativecommons.tankerkoenig.de/json/prices.php");
  url.searchParams.set("ids", task.stationIds.join(","));
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Tankerkönig prices.php HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.ok !== true || !payload.prices || typeof payload.prices !== "object") {
    throw new Error(payload?.message || "Tankerkönig lieferte keine gültigen Preisangaben.");
  }

  const statements = [];
  for (const stationId of task.stationIds) {
    const entry = payload.prices[stationId];
    if (entry && typeof entry === "object") {
      const status = entry.status === "open" ? 1 : entry.status === "closed" ? 0 : null;
      if (status !== null) {
        statements.push(statement("UPDATE fuel_stations SET is_open = ?, last_seen_at = ? WHERE id = ?", [status, now, stationId]));
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
    }
    statements.push(statement(
      `INSERT INTO fuel_refresh_state
        (scope_type, scope_id, last_attempt_at, last_success_at, next_attempt_at, error_message, cursor_value, updated_at)
        VALUES ('station', ?, ?, ?, ?, NULL, NULL, ?)
        ON CONFLICT(scope_type, scope_id) DO UPDATE SET
          last_attempt_at = excluded.last_attempt_at,
          last_success_at = excluded.last_success_at,
          next_attempt_at = excluded.next_attempt_at,
          error_message = NULL,
          updated_at = excluded.updated_at`,
      [stationId, now, now, now + PRICE_REFRESH_INTERVAL_MS, now],
    ));
  }
  if (statements.length) await db.batch(statements, "write");
  return { refreshed: task.stationIds.length };
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  const apiKey = process.env.TANKERKOENIG_API_KEY;
  if (!apiKey) return Response.json({ error: "TANKERKOENIG_API_KEY fehlt." }, { status: 503 });

  const now = Date.now();
  let task: RefreshTask | null;
  try {
    task = await findTask(now);
  } catch (error) {
    console.error("[FUEL-REFRESH] task selection failed:", error);
    return Response.json({ error: "Refresh-Aufgabe konnte nicht ermittelt werden." }, { status: 500 });
  }
  if (!task) return Response.json({ status: "idle", message: "Keine fällige Aktualisierung." });

  const lockToken = randomUUID();
  const lock = await db.execute({
    sql: `UPDATE fuel_api_control
      SET lock_until = ?, lock_token = ?, updated_at = ?
      WHERE id = 1 AND lock_until <= ? AND last_request_at <= ?`,
    args: [now + 45_000, lockToken, now, now, now - MIN_API_INTERVAL_MS],
  });
  if (Number(lock.rowsAffected) !== 1) {
    const guard = await db.execute("SELECT last_request_at, lock_until FROM fuel_api_control WHERE id = 1 LIMIT 1");
    const row = guard.rows[0] as any;
    return Response.json({
      status: "rate_limited",
      retryAfter: Math.max(1, Math.ceil((Math.max(Number(row?.last_request_at || 0) + MIN_API_INTERVAL_MS, Number(row?.lock_until || 0)) - now) / 1000)),
    }, { status: 429 });
  }

  try {
    const result = task.kind === "discovery"
      ? await discoverStations(task, apiKey, now)
      : await refreshPrices(task, apiKey, now);

    await db.execute({
      sql: "UPDATE fuel_api_control SET last_request_at = ?, lock_until = 0, lock_token = NULL, updated_at = ? WHERE id = 1 AND lock_token = ?",
      args: [Date.now(), Date.now(), lockToken],
    });
    return Response.json({ status: "ok", task: task.kind, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Tankerkönig-Fehler";
    const failedAt = Date.now();
    await db.execute({
      sql: "UPDATE fuel_api_control SET last_request_at = ?, lock_until = 0, lock_token = NULL, updated_at = ? WHERE id = 1 AND lock_token = ?",
      args: [failedAt, failedAt, lockToken],
    });
    if (task.kind === "discovery") {
      await saveRefreshState("crossing", task.crossingId, failedAt, failedAt + ERROR_RETRY_MS, message);
    } else {
      for (const stationId of task.stationIds) {
        await saveRefreshState("station", stationId, failedAt, failedAt + ERROR_RETRY_MS, message);
      }
    }
    console.error("[FUEL-REFRESH] update failed:", message);
    return Response.json({ status: "error", error: message }, { status: 502 });
  }
}
