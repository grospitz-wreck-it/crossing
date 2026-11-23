import { db } from "./db";
import {
  buildRailGraph,
  distanceMeters,
  nearestNode,
  shortestRailPath,
} from "./railGraph";
import type { GeoPoint, RailWayRow } from "./railGraph";
import type { RouteStation } from "../../../../packages/prediction-engine/src/routeOsmMatcher";
import { isTrainRouteNearCrossing } from "./crossingRouteProximity";

export type CrossingOsmFilterResult = {
  status: "matched" | "rejected" | "unknown";
  score?: number;
  railwayWayId?: string;
  ref?: string;
  reason?: string;
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

type CorridorGraph = {
  graph: ReturnType<typeof buildRailGraph>;
  wayIds: Set<string>;
};

const CACHE_TTL_MS = 300_000;
const RESULT_CACHE_TTL_MS = 300_000;

const stationCache = new Map<string, { expiresAt: number; value: RouteStation[] }>();
const resultCache = new Map<string, { expiresAt: number; value: CrossingOsmFilterResult }>();
const corridorGraphCache = new Map<string, { expiresAt: number; value: CorridorGraph | null }>();
let stationCatalogCache: { expiresAt: number; value: Map<string, RouteStation> } | null = null;
let stationCatalogPromise: Promise<Map<string, RouteStation>> | null = null;
const mappingCache = new Map<string, { expiresAt: number; value: Mapping | null }>();
const mappingPromises = new Map<string, Promise<Mapping | null>>();
const corridorGraphPromises = new Map<string, Promise<CorridorGraph | null>>();

function normalizeStationName(value: string) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\([^)]*\)/g, " ").replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ").replace(/[^a-z0-9]+/g, "").trim();
}

async function loadStationCatalog() {
  if (stationCatalogCache && stationCatalogCache.expiresAt > Date.now()) return stationCatalogCache.value;
  if (stationCatalogPromise) return stationCatalogPromise;
  stationCatalogPromise = (async () => {
    try {
      const result = await db.execute({ sql: `SELECT eva, name, lat, lon FROM railway_station_catalog WHERE lat IS NOT NULL AND lon IS NOT NULL`, args: [] });
      const byName = new Map<string, RouteStation>();
      for (const row of result.rows as any[]) {
        const name = String(row.name || "");
        const normalized = normalizeStationName(name);
        if (!normalized || byName.has(normalized)) continue;
        byName.set(normalized, { name, lat: Number(row.lat), lon: Number(row.lon) });
        const eva = String(row.eva || "").trim();
        if (eva) byName.set(normalizeStationName(eva), { name, lat: Number(row.lat), lon: Number(row.lon) });
      }
      stationCatalogCache = { expiresAt: Date.now() + CACHE_TTL_MS, value: byName };
      return byName;
    } finally { stationCatalogPromise = null; }
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
    console.log("[OSM ROUTE]", route.map((name, i) => ({ input: name, normalized: normalizeStationName(name), resolved: value[i]?.lat != null && value[i]?.lon != null, lat: value[i]?.lat, lon: value[i]?.lon })));
    stationCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  } catch (error) {
    console.error("Failed to resolve route stations:", error);
    return route.map((name) => ({ name }));
  }
}

async function loadMapping(crossingId: string): Promise<Mapping | null> {
  const linkResult = await db.execute({ sql: `SELECT crossing_id, osm_crossing_id, confidence FROM crossing_osm_links WHERE crossing_id = ? AND confidence >= 0.8 LIMIT 1`, args: [crossingId] });
  const link: any = linkResult.rows[0];
  if (!link) return null;
  const osmCrossingId = Number(link.osm_crossing_id);
  const crossingResult = await db.execute({ sql: `SELECT lat, lon FROM osm_crossings WHERE osm_id = ? LIMIT 1`, args: [osmCrossingId] });
  const crossingRow: any = crossingResult.rows[0];
  if (!crossingRow) return null;
  const tracksResult = await db.execute({ sql: `SELECT railway_way_id, crossing_node_index FROM osm_crossing_rail_ways WHERE crossing_osm_id = ?`, args: [osmCrossingId] });
  const tracks = tracksResult.rows as any[];
  console.log(`[OSM MAPPING DEBUG] crossing=${crossingId} osmCrossing=${osmCrossingId} tracks=${tracks.length} trackData=${JSON.stringify(tracks.map((track) => ({ railwayWayId: String(track.railway_way_id), crossingNodeIndex: Number(track.crossing_node_index) })))}`);
  const railwayWayIds = tracks.map((row) => String(row.railway_way_id)).filter(Boolean);
  if (!railwayWayIds.length) return null;
  const crossingNodeIds = new Set<string>();
  const nodeQueries = tracks.map((track) => ({ wayId: String(track.railway_way_id), index: Number(track.crossing_node_index) })).filter((track) => Number.isInteger(track.index) && track.index >= 0);
  for (const track of nodeQueries) {
    const nodeResult = await db.execute({ sql: `SELECT node_id FROM osm_rail_way_nodes WHERE railway_way_id = ? AND node_index = ? LIMIT 1`, args: [track.wayId, track.index] });
    const node = nodeResult.rows[0] as any;
    if (node?.node_id != null) crossingNodeIds.add(String(node.node_id));
  }
  console.log(`[OSM MAPPING DEBUG] crossing=${crossingId} crossingNodes=${[...crossingNodeIds].join(",")} nodeCount=${crossingNodeIds.size}`);
  return { crossingId: String(link.crossing_id), osmCrossingId, confidence: Number(link.confidence ?? 0), crossingLat: Number(crossingRow.lat), crossingLon: Number(crossingRow.lon), crossingNodeIds, railwayWayIds };
}

async function loadMappingCached(crossingId: string) {
  const cached = mappingCache.get(crossingId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = mappingPromises.get(crossingId);
  if (pending) return pending;
  const promise = loadMapping(crossingId).finally(() => mappingPromises.delete(crossingId));
  mappingPromises.set(crossingId, promise);
  const value = await promise;
  mappingCache.set(crossingId, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

const CORRIDOR_PROFILE_VERSION = 1;

type StoredCorridorProfile = {
  version: number;
  wayIds: string[];
  nodePoints: Array<[string, number, number]>;
  adjacency: Array<[string, Array<[string, number, string]>]>;
};

function deserializeCorridorProfile(raw: unknown): CorridorGraph | null {
  try {
    const profile = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!profile || profile.version !== CORRIDOR_PROFILE_VERSION ||
        !Array.isArray(profile.wayIds) || !Array.isArray(profile.nodePoints) ||
        !Array.isArray(profile.adjacency)) return null;
    const nodePoints = new Map<string, GeoPoint>();
    for (const entry of profile.nodePoints) {
      if (!Array.isArray(entry) || entry.length !== 3 ||
          !Number.isFinite(Number(entry[1])) || !Number.isFinite(Number(entry[2]))) return null;
      nodePoints.set(String(entry[0]), { lat: Number(entry[1]), lon: Number(entry[2]) });
    }
    const adjacency = new Map<string, Array<{ to: string; distance: number; wayId: string }>>();
    for (const entry of profile.adjacency) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Array.isArray(entry[1])) return null;
      const edges = entry[1].map((edge: any) => {
        if (!Array.isArray(edge) || edge.length !== 3 ||
            !Number.isFinite(Number(edge[1]))) throw new Error("Invalid corridor edge");
        return { to: String(edge[0]), distance: Number(edge[1]), wayId: String(edge[2]) };
      });
      adjacency.set(String(entry[0]), edges);
    }
    if (!nodePoints.size || !adjacency.size) return null;
    return { graph: { nodePoints, adjacency, wayIds: new Set(profile.wayIds.map(String)) }, wayIds: new Set(profile.wayIds.map(String)) };
  } catch {
    return null;
  }
}

async function loadPreparedCorridorGraph(crossingId: string): Promise<CorridorGraph | null> {
  try {
    const result = await db.execute({
      sql: `SELECT profile_json, profile_version FROM crossing_osm_corridors WHERE crossing_id = ? LIMIT 1`,
      args: [crossingId],
    });
    const row: any = result.rows[0];
    if (!row || Number(row.profile_version) !== CORRIDOR_PROFILE_VERSION || !row.profile_json) return null;
    return deserializeCorridorProfile(row.profile_json);
  } catch (error) {
    // Older databases may not have received the profile migration yet.
    console.warn(`[OSM PROFILE] crossing=${crossingId} prepared profile unavailable:`, error);
    return null;
  }
}

/**
 * Explicit preparation hook for an admin/selection workflow. This is never
 * called by the status endpoint; it performs the expensive graph expansion
 * once and stores the resulting graph for later read-only matching.
 */
export async function prepareCrossingOsmProfile(crossingId: string) {
  const corridor = await buildCorridorGraph(crossingId);
  if (!corridor) return { ok: false as const, reason: "corridor-unavailable" };
  const profile: StoredCorridorProfile = {
    version: CORRIDOR_PROFILE_VERSION,
    wayIds: [...corridor.wayIds],
    nodePoints: [...corridor.graph.nodePoints.entries()].map(([id, point]) => [id, point.lat, point.lon] as [string, number, number]),
    adjacency: [...corridor.graph.adjacency.entries()].map(([id, edges]) => [
      id,
      edges.map((edge) => [edge.to, edge.distance, edge.wayId] as [string, number, string]),
    ] as [string, Array<[string, number, string]>]),
  };
  const profileJson = JSON.stringify(profile);
  const profileBytes = new TextEncoder().encode(profileJson).length;
  const update = await db.execute({
    sql: `UPDATE crossing_osm_corridors
      SET profile_json = ?, profile_version = ?, profile_built_at = datetime('now'), updated_at = datetime('now')
      WHERE crossing_id = ?`,
    args: [profileJson, CORRIDOR_PROFILE_VERSION, crossingId],
  });
  if (Number(update.rowsAffected || 0) < 1) {
    return { ok: false as const, reason: "corridor-row-missing" };
  }
  corridorGraphCache.set(crossingId, { expiresAt: Date.now() + CACHE_TTL_MS, value: corridor });
  console.log(`[OSM PROFILE] prepared crossing=${crossingId} ways=${corridor.wayIds.size} nodes=${corridor.graph.nodePoints.size} bytes=${profileBytes}`);
  return { ok: true as const, ways: corridor.wayIds.size, nodes: corridor.graph.nodePoints.size, bytes: profileBytes };
}

async function loadCorridorGraph(crossingId: string): Promise<CorridorGraph | null> {
  const cached = corridorGraphCache.get(crossingId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = corridorGraphPromises.get(crossingId);
  if (pending) return pending;
  const promise = (async () => {
    const prepared = await loadPreparedCorridorGraph(crossingId);
    if (!prepared) {
      // Never expand an OSM graph in a live status request. Missing profiles
      // remain unknown until the explicit admin preparation workflow builds them.
      corridorGraphCache.set(crossingId, { expiresAt: Date.now() + CACHE_TTL_MS, value: null });
      return null;
    }
    corridorGraphCache.set(crossingId, { expiresAt: Date.now() + CACHE_TTL_MS, value: prepared });
    return prepared;
  })().finally(() => corridorGraphPromises.delete(crossingId));
  corridorGraphPromises.set(crossingId, promise);
  return promise;
}

async function buildCorridorGraph(crossingId: string): Promise<CorridorGraph | null> {
  const mapping = await loadMappingCached(crossingId);
  if (!mapping || mapping.railwayWayIds.length === 0 || mapping.crossingNodeIds.size === 0) {
    corridorGraphCache.set(crossingId, { expiresAt: Date.now() + CACHE_TTL_MS, value: null });
    return null;
  }
  const MAX_GRAPH_WAYS = 5000;
  const MAX_GRAPH_NODES = 150000;
  const MAX_EXPANSION_ROUNDS = 100;
  const WAY_BATCH_SIZE = 200;
  const NODE_BATCH_SIZE = 500;
  const loadedWayIds = new Set<string>();
  const frontierWayIds = new Set<string>(mapping.railwayWayIds.map(String));
  const allRows = new Map<string, RailWayRow>();
  let expansionRounds = 0;
  let expandedWays = 0;
  let expansionLimited = false;
  const parseWayRow = (row: any): RailWayRow | null => {
    try {
      const nodeIdsRaw = JSON.parse(String(row.node_ids_json || "[]"));
      const geometryRaw = JSON.parse(String(row.geometry_json || "[]"));
      const nodeIds = Array.isArray(nodeIdsRaw) ? nodeIdsRaw.map(String).filter(Boolean) : [];
      const geometry: GeoPoint[] = Array.isArray(geometryRaw) ? geometryRaw.map((point: any) => ({ lat: Number(point?.lat), lon: Number(point?.lon) })).filter((point: GeoPoint) => Number.isFinite(point.lat) && Number.isFinite(point.lon)) : [];
      if (nodeIds.length < 2 || geometry.length < 2) return null;
      let tags: Record<string, string> = {};
      try { tags = JSON.parse(String(row.tags_json || "{}")); } catch {}
      return { osmId: String(row.osm_id), nodeIds, geometry, ref: tags?.ref != null ? String(tags.ref) : undefined };
    } catch { return null; }
  };
  while (frontierWayIds.size > 0 && loadedWayIds.size < MAX_GRAPH_WAYS && expansionRounds < MAX_EXPANSION_ROUNDS) {
    expansionRounds += 1;
    const batchIds = [...frontierWayIds].filter((wayId) => !loadedWayIds.has(wayId)).slice(0, WAY_BATCH_SIZE);
    for (const wayId of batchIds) frontierWayIds.delete(wayId);
    if (!batchIds.length) break;
    const placeholders = batchIds.map(() => "?").join(",");
    const waysResult = await db.execute({ sql: `SELECT osm_id, node_ids_json, geometry_json, tags_json FROM osm_rail_ways WHERE osm_id IN (${placeholders})`, args: batchIds });
    const batchRows: RailWayRow[] = [];
    for (const row of waysResult.rows as any[]) {
      const way = parseWayRow(row);
      if (!way) continue;
      const wayId = String(way.osmId);
      if (loadedWayIds.has(wayId)) continue;
      loadedWayIds.add(wayId); allRows.set(wayId, way); batchRows.push(way);
    }
    expandedWays += batchRows.length;
    if (loadedWayIds.size >= MAX_GRAPH_WAYS) { expansionLimited = true; break; }
    const nodeIds = [...new Set(batchRows.flatMap((way) => way.nodeIds.map(String)))];
    if (allRows.size > MAX_GRAPH_WAYS || nodeIds.length > MAX_GRAPH_NODES) { expansionLimited = true; break; }
    if (!nodeIds.length) continue;
    for (let offset = 0; offset < nodeIds.length; offset += NODE_BATCH_SIZE) {
      const nodeBatch = nodeIds.slice(offset, offset + NODE_BATCH_SIZE);
      const nodePlaceholders = nodeBatch.map(() => "?").join(",");
      const connectedResult = await db.execute({ sql: `SELECT DISTINCT railway_way_id FROM osm_rail_way_nodes WHERE node_id IN (${nodePlaceholders})`, args: nodeBatch });
      for (const row of connectedResult.rows as any[]) {
        const connectedWayId = String(row.railway_way_id);
        if (!connectedWayId || loadedWayIds.has(connectedWayId)) continue;
        frontierWayIds.add(connectedWayId);
      }
    }
    const remainingCapacity = MAX_GRAPH_WAYS - loadedWayIds.size;
    if (frontierWayIds.size > remainingCapacity) {
      expansionLimited = true;
      const limitedFrontier = [...frontierWayIds].slice(0, Math.max(0, remainingCapacity));
      frontierWayIds.clear();
      for (const wayId of limitedFrontier) frontierWayIds.add(wayId);
    }
  }
  if (expansionRounds >= MAX_EXPANSION_ROUNDS && frontierWayIds.size > 0) expansionLimited = true;
  if (loadedWayIds.size >= MAX_GRAPH_WAYS) expansionLimited = true;
  if (!allRows.size) {
    corridorGraphCache.set(crossingId, { expiresAt: Date.now() + CACHE_TTL_MS, value: null });
    return null;
  }
  const graph = buildRailGraph([...allRows.values()]);
  if (graph.nodePoints.size > MAX_GRAPH_NODES) expansionLimited = true;
  const value: CorridorGraph = { graph, wayIds: graph.wayIds };
  corridorGraphCache.set(crossingId, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  console.log(`[OSM GRAPH] crossing=${crossingId} ways=${graph.wayIds.size} nodes=${graph.nodePoints.size} rounds=${expansionRounds} expandedWays=${expandedWays}${expansionLimited ? " expansion-limit" : ""}`);
  return value;
}

function findCrossingOnPath(graph: CorridorGraph["graph"], pathNodes: string[], crossingNodeIds: Set<string>) {
  for (let i = 0; i < pathNodes.length; i += 1) {
    const nodeId = pathNodes[i];
    if (!crossingNodeIds.has(nodeId)) continue;
    return { nodeId, index: i };
  }
  return null;
}

export async function filterTrainByCrossingOsm(crossingId: string, route: string[] | undefined, selectedWayIds?: string[]): Promise<CrossingOsmFilterResult> {
  if (!route?.length) return { status: "unknown", reason: "route-missing" };
  const selectedWays = selectedWayIds?.map(String).filter(Boolean) ?? [];
  const selectedWaySet = selectedWays.length ? new Set(selectedWays) : null;
  const resultKey = `${crossingId}|${selectedWays.slice().sort().join(",")}|${route.join("|")}`;
  const cachedResult = resultCache.get(resultKey);
  if (cachedResult && cachedResult.expiresAt > Date.now()) return cachedResult.value;
  try {
    const [mapping, coordinateRoute] = await Promise.all([loadMappingCached(crossingId), routeToCoordinates(route)]);
    if (!mapping) return { status: "unknown", reason: "crossing-osm-mapping-missing" };
    if (mapping.crossingNodeIds.size === 0) return { status: "unknown", reason: "crossing-osm-node-missing" };
    if (!isTrainRouteNearCrossing({ lat: mapping.crossingLat, lon: mapping.crossingLon }, coordinateRoute)) {
      const result: CrossingOsmFilterResult = { status: "rejected" };
      resultCache.set(resultKey, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, value: result });
      console.log(`[OSM MATCH] crossing=${crossingId} route=${route.join(" -> ")} result=REJECTED reason=route-too-far`);
      return result;
    }
    const corridor = await loadCorridorGraph(crossingId);
    if (!corridor) return { status: "unknown", reason: "corridor-profile-unavailable" };
    const stations = coordinateRoute.filter((station): station is RouteStation & { lat: number; lon: number } => station.lat != null && station.lon != null);
    if (stations.length < 2) return { status: "unknown", reason: `route-stations-unresolved:${stations.length}/${coordinateRoute.length}` };
    const graph = corridor.graph;
    let best: { fromIndex: number; toIndex: number; pathDistance: number; crossingDistance: number; wayId?: string; ref?: string } | undefined;
    // A prepared corridor is local to the crossing. OpenBoards via lists can
    // omit intermediate calls or return only partial route context, so the
    // immediately adjacent listed stops are not always both inside this graph.
    // Test ordered station pairs whose endpoints can be snapped to this local
    // corridor. The route order is preserved; no live graph expansion occurs.
    for (let toIndex = 1; toIndex < stations.length; toIndex += 1) {
      for (let fromIndex = toIndex - 1; fromIndex >= 0; fromIndex -= 1) {
      const from = stations[fromIndex];
      const to = stations[toIndex];
      const start = nearestNode(graph, { lat: from.lat, lon: from.lon }, 10_000);
      const target = nearestNode(graph, { lat: to.lat, lon: to.lon }, 10_000);
      if (!start || !target) continue;
      const path = shortestRailPath(graph, start.nodeId, target.nodeId, 50_000);
      if (!path) continue;
      const crossingHit = findCrossingOnPath(graph, path.nodes, mapping.crossingNodeIds);
      if (!crossingHit) continue;
      let railwayWayId: string | undefined;
      for (let i = 1; i < path.nodes.length; i += 1) {
        if (path.nodes[i] !== crossingHit.nodeId) continue;
        const previousNode = path.nodes[i - 1];
        const edges = graph.adjacency.get(previousNode) ?? [];
        const edge = edges.find((candidate) => candidate.to === crossingHit.nodeId && mapping.railwayWayIds.includes(candidate.wayId));
        if (edge) { railwayWayId = edge.wayId; break; }
      }
      if (!railwayWayId) continue;
      const graphPoint = graph.nodePoints.get(crossingHit.nodeId);
      if (!graphPoint) continue;
      const crossingDistance = distanceMeters({ lat: mapping.crossingLat, lon: mapping.crossingLon }, graphPoint);
      if (!best || crossingDistance < best.crossingDistance) best = { fromIndex, toIndex, pathDistance: path.distance, crossingDistance, wayId: railwayWayId };
      }
    }
    if (!best) {
      // With explicit user-selected tracks, an incomplete route/network match
      // is not evidence that the train uses another track.
      if (selectedWaySet) return { status: "unknown", reason: "no-network-path-through-crossing" };
      const result: CrossingOsmFilterResult = { status: "rejected" };
      resultCache.set(resultKey, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, value: result });
      console.log(`[OSM MATCH] crossing=${crossingId} route=${route.join(" -> ")} result=REJECTED reason=no-network-path`);
      return result;
    }
    if (selectedWaySet && best.wayId && !selectedWaySet.has(String(best.wayId))) {
      const result: CrossingOsmFilterResult = { status: "rejected", railwayWayId: best.wayId, ref: best.ref };
      resultCache.set(resultKey, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, value: result });
      console.log(`[OSM MATCH] crossing=${crossingId} selected-track-mismatch matchedWay=${best.wayId} selected=${selectedWays.join(",")} result=REJECTED`);
      return result;
    }
    const MAX_CROSSING_NODE_DISTANCE = 50;
    if (best.crossingDistance > MAX_CROSSING_NODE_DISTANCE) {
      const result: CrossingOsmFilterResult = { status: "unknown", railwayWayId: best.wayId, reason: `crossing-node-too-far:${best.crossingDistance.toFixed(1)}m` };
      resultCache.set(resultKey, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, value: result });
      console.log(`[OSM MATCH] crossing=${crossingId} result=UNKNOWN crossingDistance=${best.crossingDistance.toFixed(1)}m`);
      return result;
    }
    const score = Math.max(0, 1 - best.crossingDistance / MAX_CROSSING_NODE_DISTANCE);
    let ref: string | undefined;
    if (best.wayId) {
      const refResult = await db.execute({ sql: `SELECT tags_json FROM osm_rail_ways WHERE osm_id = ? LIMIT 1`, args: [best.wayId] });
      const refRow: any = refResult.rows[0];
      if (refRow) {
        try { const tags = JSON.parse(String(refRow.tags_json || "{}")); if (tags?.ref != null) ref = String(tags.ref); } catch {}
      }
    }
    const result: CrossingOsmFilterResult = { status: "matched", score, railwayWayId: best.wayId, ref };
    resultCache.set(resultKey, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, value: result });
    console.log(`[OSM MATCH] crossing=${crossingId} segment=${stations[best.fromIndex].name} -> ${stations[best.toIndex].name} way=${best.wayId ?? "?"} ref=${ref ?? "?"} pathDistance=${best.pathDistance.toFixed(0)}m crossingDistance=${best.crossingDistance.toFixed(1)}m score=${score.toFixed(3)} result=MATCHED`);
    return result;
  } catch (error) {
    console.error(`[OSM MATCH] crossing=${crossingId} failed:`, error);
    return { status: "unknown", reason: "osm-filter-exception" };
  }
}
