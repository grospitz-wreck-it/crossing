import { db } from "./db";
import { buildRailGraph, distanceMeters, nearestNode, shortestRailPath, type RailWayRow } from "./railGraph";
import type { RouteStation } from "../../../../packages/prediction-engine/src/routeOsmMatcher";

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
  crossingNodeIds: Set<string>;
  railwayWayIds: string[];
};

const stationCache = new Map<string, { expiresAt: number; value: RouteStation[] }>();
const graphCache = new Map<string, { expiresAt: number; value: ReturnType<typeof buildRailGraph> }>();

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

async function loadGraph() {
  const cached = graphCache.get("rail");
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const result = await db.execute({
    sql: `SELECT osm_id, node_ids_json, geometry_json, tags_json FROM osm_rail_ways`,
    args: [],
  });
  const rows: RailWayRow[] = [];
  for (const row of result.rows as any[]) {
    try {
      const nodeIds = JSON.parse(String(row.node_ids_json || "[]")).map(String);
      const geometry = JSON.parse(String(row.geometry_json || "[]"));
      let tags: Record<string, string> = {};
      try { tags = JSON.parse(String(row.tags_json || "{}")); } catch {}
      if (nodeIds.length >= 2 && geometry.length >= 2) {
        rows.push({ osmId: String(row.osm_id), nodeIds, geometry, ref: tags.ref });
      }
    } catch {}
  }
  const graph = buildRailGraph(rows);
  graphCache.set("rail", { expiresAt: Date.now() + 300_000, value: graph });
  return graph;
}

async function loadMappings(): Promise<Mapping[]> {
  const links = await db.execute({
    sql: `SELECT crossing_id, osm_crossing_id, confidence FROM crossing_osm_links WHERE confidence >= 0.8`,
    args: [],
  });
  const mappings: Mapping[] = [];

  for (const link of links.rows as any[]) {
    const osmCrossingId = Number(link.osm_crossing_id);
    const crossingResult = await db.execute({
      sql: `SELECT lat, lon FROM osm_crossings WHERE osm_id = ? LIMIT 1`,
      args: [osmCrossingId],
    });
    const crossingRow: any = crossingResult.rows[0];
    if (!crossingRow) continue;

    const tracksResult = await db.execute({
      sql: `SELECT railway_way_id, crossing_node_index FROM osm_crossing_rail_ways WHERE crossing_osm_id = ?`,
      args: [osmCrossingId],
    });
    const railwayWayIds = (tracksResult.rows as any[]).map((row) => String(row.railway_way_id)).filter(Boolean);
    if (!railwayWayIds.length) continue;

    const crossingNodeIds = new Set<string>();
    for (const track of tracksResult.rows as any[]) {
      const wayResult = await db.execute({
        sql: `SELECT node_ids_json FROM osm_rail_ways WHERE osm_id = ? LIMIT 1`,
        args: [String(track.railway_way_id)],
      });
      const wayRow: any = wayResult.rows[0];
      if (!wayRow) continue;
      try {
        const nodes = JSON.parse(String(wayRow.node_ids_json || "[]")).map(String);
        const index = Number(track.crossing_node_index);
        if (Number.isInteger(index) && nodes[index]) crossingNodeIds.add(nodes[index]);
      } catch {}
    }

    mappings.push({
      crossingId: String(link.crossing_id),
      osmCrossingId,
      confidence: Number(link.confidence ?? 0),
      crossingLat: Number(crossingRow.lat),
      crossingLon: Number(crossingRow.lon),
      crossingNodeIds,
      railwayWayIds,
    });
  }
  return mappings;
}

/**
 * Authoritative OSM decision based on railway topology, not global geometry.
 * Shared track before a switch is intentionally allowed. A train is assigned
 * to a crossing only when the graph path between consecutive timetable
 * stations actually traverses that crossing's OSM node.
 */
export async function filterTrainByCrossingOsm(
  crossingId: string,
  route: string[] | undefined,
): Promise<CrossingOsmFilterResult> {
  if (!route?.length) return { status: "unknown" };

  try {
    const coordinateRoute = await routeToCoordinates(route);
    const stations = coordinateRoute.filter(
      (s): s is RouteStation & { lat: number; lon: number } => s.lat != null && s.lon != null,
    );
    if (stations.length < 2) return { status: "unknown" };

    const [graph, mappings] = await Promise.all([loadGraph(), loadMappings()]);
    const requested = mappings.find((m) => m.crossingId === crossingId);
    if (!requested || requested.crossingNodeIds.size === 0) return { status: "unknown" };

    const candidateHits = new Map<string, { wayId?: string; ref?: string; distance: number }>();

    for (let i = 1; i < stations.length; i += 1) {
      const from = stations[i - 1];
      const to = stations[i];
      const start = nearestNode(graph, from, 5000);
      const target = nearestNode(graph, to, 5000);
      if (!start || !target) continue;

      // Only solve graph paths for station segments whose straight corridor
      // comes reasonably close to one of our known BÜs. This keeps the work
      // bounded while retaining the exact node-level topology decision.
      const nearbyMappings = mappings.filter((mapping) => {
        const d = Math.min(
          distanceMeters({ lat: mapping.crossingLat, lon: mapping.crossingLon }, from),
          distanceMeters({ lat: mapping.crossingLat, lon: mapping.crossingLon }, to),
        );
        return d <= 12000;
      });
      if (!nearbyMappings.length) continue;

      const path = shortestRailPath(graph, start.nodeId, target.nodeId);
      if (!path) continue;

      const pathNodes = new Set(path.nodes);
      for (const mapping of nearbyMappings) {
        const hitNode = [...mapping.crossingNodeIds].find((nodeId) => pathNodes.has(nodeId));
        if (!hitNode) continue;
        const hitIndex = path.nodes.indexOf(hitNode);
        const pathWayId = hitIndex > 0
          ? [...(graph.adjacency.get(path.nodes[hitIndex - 1]) ?? [])].find((edge) => edge.to === hitNode)?.wayId
          : undefined;
        const distanceToCrossing = distanceMeters(
          { lat: mapping.crossingLat, lon: mapping.crossingLon },
          graph.nodePoints.get(hitNode) ?? { lat: mapping.crossingLat, lon: mapping.crossingLon },
        );
        candidateHits.set(mapping.crossingId, {
          wayId: pathWayId || mapping.railwayWayIds[0],
          ref: undefined,
          distance: distanceToCrossing,
        });
      }
    }

    const own = candidateHits.get(crossingId);
    if (own) {
      return {
        status: "matched",
        score: Math.max(0, 1 - own.distance / 100),
        railwayWayId: own.wayId,
        ref: own.ref,
      };
    }

    // If the timetable route reaches another mapped BÜ but not this one, the
    // topology gives us a deterministic rejection. If it reaches neither,
    // preserve legacy behaviour instead of inventing a route decision.
    if (candidateHits.size > 0) {
      const other = [...candidateHits.entries()].find(([id]) => id !== crossingId);
      if (other) return { status: "rejected", railwayWayId: other[1].wayId, ref: other[1].ref };
    }

    return { status: "unknown" };
  } catch (error) {
    console.error("Failed to match train against OSM railway topology:", error);
    return { status: "unknown" };
  }
}
