import { db } from "./db";
import type { OSMRailWayGeometry, RouteStation } from "../../../../packages/prediction-engine/src/routeOsmMatcher";

export type CrossingOsmFilterResult = {
  status: "matched" | "rejected" | "unknown";
  score?: number;
  railwayWayId?: string;
  ref?: string;
};

type Mapping = {
  crossingId: string;
  osmCrossingId: number;
  confidence: number;
  crossingLat: number;
  crossingLon: number;
  railwayWayIds: string[];
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

function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const latScale = Math.cos((a.lat * Math.PI) / 180);
  const dx = (a.lon - b.lon) * 111320 * latScale;
  const dy = (a.lat - b.lat) * 111320;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentDistanceMeters(
  p: { lat: number; lon: number },
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) {
  const latScale = Math.cos((p.lat * Math.PI) / 180);
  const xy = (v: { lat: number; lon: number }) => ({
    x: v.lon * 111320 * latScale,
    y: v.lat * 111320,
  });
  const pp = xy(p);
  const aa = xy(a);
  const bb = xy(b);
  const dx = bb.x - aa.x;
  const dy = bb.y - aa.y;
  if (dx === 0 && dy === 0) return Math.hypot(pp.x - aa.x, pp.y - aa.y);
  const t = Math.max(0, Math.min(1, ((pp.x - aa.x) * dx + (pp.y - aa.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(pp.x - (aa.x + t * dx), pp.y - (aa.y + t * dy));
}

function minDistanceToWay(point: { lat: number; lon: number }, way: OSMRailWayGeometry) {
  let best = Infinity;
  for (let i = 1; i < way.geometry.length; i += 1) {
    best = Math.min(best, pointToSegmentDistanceMeters(point, way.geometry[i - 1], way.geometry[i]));
  }
  return best;
}

function segmentMidpoint(a: RouteStation & { lat: number; lon: number }, b: RouteStation & { lat: number; lon: number }) {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
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
 * Match the train to the railway segment at the crossing, not to the entire
 * railway way. A DB route is a list of stations; the relevant evidence is the
 * adjacent station-to-station segment that actually passes this crossing.
 */
export async function filterTrainByCrossingOsm(
  crossingId: string,
  route: string[] | undefined,
): Promise<CrossingOsmFilterResult> {
  if (!route?.length) return { status: "unknown" };

  const coordinateRoute = await routeToCoordinates(route);
  const stations = coordinateRoute.filter(
    (s): s is RouteStation & { lat: number; lon: number } => s.lat != null && s.lon != null,
  );
  if (stations.length < 2) return { status: "unknown" };

  try {
    const links = await db.execute({
      sql: `SELECT crossing_id, osm_crossing_id, confidence FROM crossing_osm_links WHERE confidence >= 0.8`,
      args: [],
    });

    const mappings: Mapping[] = [];
    const waysById = new Map<string, OSMRailWayGeometry>();

    for (const link of links.rows as any[]) {
      const osmCrossingId = Number(link.osm_crossing_id);
      const crossingResult = await db.execute({
        sql: `SELECT lat, lon FROM osm_crossings WHERE osm_id = ? LIMIT 1`,
        args: [osmCrossingId],
      });
      const crossingRow: any = crossingResult.rows[0];
      if (!crossingRow) continue;

      const tracksResult = await db.execute({
        sql: `SELECT railway_way_id FROM osm_crossing_rail_ways WHERE crossing_osm_id = ?`,
        args: [osmCrossingId],
      });
      const railwayWayIds = (tracksResult.rows as any[])
        .map((row) => String(row.railway_way_id))
        .filter(Boolean);
      if (!railwayWayIds.length) continue;

      const placeholders = railwayWayIds.map(() => "?").join(",");
      const wayResult = await db.execute({
        sql: `SELECT osm_id, tags_json, geometry_json FROM osm_rail_ways WHERE osm_id IN (${placeholders})`,
        args: railwayWayIds,
      });

      for (const way of wayResult.rows as any[]) {
        let tags: Record<string, string> = {};
        let geometry: Array<{ lat: number; lon: number }> = [];
        try { tags = JSON.parse(String(way.tags_json || "{}")); } catch {}
        try { geometry = JSON.parse(String(way.geometry_json || "[]")); } catch {}
        if (geometry.length >= 2) {
          waysById.set(String(way.osm_id), { osmId: String(way.osm_id), ref: tags.ref, geometry });
        }
      }

      mappings.push({
        crossingId: String(link.crossing_id),
        osmCrossingId,
        confidence: Number(link.confidence ?? 0),
        crossingLat: Number(crossingRow.lat),
        crossingLon: Number(crossingRow.lon),
        railwayWayIds,
      });
    }

    const requested = mappings.find((mapping) => mapping.crossingId === crossingId);
    if (!requested) return { status: "unknown" };

    const candidateScores = new Map<string, { score: number; railwayWayId: string; ref?: string }>();

    for (const mapping of mappings) {
      let best: { score: number; railwayWayId: string; ref?: string } | null = null;

      for (const railwayWayId of mapping.railwayWayIds) {
        const way = waysById.get(railwayWayId);
        if (!way) continue;

        for (let i = 1; i < stations.length; i += 1) {
          const from = stations[i - 1];
          const to = stations[i];
          const midpoint = segmentMidpoint(from, to);

          // The segment must actually pass close to the BÜ. This is what
          // separates Parkstraße Nord from Süd even though both share Bünde.
          const crossingDistance = pointToSegmentDistanceMeters(
            { lat: mapping.crossingLat, lon: mapping.crossingLon },
            from,
            to,
          );
          if (crossingDistance > 2500) continue;

          const midpointDistance = minDistanceToWay(midpoint, way);
          const fromDistance = minDistanceToWay(from, way);
          const toDistance = minDistanceToWay(to, way);
          const wayDistance = Math.min(midpointDistance, (fromDistance + toDistance) / 2);

          const crossingProximity = Math.max(0, 1 - crossingDistance / 2500);
          const wayProximity = Math.max(0, 1 - wayDistance / 5000);
          const score = crossingProximity * 0.7 + wayProximity * 0.3;

          if (!best || score > best.score) {
            best = { score, railwayWayId, ref: way.ref };
          }
        }
      }

      if (best) candidateScores.set(mapping.crossingId, best);
    }

    const own = candidateScores.get(crossingId);
    if (!own) return { status: "rejected" };

    const ranked = [...candidateScores.entries()].sort((a, b) => b[1].score - a[1].score);
    const rank = ranked.findIndex(([id]) => id === crossingId);
    const runnerUp = ranked.find(([id]) => id !== crossingId)?.[1];

    // A clear infrastructure winner is authoritative. If the route cannot
    // distinguish the branches, do not invent a crossing assignment.
    if (own.score < 0.55) return { status: "unknown", score: own.score, railwayWayId: own.railwayWayId, ref: own.ref };
    if (rank > 0 && runnerUp && runnerUp.score - own.score >= 0.05) {
      return { status: "rejected", score: own.score, railwayWayId: own.railwayWayId, ref: own.ref };
    }
    if (rank === 0 && runnerUp && own.score - runnerUp.score < 0.05) {
      return { status: "unknown", score: own.score, railwayWayId: own.railwayWayId, ref: own.ref };
    }

    return { status: "matched", score: own.score, railwayWayId: own.railwayWayId, ref: own.ref };
  } catch (error) {
    console.error("Failed to match train against OSM crossings:", error);
    return { status: "unknown" };
  }
}
