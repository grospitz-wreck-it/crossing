import { db } from "./db";
import type { CrossingOSMMapping } from "../../../../packages/crossing-model/src/osm";
import type { OSMRailWayGeometry, RouteStation } from "../../../../packages/prediction-engine/src/routeOsmMatcher";
import { matchRouteToOsmWays } from "../../../../packages/prediction-engine/src/routeOsmMatcher";

export type CrossingOsmFilterResult = {
  status: "matched" | "rejected" | "unknown";
  score?: number;
  railwayWayId?: string;
  ref?: string;
};

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

    const value = route.map((name) => byName.get(normalizeStationName(name)) || { name });
    stationCache.set(key, { expiresAt: Date.now() + 300_000, value });
    return value;
  } catch (error) {
    console.error("Failed to resolve route stations:", error);
    return route.map((name) => ({ name }));
  }
}

/**
 * Infrastructure filter. A route is evaluated against ALL trusted crossing
 * mappings, not only the requested crossing. This is essential where two
 * crossings sit on different OSM railway ways but share the same observation
 * station.
 */
export async function filterTrainByCrossingOsm(
  crossingId: string,
  route: string[] | undefined,
): Promise<CrossingOsmFilterResult> {
  if (!route?.length) return { status: "unknown" };

  const coordinateRoute = await routeToCoordinates(route);
  if (coordinateRoute.filter((s) => s.lat != null && s.lon != null).length < 2) {
    return { status: "unknown" };
  }

  try {
    const links = await db.execute({
      sql: `SELECT crossing_id, osm_crossing_id, confidence FROM crossing_osm_links WHERE confidence >= 0.8`,
      args: [],
    });

    const mappings: CrossingOSMMapping[] = [];
    const ways: OSMRailWayGeometry[] = [];

    for (const link of links.rows as any[]) {
      const crossingOsmId = Number(link.osm_crossing_id);
      const tracksResult = await db.execute({
        sql: `SELECT railway_way_id, way_direction FROM osm_crossing_rail_ways WHERE crossing_osm_id = ?`,
        args: [crossingOsmId],
      });
      const tracks = tracksResult.rows as any[];
      if (!tracks.length) continue;

      const wayIds = tracks.map((t) => Number(t.railway_way_id)).filter(Number.isFinite);
      if (!wayIds.length) continue;

      const placeholders = wayIds.map(() => "?").join(",");
      const wayResult = await db.execute({
        sql: `SELECT osm_id, tags_json, geometry_json FROM osm_rail_ways WHERE osm_id IN (${placeholders})`,
        args: wayIds,
      });

      for (const way of wayResult.rows as any[]) {
        let tags: Record<string, string> = {};
        let geometry: Array<{ lat: number; lon: number }> = [];
        try { tags = JSON.parse(String(way.tags_json || "{}")); } catch {}
        try { geometry = JSON.parse(String(way.geometry_json || "[]")); } catch {}
        if (geometry.length >= 2) {
          ways.push({ osmId: String(way.osm_id), ref: tags.ref, geometry });
        }
      }

      mappings.push({
        crossingId: String(link.crossing_id),
        osmNodeId: String(crossingOsmId),
        source: "openstreetmap",
        confidence: Number(link.confidence ?? 0),
        tracks: tracks.map((t) => ({
          railwayWayId: String(t.railway_way_id),
          direction: t.way_direction === "forward" || t.way_direction === "backward" ? t.way_direction : "unknown",
        })),
      });
    }

    if (!mappings.length || !ways.length) return { status: "unknown" };

    const routeMatches = matchRouteToOsmWays(coordinateRoute, ways);
    if (!routeMatches.length) return { status: "unknown" };

    const bestByCrossing = new Map<string, { score: number; railwayWayId: string; ref?: string }>();
    for (const mapping of mappings) {
      for (const track of mapping.tracks) {
        const match = routeMatches.find((candidate) => String(candidate.railwayWayId) === String(track.railwayWayId));
        if (!match || match.score <= 0) continue;
        const score = match.score * mapping.confidence;
        const previous = bestByCrossing.get(mapping.crossingId);
        if (!previous || score > previous.score) {
          bestByCrossing.set(mapping.crossingId, {
            score,
            railwayWayId: String(track.railwayWayId),
            ref: match.ref,
          });
        }
      }
    }

    const own = bestByCrossing.get(crossingId);
    if (!own) return { status: "rejected" };

    const ranked = [...bestByCrossing.entries()].sort((a, b) => b[1].score - a[1].score);
    const rank = ranked.findIndex(([id]) => id === crossingId);
    const runnerUp = ranked.find(([id]) => id !== crossingId)?.[1];

    // Station-only routes are necessarily approximate. Do not demand the old
    // 0.65 score, but require this BÜ's railway way to beat competing mapped
    // crossings by a meaningful margin. This prevents the two Parkstraße BÜs
    // from both receiving the same train merely because Bünde is shared.
    const minimumScore = 0.35;
    const minimumMargin = 0.06;
    if (own.score < minimumScore) {
      return { status: "rejected", score: own.score, railwayWayId: own.railwayWayId, ref: own.ref };
    }

    if (rank > 0 && runnerUp && runnerUp.score - own.score >= minimumMargin) {
      return { status: "rejected", score: own.score, railwayWayId: own.railwayWayId, ref: own.ref };
    }

    if (rank === 0 && runnerUp && own.score - runnerUp.score < minimumMargin) {
      return { status: "unknown", score: own.score, railwayWayId: own.railwayWayId, ref: own.ref };
    }

    return { status: "matched", score: own.score, railwayWayId: own.railwayWayId, ref: own.ref };
  } catch (error) {
    console.error("Failed to match train against OSM crossings:", error);
    return { status: "unknown" };
  }
}
