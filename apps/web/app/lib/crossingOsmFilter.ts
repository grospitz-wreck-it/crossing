import { db } from "./db";
import { buildRailGraph, distanceMeters, nearestNode, shortestRailPath, type RailGraph, type RailWayRow } from "./railGraph";
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

const CACHE_TTL_MS = 300_000;
const RESULT_CACHE_TTL_MS = 300_000;
const MAX_GRAPH_WAYS = 5000;
const MAX_GRAPH_NODES = 150000;
const MAX_EXPANSION_ROUNDS = 100;
const WAY_BATCH_SIZE = 200;
const NODE_BATCH_SIZE = 500;

const stationCache = new Map<string, { expiresAt: number; value: RouteStation[] }>();
const corridorCache = new Map<string, { expiresAt: number; value: CorridorGraph }>();
const resultCache = new Map<string, { expiresAt: number; value: CrossingOsmFilterResult }>();
let stationCatalogCache: { expiresAt: number; value: Map<string, RouteStation> } | null = null;
let stationCatalogPromise: Promise<Map<string, RouteStation>> | null = null;

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

async function loadStationCatalog() {
  if (stationCatalogCache && stationCatalogCache.expiresAt > Date.now()) return stationCatalogCache.value;
  if (stationCatalogPromise) return stationCatalogPromise;

  stationCatalogPromise = (async () => {
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
      stationCatalogCache = { expiresAt: Date.now() + CACHE_TTL_MS, value: byName };
      return byName;
    } finally {
      stationCatalogPromise = null;
    }
  })();

  return stationCatalogPromise;
}

async function routeToCoordinates(route: string[]): Promise<RouteStation[]> {
  const key = route.join("|");
  const cached = stationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const byName = await loadStationCatalog();
    const value = route.map((name) => byName.get(normalizeStationName(name)) || { name });
    stationCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  } catch (error) {
    console.error("Failed to resolve route stations:", error);
    return route.map((name) => ({ name }));
  }
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(",");
}

async function loadWayRows(wayIds: string[]): Promise<RailWayRow[]> {
  const rows: RailWayRow[] = [];
  for (let i = 0; i < wayIds.length; i += WAY_BATCH_SIZE) {
    const batch = wayIds.slice(i, i + WAY_BATCH_SIZE);
    const result = await db.execute({
      sql: `SELECT osm_id, node_ids_json, geometry_json, tags_json FROM osm_rail_ways WHERE osm_id IN (${placeholders(batch.length)})`,
      args: batch,
    });
    for (const row of result.rows as any[]) {
      try {
        const nodeIds = JSON.parse(String(row.node_ids_json || "[]")).map(String);
        const geometry = JSON.parse(String(row.geometry_json || "[]"));
        let tags: Record<string, string> = {};
        try { tags = JSON.parse(String(row.tags_json || "{}")); } catch {}
        if (nodeIds.length >= 2 && geometry.length >= 2) rows.push({ osmId: String(row.osm_id), nodeIds, geometry, ref: tags.ref });
      } catch {}
    }
  }
  return rows;
}

async function loadMapping(crossingId: string): Promise<Mapping | null> {
  const links = await db.execute({
    sql: `SELECT osm_crossing_id, confidence FROM crossing_osm_links WHERE crossing_id = ? AND confidence >= 0.8 ORDER BY confidence DESC LIMIT 1`,
    args: [crossingId],
  });
  const link: any = links.rows[0];
  if (!link) return null;

  const osmCrossingId = Number(link.osm_crossing_id);
  const crossingResult = await db.execute({
    sql: `SELECT lat, lon FROM osm_crossings WHERE osm_id = ? LIMIT 1`,
    args: [osmCrossingId],
  });
  const crossingRow: any = crossingResult.rows[0];
  if (!crossingRow) return null;

  const tracksResult = await db.execute({
    sql: `SELECT railway_way_id, crossing_node_index FROM osm_crossing_rail_ways WHERE crossing_osm_id = ?`,
    args: [osmCrossingId],
  });
  const railwayWayIds = (tracksResult.rows as any[]).map((row) => String(row.railway_way_id)).filter(Boolean);
  if (!railwayWayIds.length) return null;

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

  return { crossingId, osmCrossingId, confidence: Number(link.confidence ?? 0), crossingLat: Number(crossingRow.lat), crossingLon: Number(crossingRow.lon), crossingNodeIds, railwayWayIds };
}

type CorridorGraph = { graph: RailGraph; refs: Map<string, string>; mapping: Mapping };

function corridorTargets(mapping: Mapping, route: RouteStation[]) {
  const stations = route
    .map((station, index) => ({ station, index }))
    .filter((entry): entry is { station: RouteStation & { lat: number; lon: number }; index: number } => entry.station.lat != null && entry.station.lon != null);
  if (stations.length < 2) return [] as Array<RouteStation & { lat: number; lon: number }>;

  const crossing = { lat: mapping.crossingLat, lon: mapping.crossingLon };
  let nearest = stations[0];
  let nearestDistance = distanceMeters(crossing, nearest.station);
  for (let i = 1; i < stations.length; i += 1) {
    const distance = distanceMeters(crossing, stations[i].station);
    if (distance < nearestDistance) {
      nearest = stations[i];
      nearestDistance = distance;
    }
  }

  // Keep the corridor anchored to the train's actual route order. Prefer one
  // station before and one after the crossing-nearest station so a junction
  // cannot be selected merely because another station happens to be nearby.
  const before = stations.filter((entry) => entry.index < nearest.index).at(-1)?.station;
  const after = stations.find((entry) => entry.index > nearest.index)?.station;
  if (before && after) return [before, after];

  if (before) {
    const before2 = stations.filter((entry) => entry.index < nearest.index).at(-2)?.station;
    return before2 ? [before2, before] : [before, nearest.station];
  }

  if (after) {
    const after2 = stations.find((entry) => entry.index > nearest.index + 1)?.station;
    return after2 ? [after, after2] : [nearest.station, after];
  }

  return [stations[0].station, stations[1].station];
}

async function loadCorridorGraph(crossingId: string, route: RouteStation[]): Promise<CorridorGraph | null> {
  const key = `${crossingId}|${route.map((station) => station.name).join("|")}`;
  const cached = corridorCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const mapping = await loadMapping(crossingId);
  if (!mapping || !mapping.crossingNodeIds.size) return null;

  const loadedWayIds = new Set<string>();
  const rows: RailWayRow[] = [];
  const refs = new Map<string, string>();
  const addWays = async (ids: string[]) => {
    const missing = ids.filter((id) => !loadedWayIds.has(id));
    if (!missing.length || loadedWayIds.size >= MAX_GRAPH_WAYS) return;
    const newRows = await loadWayRows(missing.slice(0, MAX_GRAPH_WAYS - loadedWayIds.size));
    for (const row of newRows) {
      if (loadedWayIds.has(row.osmId)) continue;
      loadedWayIds.add(row.osmId);
      rows.push(row);
      if (row.ref) refs.set(row.osmId, row.ref);
    }
  };

  await addWays(mapping.railwayWayIds);
  let graph = buildRailGraph(rows);
  const targets = corridorTargets(mapping, route);
  const hasTargets = () => targets.length === 2 && targets.every((station) => nearestNode(graph, station, 5000));

  for (let round = 0; round < MAX_EXPANSION_ROUNDS && !hasTargets(); round += 1) {
    if (graph.nodePoints.size >= MAX_GRAPH_NODES || loadedWayIds.size >= MAX_GRAPH_WAYS) break;
    const nodeIds = [...graph.nodePoints.keys()];
    const adjacentWayIds = new Set<string>();
    for (let i = 0; i < nodeIds.length; i += NODE_BATCH_SIZE) {
      const batch = nodeIds.slice(i, i + NODE_BATCH_SIZE).map(Number).filter(Number.isSafeInteger);
      if (!batch.length) continue;
      const result = await db.execute({
        sql: `SELECT DISTINCT railway_way_id FROM osm_rail_way_nodes WHERE node_id IN (${placeholders(batch.length)})`,
        args: batch,
      });
      for (const row of result.rows as any[]) {
        const id = String(row.railway_way_id);
        if (!loadedWayIds.has(id)) adjacentWayIds.add(id);
      }
    }
    if (!adjacentWayIds.size) break;
    await addWays([...adjacentWayIds]);
    graph = buildRailGraph(rows);
  }

  const value = { graph, refs, mapping };
  corridorCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

export async function filterTrainByCrossingOsm(crossingId: string, route: string[] | undefined): Promise<CrossingOsmFilterResult> {
  if (!route?.length) return { status: "unknown" };
  const resultKey = `${crossingId}|${route.join("|")}`;
  const cachedResult = resultCache.get(resultKey);
  if (cachedResult && cachedResult.expiresAt > Date.now()) return cachedResult.value;

  try {
    const coordinateRoute = await routeToCoordinates(route);
    const stations = coordinateRoute.filter((s): s is RouteStation & { lat: number; lon: number } => s.lat != null && s.lon != null);
    if (stations.length < 2) return { status: "unknown" };

    const corridor = await loadCorridorGraph(crossingId, coordinateRoute);
    if (!corridor) return { status: "unknown" };
    const { graph, refs, mapping } = corridor;
    const candidateHits: Array<{ distance: number; wayId?: string; ref?: string }> = [];

    for (let i = 1; i < stations.length; i += 1) {
      const from = nearestNode(graph, stations[i - 1], 5000);
      const to = nearestNode(graph, stations[i], 5000);
      if (!from || !to) continue;
      const path = shortestRailPath(graph, from.nodeId, to.nodeId, 75000);
      if (!path) continue;

      for (const nodeId of mapping.crossingNodeIds) {
        const hitIndex = path.nodes.indexOf(nodeId);
        if (hitIndex < 0) continue;
        const adjacentWayIds = new Set<string>();
        if (hitIndex > 0) {
          const edge = (graph.adjacency.get(path.nodes[hitIndex - 1]) ?? []).find((candidate) => candidate.to === nodeId);
          if (edge) adjacentWayIds.add(edge.wayId);
        }
        const nextNode = path.nodes[hitIndex + 1];
        if (nextNode) {
          const edge = (graph.adjacency.get(nodeId) ?? []).find((candidate) => candidate.to === nextNode);
          if (edge) adjacentWayIds.add(edge.wayId);
        }
        const matchedWayId = [...adjacentWayIds].find((wayId) => mapping.railwayWayIds.includes(wayId));
        if (!matchedWayId) continue;
        const nodePoint = graph.nodePoints.get(nodeId);
        const distance = nodePoint ? distanceMeters({ lat: mapping.crossingLat, lon: mapping.crossingLon }, nodePoint) : 9999;
        candidateHits.push({ distance, wayId: matchedWayId, ref: refs.get(matchedWayId) });
      }
    }

    const own = candidateHits.sort((a, b) => a.distance - b.distance)[0];
    const result: CrossingOsmFilterResult = own
      ? { status: "matched", score: Math.max(0, 1 - own.distance / 100), railwayWayId: own.wayId, ref: own.ref }
      : { status: "rejected" };
    resultCache.set(resultKey, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, value: result });
    return result;
  } catch (error) {
    console.error("Failed to match train against OSM railway topology:", error);
    return { status: "unknown" };
  }
}
