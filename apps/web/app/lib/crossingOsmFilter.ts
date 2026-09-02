import { db } from "./db";
import { getDbStations, normalizeStation } from "./dbStationCatalog";
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
const MAX_CORRIDOR_WAYS = 800;
const MAX_CORRIDOR_NODES = 50000;
const CORRIDOR_EXPANSION_ROUNDS = 9;
const WAY_BATCH_SIZE = 100;
const NODE_BATCH_SIZE = 500;
const ROUTE_CORRIDOR_RADIUS_METERS = 3000;

const stationCache = new Map<string, { expiresAt: number; value: RouteStation[] }>();
const corridorCache = new Map<string, { expiresAt: number; value: CorridorGraph }>();
const corridorInFlight = new Map<string, Promise<CorridorGraph | null>>();
const mappingCache = new Map<string, { expiresAt: number; value: Mapping | null }>();
const mappingInFlight = new Map<string, Promise<Mapping | null>>();
const resultCache = new Map<string, { expiresAt: number; value: CrossingOsmFilterResult }>();
let stationCatalogCache: Map<string, RouteStation> | null = null;

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

function loadStationCatalog(): Map<string, RouteStation> {
  if (stationCatalogCache) return stationCatalogCache;
  const byName = new Map<string, RouteStation>();
  for (const station of getDbStations()) {
    const normalized = normalizeStation(station);
    if (normalized.lat == null || normalized.lon == null) continue;
    const key = normalizeStationName(normalized.name);
    if (!key || byName.has(key)) continue;
    byName.set(key, { name: normalized.name, lat: normalized.lat, lon: normalized.lon });
  }
  stationCatalogCache = byName;
  return byName;
}

function routeToCoordinates(route: string[]): RouteStation[] {
  const key = route.join("|");
  const cached = stationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const byName = loadStationCatalog();
  const value = route.map((name) => byName.get(normalizeStationName(name)) || { name });
  stationCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

function placeholders(count: number) { return Array.from({ length: count }, () => "?").join(","); }

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
  const cached = mappingCache.get(crossingId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = mappingInFlight.get(crossingId);
  if (existing) return existing;
  const request = (async () => {
    try {
      const links = await db.execute({ sql: `SELECT osm_crossing_id, confidence FROM crossing_osm_links WHERE crossing_id = ? AND confidence >= 0.8 ORDER BY confidence DESC LIMIT 1`, args: [crossingId] });
      const link: any = links.rows[0];
      if (!link) return null;
      const osmCrossingId = Number(link.osm_crossing_id);
      const crossingResult = await db.execute({ sql: `SELECT lat, lon FROM osm_crossings WHERE osm_id = ? LIMIT 1`, args: [osmCrossingId] });
      const crossingRow: any = crossingResult.rows[0];
      if (!crossingRow) return null;
      const tracksResult = await db.execute({ sql: `SELECT railway_way_id, crossing_node_index FROM osm_crossing_rail_ways WHERE crossing_osm_id = ?`, args: [osmCrossingId] });
      const tracks = tracksResult.rows as any[];
      const railwayWayIds = tracks.map((row) => String(row.railway_way_id)).filter(Boolean);
      if (!railwayWayIds.length) return null;
      const wayRows = await loadWayRows([...new Set(railwayWayIds)]);
      const wayById = new Map(wayRows.map((row) => [row.osmId, row]));
      const crossingNodeIds = new Set<string>();
      for (const track of tracks) {
        const wayRow = wayById.get(String(track.railway_way_id));
        if (!wayRow) continue;
        const index = Number(track.crossing_node_index);
        if (Number.isInteger(index) && wayRow.nodeIds[index]) crossingNodeIds.add(wayRow.nodeIds[index]);
      }
      return { crossingId, osmCrossingId, confidence: Number(link.confidence ?? 0), crossingLat: Number(crossingRow.lat), crossingLon: Number(crossingRow.lon), crossingNodeIds, railwayWayIds };
    } catch (error) {
      console.error("Failed to load OSM crossing mapping:", error);
      return null;
    }
  })();
  mappingInFlight.set(crossingId, request);
  try {
    const value = await request;
    mappingCache.set(crossingId, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  } finally { mappingInFlight.delete(crossingId); }
}

type CorridorGraph = { graph: RailGraph; refs: Map<string, string>; mapping: Mapping };
type CorridorTarget = RouteStation & { lat: number; lon: number };
type RouteSegment = { from: CorridorTarget; to: CorridorTarget };
type GeoCoordinate = { lat: number; lon: number };

function pointToSegmentDistanceMeters(point: GeoCoordinate, a: GeoCoordinate, b: GeoCoordinate) {
  const latScale = Math.cos((point.lat * Math.PI) / 180);
  const scaleX = 111320 * latScale;
  const scaleY = 111320;
  const px = point.lon * scaleX;
  const py = point.lat * scaleY;
  const ax = a.lon * scaleX;
  const ay = a.lat * scaleY;
  const bx = b.lon * scaleX;
  const by = b.lat * scaleY;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function routeCorridorStations(mapping: Mapping, route: RouteStation[]) {
  const resolved = route.map((station) => ({ station })).filter((entry): entry is { station: CorridorTarget } => entry.station.lat != null && entry.station.lon != null);
  if (resolved.length < 2) return [] as CorridorTarget[];
  const crossing = { lat: mapping.crossingLat, lon: mapping.crossingLon };
  let best: { distance: number; from: CorridorTarget; to: CorridorTarget } | null = null;
  for (let i = 1; i < resolved.length; i += 1) {
    const from = resolved[i - 1].station;
    const to = resolved[i].station;
    const distance = pointToSegmentDistanceMeters(crossing, from, to);
    if (!best || distance < best.distance) best = { distance, from, to };
  }
  if (!best || best.distance > ROUTE_CORRIDOR_RADIUS_METERS) return [] as CorridorTarget[];
  return [best.from, best.to];
}

function wayNearRouteSegments(way: RailWayRow, segments: RouteSegment[]) {
  for (const point of way.geometry) for (const segment of segments) if (pointToSegmentDistanceMeters(point, segment.from, segment.to) <= ROUTE_CORRIDOR_RADIUS_METERS) return true;
  return false;
}

function routeSegments(stations: CorridorTarget[]): RouteSegment[] {
  const segments: RouteSegment[] = [];
  for (let i = 1; i < stations.length; i += 1) segments.push({ from: stations[i - 1], to: stations[i] });
  return segments;
}

async function buildCorridorGraph(crossingId: string, route: RouteStation[]): Promise<CorridorGraph | null> {
  const mapping = await loadMapping(crossingId);
  if (!mapping || !mapping.crossingNodeIds.size) return null;
  const corridorStations = routeCorridorStations(mapping, route);
  if (corridorStations.length < 2) return null;
  const segments = routeSegments(corridorStations);
  const loadedWayIds = new Set<string>();
  const rows: RailWayRow[] = [];
  const refs = new Map<string, string>();
  const addWays = async (ids: string[], constrainToRoute = false) => {
    const missing = [...new Set(ids)].filter((id) => !loadedWayIds.has(id));
    if (!missing.length || loadedWayIds.size >= MAX_CORRIDOR_WAYS) return [] as string[];
    const candidates = await loadWayRows(missing.slice(0, MAX_CORRIDOR_WAYS - loadedWayIds.size));
    const newNodeIds = new Set<string>();
    for (const row of candidates) {
      if (loadedWayIds.has(row.osmId)) continue;
      if (constrainToRoute && !wayNearRouteSegments(row, segments)) continue;
      loadedWayIds.add(row.osmId);
      rows.push(row);
      if (row.ref) refs.set(row.osmId, row.ref);
      for (const nodeId of row.nodeIds) newNodeIds.add(nodeId);
    }
    return [...newNodeIds];
  };
  let frontierNodeIds = await addWays(mapping.railwayWayIds);
  let graph = buildRailGraph(rows);
  const targets = [corridorStations[0], corridorStations[1]];
  for (let round = 0; round < CORRIDOR_EXPANSION_ROUNDS; round += 1) {
    if (graph.nodePoints.size >= MAX_CORRIDOR_NODES || loadedWayIds.size >= MAX_CORRIDOR_WAYS) break;
    if (targets.every((station) => nearestNode(graph, station, 5000))) break;
    if (!frontierNodeIds.length) break;
    const adjacentWayIds = new Set<string>();
    for (let i = 0; i < frontierNodeIds.length; i += NODE_BATCH_SIZE) {
      const batch = frontierNodeIds.slice(i, i + NODE_BATCH_SIZE).map(Number).filter(Number.isSafeInteger);
      if (!batch.length) continue;
      const result = await db.execute({ sql: `SELECT DISTINCT railway_way_id FROM osm_rail_way_nodes WHERE node_id IN (${placeholders(batch.length)})`, args: batch });
      for (const row of result.rows as any[]) {
        const id = String(row.railway_way_id);
        if (!loadedWayIds.has(id)) adjacentWayIds.add(id);
      }
    }
    if (!adjacentWayIds.size) break;
    frontierNodeIds = await addWays([...adjacentWayIds], true);
    const previousNodeCount = graph.nodePoints.size;
    graph = buildRailGraph(rows);
    if (graph.nodePoints.size === previousNodeCount) break;
  }
  return { graph, refs, mapping };
}

async function loadCorridorGraph(crossingId: string, route: RouteStation[]): Promise<CorridorGraph | null> {
  const mapping = await loadMapping(crossingId);
  if (!mapping) return null;
  const corridorStations = routeCorridorStations(mapping, route);
  if (corridorStations.length < 2) return null;
  const key = `${crossingId}|${corridorStations[0].name}|${corridorStations[1].name}`;
  const cached = corridorCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = corridorInFlight.get(key);
  if (existing) return existing;
  const request = (async () => {
    try {
      const value = await buildCorridorGraph(crossingId, route);
      if (value) corridorCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
      return value;
    } finally { corridorInFlight.delete(key); }
  })();
  corridorInFlight.set(key, request);
  return request;
}

export async function filterTrainByCrossingOsm(crossingId: string, route: string[] | undefined): Promise<CrossingOsmFilterResult> {
  if (!route?.length) return { status: "unknown" };
  const resultKey = `${crossingId}|${route.join("|")}`;
  const cachedResult = resultCache.get(resultKey);
  if (cachedResult && cachedResult.expiresAt > Date.now()) return cachedResult.value;
  try {
    const coordinateRoute = routeToCoordinates(route);
    const resolved = coordinateRoute.filter((s): s is CorridorTarget => s.lat != null && s.lon != null);
    if (resolved.length < 2) return { status: "unknown" };
    const mapping = await loadMapping(crossingId);
    if (!mapping || !mapping.crossingNodeIds.size) return { status: "unknown" };
    const localStations = routeCorridorStations(mapping, coordinateRoute);
    if (localStations.length < 2) {
      const rejected = { status: "rejected" } as CrossingOsmFilterResult;
      resultCache.set(resultKey, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, value: rejected });
      return rejected;
    }
    const corridor = await loadCorridorGraph(crossingId, coordinateRoute);
    if (!corridor) return { status: "unknown" };
    const { graph, refs } = corridor;
    const from = nearestNode(graph, localStations[0], 5000);
    const to = nearestNode(graph, localStations[1], 5000);
    if (!from || !to) {
      const rejected = { status: "rejected" } as CrossingOsmFilterResult;
      resultCache.set(resultKey, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, value: rejected });
      return rejected;
    }
    const path = shortestRailPath(graph, from.nodeId, to.nodeId, 150000);
    if (!path) {
      const rejected = { status: "rejected" } as CrossingOsmFilterResult;
      resultCache.set(resultKey, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, value: rejected });
      return rejected;
    }
    let best: { distance: number; wayId?: string; ref?: string } | null = null;
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
      if (!best || distance < best.distance) best = { distance, wayId: matchedWayId, ref: refs.get(matchedWayId) };
    }
    const result: CrossingOsmFilterResult = best ? { status: "matched", score: Math.max(0, 1 - best.distance / 100), railwayWayId: best.wayId, ref: best.ref } : { status: "rejected" };
    resultCache.set(resultKey, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, value: result });
    return result;
  } catch (error) {
    console.error("Failed to match train against OSM railway topology:", error);
    return { status: "unknown" };
  }
}
