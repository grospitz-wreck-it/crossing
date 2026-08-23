import { db } from "./db";

const MAX_ROUTE_PROXIMITY_KM = 20;
const cache = new Map<string, { expiresAt: number; value: Map<string, { lat: number; lon: number }> }>();

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function normalize(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

async function loadCatalog() {
  const key = "railway_station_catalog";
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const result = await db.execute({
    sql: `SELECT name, lat, lon FROM railway_station_catalog WHERE lat IS NOT NULL AND lon IS NOT NULL`,
    args: [],
  });
  const catalog = new Map<string, { lat: number; lon: number }>();
  for (const row of result.rows as any[]) {
    const name = normalize(String(row.name || ""));
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || catalog.has(name)) continue;
    catalog.set(name, { lat, lon });
  }
  cache.set(key, { expiresAt: Date.now() + 300_000, value: catalog });
  return catalog;
}

/**
 * A journey is not allowed to be associated with a crossing merely because
 * an observation station elsewhere happens to produce a timetable hit.
 * Require at least one route stop to be geographically close to the crossing.
 * If the catalog cannot resolve route stops at all, return true so legacy
 * data remains fail-open rather than disappearing.
 */
export async function isTrainRouteNearCrossing(
  crossing: { lat?: number; lon?: number },
  route: string[] | undefined,
): Promise<boolean> {
  const lat = Number(crossing?.lat);
  const lon = Number(crossing?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Array.isArray(route) || route.length < 2) return true;

  try {
    const catalog = await loadCatalog();
    const resolved = route
      .map((stop) => catalog.get(normalize(stop)))
      .filter((point): point is { lat: number; lon: number } => Boolean(point));

    // 0 resolved stops means this route has nothing in common with the DB
// long-distance catalog (e.g. a pure U-Bahn/Tram/S-Bahn route) — treat as
// not near any crossing rather than fail-open.
if (!resolved.length) return false;
    return resolved.some((point) => distanceKm({ lat, lon }, point) <= MAX_ROUTE_PROXIMITY_KM);
  } catch {
    return true;
  }
}
