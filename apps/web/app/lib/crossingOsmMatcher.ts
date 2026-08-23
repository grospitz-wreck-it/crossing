import type { Client } from "@libsql/client";

export type CrossingOsmMatch = {
  osmCrossingId: number;
  distanceMeters: number;
  confidence: number;
  matchMethod: string;
  railwayWayIds: number[];
  railwayRefs: string[];
};

type OsmCandidate = {
  osm_id: number;
  lat: number;
  lon: number;
  tags_json: string;
};

const DEFAULT_RADIUS_METERS = 150;
const MAX_MATCH_DISTANCE_METERS = 100;

function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number) {
  const latScale = 111320;
  const lonScale = 111320 * Math.cos((aLat * Math.PI) / 180);
  const dy = (aLat - bLat) * latScale;
  const dx = (aLon - bLon) * lonScale;
  return Math.sqrt(dx * dx + dy * dy);
}

function normalizeRef(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function parseTags(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function findBestOsmCrossing(
  db: Client,
  lat: number,
  lon: number,
  routeRef?: string,
  radiusMeters = DEFAULT_RADIUS_METERS,
): Promise<CrossingOsmMatch | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const latDelta = radiusMeters / 111320;
  const lonScale = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const lonDelta = radiusMeters / (111320 * lonScale);

  const candidates = await db.execute({
    sql: `
      SELECT osm_id, lat, lon, tags_json
      FROM osm_crossings
      WHERE lat BETWEEN ? AND ?
        AND lon BETWEEN ? AND ?
    `,
    args: [lat - latDelta, lat + latDelta, lon - lonDelta, lon + lonDelta],
  });

  if (!candidates.rows.length) return null;

  const normalizedRouteRef = normalizeRef(routeRef);
  const scored: Array<OsmCandidate & {
    distanceMeters: number;
    railwayWayIds: number[];
    railwayRefs: string[];
    routeRefMatch: boolean;
  }> = [];

  for (const row of candidates.rows as unknown as OsmCandidate[]) {
    const distance = distanceMeters(lat, lon, Number(row.lat), Number(row.lon));
    if (distance > radiusMeters) continue;

    const links = await db.execute({
      sql: `
        SELECT r.railway_way_id, w.tags_json
        FROM osm_crossing_rail_ways r
        LEFT JOIN osm_rail_ways w ON w.osm_id = r.railway_way_id
        WHERE r.crossing_osm_id = ?
      `,
      args: [Number(row.osm_id)],
    });

    const railwayWayIds: number[] = [];
    const railwayRefs: string[] = [];
    for (const link of links.rows as any[]) {
      const wayId = Number(link.railway_way_id);
      if (Number.isFinite(wayId)) railwayWayIds.push(wayId);
      const tags = parseTags(link.tags_json);
      const ref = String(tags.ref ?? "").trim();
      if (ref && !railwayRefs.includes(ref)) railwayRefs.push(ref);
    }

    const routeRefMatch = Boolean(
      normalizedRouteRef && railwayRefs.some((ref) => normalizeRef(ref) === normalizedRouteRef),
    );

    scored.push({
      ...row,
      distanceMeters: distance,
      railwayWayIds,
      railwayRefs,
      routeRefMatch,
    });
  }

  if (!scored.length) return null;

  scored.sort((a, b) => {
    if (a.routeRefMatch !== b.routeRefMatch) return a.routeRefMatch ? -1 : 1;
    if ((a.railwayWayIds.length > 0) !== (b.railwayWayIds.length > 0)) {
      return a.railwayWayIds.length > 0 ? -1 : 1;
    }
    return a.distanceMeters - b.distanceMeters;
  });

  const best = scored[0];
  if (best.distanceMeters > MAX_MATCH_DISTANCE_METERS) return null;

  const confidence = best.routeRefMatch
    ? best.distanceMeters <= 20
      ? 1
      : best.distanceMeters <= 50
        ? 0.99
        : 0.95
    : best.distanceMeters <= 20
      ? 0.99
      : best.distanceMeters <= 50
        ? 0.95
        : 0.9;

  return {
    osmCrossingId: Number(best.osm_id),
    distanceMeters: best.distanceMeters,
    confidence,
    matchMethod: best.routeRefMatch ? "nearest_osm_route_ref" : "nearest_osm",
    railwayWayIds: best.railwayWayIds,
    railwayRefs: best.railwayRefs,
  };
}

export async function linkCrossingToOsm(
  db: Client,
  crossingId: string,
  lat: number,
  lon: number,
  routeRef?: string,
) {
  const match = await findBestOsmCrossing(db, lat, lon, routeRef);
  if (!match) return null;

  await db.execute({
    sql: `
      INSERT INTO crossing_osm_links
        (crossing_id, osm_crossing_id, match_method, confidence, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(crossing_id) DO UPDATE SET
        osm_crossing_id=excluded.osm_crossing_id,
        match_method=excluded.match_method,
        confidence=excluded.confidence,
        updated_at=excluded.updated_at
    `,
    args: [crossingId, match.osmCrossingId, match.matchMethod, match.confidence],
  });

  return match;
}
