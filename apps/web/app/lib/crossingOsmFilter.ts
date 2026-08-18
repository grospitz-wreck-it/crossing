import { db } from "./db";
import { trainUsesCrossing } from "../../../../packages/prediction-engine/src/trainUsesCrossing";
import type { CrossingOSMMapping } from "../../../../packages/crossing-model/src/osm";
import type { OSMRailWayGeometry, RouteStation } from "../../../../packages/prediction-engine/src/routeOsmMatcher";

export type CrossingOsmFilterResult = {
  status: "matched" | "rejected" | "unknown";
  score?: number;
  railwayWayId?: string;
  ref?: string;
};

type OSMContext = { mapping: CrossingOSMMapping; ways: OSMRailWayGeometry[] };

const contextCache = new Map<string, { expiresAt: number; value: OSMContext | null }>();
const stationCache = new Map<string, { expiresAt: number; value: RouteStation[] }>();

function normalizeStationName(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

async function loadOsmContext(crossingId: string): Promise<OSMContext | null> {
  const cached = contextCache.get(crossingId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const link = await db.execute({
      sql: `SELECT osm_crossing_id, confidence FROM crossing_osm_links WHERE crossing_id = ? LIMIT 1`,
      args: [crossingId],
    });
    const row: any = link.rows[0];
    if (!row) {
      contextCache.set(crossingId, { expiresAt: Date.now() + 300_000, value: null });
      return null;
    }

    const crossingOsmId = Number(row.osm_crossing_id);
    const tracksResult = await db.execute({
      sql: `SELECT railway_way_id, way_direction FROM osm_crossing_rail_ways WHERE crossing_osm_id = ?`,
      args: [crossingOsmId],
    });
    const trackRows = tracksResult.rows as any[];
    const wayIds = trackRows.map((track) => Number(track.railway_way_id)).filter(Number.isFinite);
    if (!wayIds.length) return null;

    const placeholders = wayIds.map(() => "?").join(",");
    const waysResult = await db.execute({
      sql: `SELECT osm_id, tags_json, geometry_json FROM osm_rail_ways WHERE osm_id IN (${placeholders})`,
      args: wayIds,
    });

    const ways: OSMRailWayGeometry[] = (waysResult.rows as any[]).map((way) => {
      let tags: Record<string, string> = {};
      let geometry: Array<{ lat: number; lon: number }> = [];
      try { tags = JSON.parse(String(way.tags_json || "{}")); } catch {}
      try { geometry = JSON.parse(String(way.geometry_json || "[]")); } catch {}
      return {
        osmId: String(way.osm_id),
        ref: tags.ref,
        geometry: Array.isArray(geometry) ? geometry : [],
      };
    }).filter((way) => way.geometry.length >= 2);

    const mapping: CrossingOSMMapping = {
      crossingId,
      osmNodeId: String(crossingOsmId),
      source: "openstreetmap",
      confidence: Number(row.confidence ?? 0),
      tracks: trackRows.map((track) => ({
        railwayWayId: String(track.railway_way_id),
        direction: track.way_direction === "forward" || track.way_direction === "backward" ? track.way_direction : "unknown",
      })),
    };

    const value = { mapping, ways };
    contextCache.set(crossingId, { expiresAt: Date.now() + 300_000, value });
    return value;
  } catch (error) {
    console.error("Failed to load OSM crossing context:", error);
    contextCache.set(crossingId, { expiresAt: Date.now() + 30_000, value: null });
    return null;
  }
}

async function routeToCoordinates(route: string[]): Promise<RouteStation[]> {
  const key = route.join("|");
  const cached = stationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const result = await db.execute({
      sql: `SELECT name, lat, lon FROM railway_station_catalog WHERE lat IS NOT NULL AND lon IS NOT NULL`,
      args: [],
    });
    const byName = new Map<string, RouteStation>();
    for (const row of result.rows as any[]) {
      const name = String(row.name || "");
      const normalized = normalizeStationName(name);
      if (!normalized || byName.has(normalized)) continue;
      byName.set(normalized, { name, lat: Number(row.lat), lon: Number(row.lon) });
    }

    const value = route.map((name) => {
      const exact = byName.get(normalizeStationName(name));
      return exact || { name };
    });
    stationCache.set(key, { expiresAt: Date.now() + 300_000, value });
    return value;
  } catch (error) {
    console.error("Failed to resolve route stations:", error);
    return route.map((name) => ({ name }));
  }
}

export async function filterTrainByCrossingOsm(
  crossingId: string,
  route: string[] | undefined,
): Promise<CrossingOsmFilterResult> {
  if (!route?.length) return { status: "unknown" };

  const context = await loadOsmContext(crossingId);
  // No trusted OSM mapping means legacy rules remain authoritative.
  if (!context || context.mapping.confidence < 0.8 || !context.ways.length) {
    return { status: "unknown" };
  }

  const coordinateRoute = await routeToCoordinates(route);
  const usableStations = coordinateRoute.filter((station) => station.lat != null && station.lon != null);
  if (usableStations.length < 2) return { status: "unknown" };

  const result = trainUsesCrossing(coordinateRoute, crossingId, [context.mapping], context.ways, 0.65);
  if (!result.usesCrossing || !result.match) return { status: "rejected", score: result.candidates[0]?.score };

  return {
    status: "matched",
    score: result.match.score,
    railwayWayId: result.match.railwayWayId,
    ref: result.match.ref,
  };
}
