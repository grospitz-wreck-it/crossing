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
  directedDistanceMeters?: number;
  diagnostics?: {
    routeStations?: Array<{ name: string; nodeId: string | null; snapDistanceMeters: number | null }>;
    crossingNodes?: Array<{ nodeId: string; presentInGraph: boolean; degree: number; selectedWayEdges: string[] }>;
    observationStation?: string;
    crossingBeforeObservation?: boolean;
  };
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
  complete: true;
};

const CACHE_TTL_MS = 300_000;
const STATION_CATALOG_CACHE_TTL_MS = 24 * 60 * 60_000;
const RESULT_CACHE_TTL_MS = 300_000;
const NEGATIVE_CORRIDOR_CACHE_TTL_MS = 15_000;

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
      console.info(`[STATION CATALOG] source=web mode=full-scan rows=${result.rows.length}`);
      const byName = new Map<string, RouteStation>();
      for (const row of result.rows as any[]) {
        const name = String(row.name || "");
        const normalized = normalizeStationName(name);
        if (!normalized || byName.has(normalized)) continue;
        byName.set(normalized, { name, lat: Number(row.lat), lon: Number(row.lon) });
        const eva = String(row.eva || "").trim();
        if (eva) byName.set(normalizeStationName(eva), { name, lat: Number(row.lat), lon: Number(row.lon) });
      }
      stationCatalogCache = { expiresAt: Date.now() + STATION_CATALOG_CACHE_TTL_MS, value: byName };
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
  const linkResult = await db.execute({
    sql: `SELECT crossing_id, osm_crossing_id, confidence
      FROM crossing_osm_links
      WHERE crossing_id = ? AND confidence >= 0.8 LIMIT 1`,
    args: [crossingId],
  });
  const link: any = linkResult.rows[0];
  if (!link) return null;

  const osmCrossingId = Number(link.osm_crossing_id);
  if (!Number.isSafeInteger(osmCrossingId) || osmCrossingId <= 0) return null;

  const [crossingResult, corridorResult] = await Promise.all([
    db.execute({
      sql: `SELECT lat, lon FROM osm_crossings WHERE osm_id = ? LIMIT 1`,
      args: [osmCrossingId],
    }),
    db.execute({
      sql: `SELECT railway_way_ids_json
        FROM crossing_osm_corridors WHERE crossing_id = ? LIMIT 1`,
      args: [crossingId],
    }),
  ]);
  const crossingRow: any = crossingResult.rows[0];
  if (!crossingRow) return null;

  // The linked OSM crossing ID is itself the OSM node ID.
  const crossingNodeIds = new Set<string>([String(osmCrossingId)]);

  // The corridor is the authoritative selected physical-track set. In
  // particular, it may contain multiple adjacent ways for one multi-track BÜ.
  let railwayWayIds: string[] = [];
  const corridorRow: any = corridorResult.rows[0];
  if (corridorRow?.railway_way_ids_json) {
    try {
      const parsed = JSON.parse(String(corridorRow.railway_way_ids_json));
      if (Array.isArray(parsed)) {
        railwayWayIds = [...new Set(parsed.map((value: unknown) => String(value).trim()).filter(Boolean))];
      }
    } catch (error) {
      console.warn(`[OSM MAPPING] invalid corridor way list for crossing=${crossingId}:`, error);
    }
  }

  // A grouped multi-track corridor can contain one OSM crossing node per
  // physical track. Recover those sibling nodes from the existing crossing
  // index, constrained to the selected ways and the resolver's 12m grouping
  // radius (+3m tolerance). This preserves both Nord/Süd node identities.
  if (railwayWayIds.length) {
    const latDelta = 15 / 110_000;
    const lonDelta = 15 / (111_320 * Math.max(0.2, Math.cos(Number(crossingRow.lat) * Math.PI / 180)));
    const placeholders = railwayWayIds.map(() => "?").join(",");
    const siblingResult = await db.execute({
      sql: `SELECT DISTINCT oc.osm_id, oc.lat, oc.lon
        FROM osm_crossings oc
        JOIN osm_crossing_rail_ways crw ON crw.crossing_osm_id = oc.osm_id
        WHERE crw.railway_way_id IN (${placeholders})
          AND oc.lat BETWEEN ? AND ?
          AND oc.lon BETWEEN ? AND ?`,
      args: [
        ...railwayWayIds,
        Number(crossingRow.lat) - latDelta,
        Number(crossingRow.lat) + latDelta,
        Number(crossingRow.lon) - lonDelta,
        Number(crossingRow.lon) + lonDelta,
      ],
    });
    for (const row of siblingResult.rows as any[]) {
      const distance = distanceMeters(
        { lat: Number(crossingRow.lat), lon: Number(crossingRow.lon) },
        { lat: Number(row.lat), lon: Number(row.lon) },
      );
      if (Number.isFinite(distance) && distance <= 15) {
        crossingNodeIds.add(String(row.osm_id));
      }
    }
  }

  // Backward compatibility for older links that predate corridor rows.
  if (!railwayWayIds.length) {
    const tracksResult = await db.execute({
      sql: `SELECT railway_way_id FROM osm_crossing_rail_ways WHERE crossing_osm_id = ?`,
      args: [osmCrossingId],
    });
    railwayWayIds = [...new Set((tracksResult.rows as any[])
      .map((row) => String(row.railway_way_id || "").trim())
      .filter(Boolean))];
  }

  console.log(
    `[OSM MAPPING DEBUG] crossing=${crossingId} osmCrossing=${osmCrossingId} ` +
    `crossingNodes=[${[...crossingNodeIds].join(",")}] ways=[${railwayWayIds.join(",")}]`,
  );

  if (!railwayWayIds.length) return null;
  return {
    crossingId: String(link.crossing_id),
    osmCrossingId,
    confidence: Number(link.confidence ?? 0),
    crossingLat: Number(crossingRow.lat),
    crossingLon: Number(crossingRow.lon),
    crossingNodeIds,
    railwayWayIds,
  };
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

// Version 2 explicitly records that graph expansion reached a fixed point.
 // Older profiles were allowed to persist even when expansion hit a safety
 // limit; they must be rebuilt before they can produce a positive match.
const CORRIDOR_PROFILE_VERSION = 3;

type StoredCorridorProfile = {
  version: number;
  wayIds: string[];
  nodePoints: Array<[string, number, number]>;
  adjacency: Array<[string, Array<[string, number, string]>]>;
  complete: true;
};

function deserializeCorridorProfile(raw: unknown): CorridorGraph | null {
  try {
    const profile = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!profile || profile.version !== CORRIDOR_PROFILE_VERSION || profile.complete !== true ||
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
    const wayIds = new Set<string>((profile.wayIds as unknown[]).map((id) => String(id)));
    return { graph: { nodePoints, adjacency, wayIds }, wayIds, complete: true };
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
    if (!row) {
      console.warn(`[OSM PROFILE] crossing=${crossingId} missing corridor row`);
      return null;
    }
    const storedVersion = Number(row.profile_version || 0);
    if (storedVersion !== CORRIDOR_PROFILE_VERSION || !row.profile_json) {
      console.warn(`[OSM PROFILE] crossing=${crossingId} unavailable storedVersion=${storedVersion} expectedVersion=${CORRIDOR_PROFILE_VERSION} hasJson=${Boolean(row.profile_json)}`);
      return null;
    }
    const profile = deserializeCorridorProfile(row.profile_json);
    if (!profile) {
      const rawBytes = typeof row.profile_json === "string" ? new TextEncoder().encode(row.profile_json).length : 0;
      console.warn(`[OSM PROFILE] crossing=${crossingId} invalid version=${storedVersion} bytes=${rawBytes}`);
      return null;
    }
    console.log(`[OSM PROFILE] crossing=${crossingId} loaded version=${storedVersion} ways=${profile.wayIds.size} nodes=${profile.graph.nodePoints.size} edges=${[...profile.graph.adjacency.values()].reduce((sum, edges) => sum + edges.length, 0)}`);
    return profile;
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
  const build = await buildCorridorGraph(crossingId);
  if (build.ok === false) return { ok: false as const, reason: build.reason, diagnostics: build.diagnostics };
  const corridor = build.corridor;
  const profile: StoredCorridorProfile = {
    version: CORRIDOR_PROFILE_VERSION,
    complete: true,
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
      corridorGraphCache.set(crossingId, { expiresAt: Date.now() + NEGATIVE_CORRIDOR_CACHE_TTL_MS, value: null });
      return null;
    }
    corridorGraphCache.set(crossingId, { expiresAt: Date.now() + CACHE_TTL_MS, value: prepared });
    return prepared;
  })().finally(() => corridorGraphPromises.delete(crossingId));
  corridorGraphPromises.set(crossingId, promise);
  return promise;
}

type CorridorBuildFailure = {
  ok: false;
  reason: "mapping-missing" | "no-ways-loaded" | "max-graph-ways" | "max-graph-nodes" | "max-expansion-rounds" | "frontier-over-capacity" | "graph-invalid";
  diagnostics: { rounds: number; loadedWays: number; loadedNodes: number; frontierWays: number; parsedWays: number; stopReason: string };
};

async function buildCorridorGraph(crossingId: string): Promise<{ ok: true; corridor: CorridorGraph } | CorridorBuildFailure> {
  const mapping = await loadMappingCached(crossingId);
  if (!mapping || mapping.railwayWayIds.length === 0 || mapping.crossingNodeIds.size === 0) {
    corridorGraphCache.set(crossingId, { expiresAt: Date.now() + NEGATIVE_CORRIDOR_CACHE_TTL_MS, value: null });
    const diagnostics = { rounds: 0, loadedWays: 0, loadedNodes: 0, frontierWays: 0, parsedWays: 0, stopReason: "mapping-or-selected-ways-missing" };
    console.warn(`[OSM GRAPH] crossing=${crossingId} build-failed reason=mapping-missing`, diagnostics);
    return { ok: false, reason: "mapping-missing", diagnostics };
  }

  const MAX_GRAPH_WAYS = 5000;
  const MAX_GRAPH_NODES = 150000;
  const MAX_EXPANSION_ROUNDS = 100;
  const WAY_BATCH_SIZE = 200;
  const NODE_BATCH_SIZE = 500;
  // The route-proximity filter only admits routes passing within 8 km of the
  // crossing. A 20 km graph radius leaves room for station snapping while
  // preventing expansion through the entire connected German rail network.
  const CORRIDOR_RADIUS_METERS = 20_000;
  const center = { lat: mapping.crossingLat, lon: mapping.crossingLon };
  const lonScale = 111_320 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180));

  const isWayWithinCorridor = (way: RailWayRow) => {
    const points = way.geometry;
    if (points.length < 2) return false;
    const xy = points.map((point) => ({
      x: (point.lon - center.lon) * lonScale,
      y: (point.lat - center.lat) * 111_320,
    }));
    for (const point of xy) {
      if (Math.hypot(point.x, point.y) <= CORRIDOR_RADIUS_METERS) return true;
    }
    // Check segments as well as vertices so a long OSM segment crossing the
    // radius is not accidentally discarded just because both endpoints lie
    // outside the circle.
    for (let i = 1; i < xy.length; i += 1) {
      const a = xy[i - 1];
      const b = xy[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared > 0
        ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared))
        : 0;
      if (Math.hypot(a.x + t * dx, a.y + t * dy) <= CORRIDOR_RADIUS_METERS) return true;
    }
    return false;
  };

  const parseWayRow = (row: any): RailWayRow | null => {
    try {
      const nodeIdsRaw = JSON.parse(String(row.node_ids_json || "[]"));
      const geometryRaw = JSON.parse(String(row.geometry_json || "[]"));
      const nodeIds = Array.isArray(nodeIdsRaw) ? nodeIdsRaw.map(String).filter(Boolean) : [];
      const geometry: GeoPoint[] = Array.isArray(geometryRaw)
        ? geometryRaw.map((point: any) => ({ lat: Number(point?.lat), lon: Number(point?.lon) }))
          .filter((point: GeoPoint) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
        : [];
      if (nodeIds.length < 2 || geometry.length < 2) return null;
      let tags: Record<string, string> = {};
      try { tags = JSON.parse(String(row.tags_json || "{}")); } catch {}
      return { osmId: String(row.osm_id), nodeIds, geometry, ref: tags?.ref != null ? String(tags.ref) : undefined };
    } catch {
      return null;
    }
  };

  const loadedWayIds = new Set<string>();
  const frontierWayIds = new Set<string>(mapping.railwayWayIds.map(String));
  const candidateRows = new Map<string, RailWayRow>();
  const allRows = new Map<string, RailWayRow>();
  let expansionRounds = 0;
  let expandedWays = 0;
  let excludedOutsideRadius = 0;
  let expansionLimited = false;
  let stopReason = "";

  while (frontierWayIds.size > 0 && loadedWayIds.size < MAX_GRAPH_WAYS && expansionRounds < MAX_EXPANSION_ROUNDS) {
    expansionRounds += 1;
    const frontierBefore = frontierWayIds.size;
    const loadedBefore = loadedWayIds.size;
    const batchIds = [...frontierWayIds].filter((wayId) => !loadedWayIds.has(wayId)).slice(0, WAY_BATCH_SIZE);
    for (const wayId of batchIds) frontierWayIds.delete(wayId);
    if (!batchIds.length) break;

    const batchRowsById = new Map<string, RailWayRow>();
    const idsToFetch = batchIds.filter((wayId) => !candidateRows.has(wayId));
    if (idsToFetch.length) {
      const placeholders = idsToFetch.map(() => "?").join(",");
      const waysResult = await db.execute({
        sql: `SELECT osm_id, node_ids_json, geometry_json, tags_json FROM osm_rail_ways WHERE osm_id IN (${placeholders})`,
        args: idsToFetch,
      });
      for (const row of waysResult.rows as any[]) {
        const way = parseWayRow(row);
        if (way) batchRowsById.set(String(way.osmId), way);
      }
    }

    const batchRows: RailWayRow[] = [];
    for (const wayId of batchIds) {
      const way = candidateRows.get(wayId) ?? batchRowsById.get(wayId);
      candidateRows.delete(wayId);
      if (!way || loadedWayIds.has(wayId)) continue;
      loadedWayIds.add(wayId);
      allRows.set(wayId, way);
      batchRows.push(way);
    }
    expandedWays += batchRows.length;
    if (loadedWayIds.size >= MAX_GRAPH_WAYS) {
      expansionLimited = true;
      stopReason = "max-graph-ways";
      break;
    }

    const nodeIds = [...new Set(batchRows.flatMap((way) => way.nodeIds.map(String)))];
    if (nodeIds.length > MAX_GRAPH_NODES) {
      expansionLimited = true;
      stopReason = "max-graph-nodes-in-batch";
      break;
    }
    if (!nodeIds.length) continue;

    const connectedWayIds = new Set<string>();
    for (let offset = 0; offset < nodeIds.length; offset += NODE_BATCH_SIZE) {
      const nodeBatch = nodeIds.slice(offset, offset + NODE_BATCH_SIZE);
      const nodePlaceholders = nodeBatch.map(() => "?").join(",");
      const connectedResult = await db.execute({
        sql: `SELECT DISTINCT railway_way_id FROM osm_rail_way_nodes WHERE node_id IN (${nodePlaceholders})`,
        args: nodeBatch,
      });
      for (const row of connectedResult.rows as any[]) {
        const connectedWayId = String(row.railway_way_id || "");
        if (connectedWayId && !loadedWayIds.has(connectedWayId) && !frontierWayIds.has(connectedWayId)) {
          connectedWayIds.add(connectedWayId);
        }
      }
    }

    // Only enqueue connected ways whose actual geometry intersects the local
    // corridor circle. This is the key boundary: shared nodes alone must not
    // pull the graph outward indefinitely through distant railway networks.
    const candidateIds = [...connectedWayIds];
    for (let offset = 0; offset < candidateIds.length; offset += WAY_BATCH_SIZE) {
      const candidateBatch = candidateIds.slice(offset, offset + WAY_BATCH_SIZE);
      const placeholders = candidateBatch.map(() => "?").join(",");
      const candidateResult = await db.execute({
        sql: `SELECT osm_id, node_ids_json, geometry_json, tags_json FROM osm_rail_ways WHERE osm_id IN (${placeholders})`,
        args: candidateBatch,
      });
      for (const row of candidateResult.rows as any[]) {
        const way = parseWayRow(row);
        if (!way) continue;
        const wayId = String(way.osmId);
        if (isWayWithinCorridor(way)) {
          candidateRows.set(wayId, way);
          frontierWayIds.add(wayId);
        } else {
          excludedOutsideRadius += 1;
        }
      }
    }

    const remainingCapacity = MAX_GRAPH_WAYS - loadedWayIds.size;
    if (frontierWayIds.size > remainingCapacity) {
      expansionLimited = true;
      stopReason = "frontier-over-capacity";
      const limitedFrontier = [...frontierWayIds].slice(0, Math.max(0, remainingCapacity));
      frontierWayIds.clear();
      for (const wayId of limitedFrontier) frontierWayIds.add(wayId);
    }

    console.log(
      `[OSM GRAPH ROUND] crossing=${crossingId} round=${expansionRounds} frontierBefore=${frontierBefore} ` +
      `requestedWays=${batchIds.length} parsedWays=${batchRows.length} loadedBefore=${loadedBefore} ` +
      `loadedAfter=${loadedWayIds.size} batchNodes=${nodeIds.length} frontierAfter=${frontierWayIds.size} ` +
      `excludedOutsideRadius=${excludedOutsideRadius} radiusMeters=${CORRIDOR_RADIUS_METERS}`,
    );
  }

  if (expansionRounds >= MAX_EXPANSION_ROUNDS && frontierWayIds.size > 0) {
    expansionLimited = true;
    stopReason ||= "max-expansion-rounds";
  }
  if (loadedWayIds.size >= MAX_GRAPH_WAYS) {
    expansionLimited = true;
    stopReason ||= "max-graph-ways";
  }

  if (!allRows.size) {
    corridorGraphCache.set(crossingId, { expiresAt: Date.now() + NEGATIVE_CORRIDOR_CACHE_TTL_MS, value: null });
    const diagnostics = {
      rounds: expansionRounds, loadedWays: loadedWayIds.size, loadedNodes: 0,
      frontierWays: frontierWayIds.size, parsedWays: expandedWays, stopReason: "no-ways-loaded",
    };
    console.warn(`[OSM GRAPH] crossing=${crossingId} build-failed reason=no-ways-loaded`, diagnostics);
    return { ok: false, reason: "no-ways-loaded", diagnostics };
  }

  const graph = buildRailGraph([...allRows.values()]);
  if (graph.nodePoints.size > MAX_GRAPH_NODES) {
    expansionLimited = true;
    stopReason ||= "max-graph-nodes";
  }
  if (!graph.nodePoints.size || !graph.adjacency.size) {
    const diagnostics = {
      rounds: expansionRounds, loadedWays: loadedWayIds.size, loadedNodes: graph.nodePoints.size,
      frontierWays: frontierWayIds.size, parsedWays: expandedWays, stopReason: "graph-empty-or-invalid",
    };
    console.warn(`[OSM GRAPH] crossing=${crossingId} build-failed reason=graph-invalid`, diagnostics);
    return { ok: false, reason: "graph-invalid", diagnostics };
  }

  // A truncated graph can make a wrong route appear to be the only available
  // route. Never persist or use it for a positive crossing assignment.
  if (expansionLimited) {
    corridorGraphCache.set(crossingId, { expiresAt: Date.now() + NEGATIVE_CORRIDOR_CACHE_TTL_MS, value: null });
    const reason = stopReason === "max-graph-ways" ? "max-graph-ways"
      : stopReason === "max-graph-nodes-in-batch" || stopReason === "max-graph-nodes" ? "max-graph-nodes"
      : stopReason === "max-expansion-rounds" ? "max-expansion-rounds"
      : stopReason === "frontier-over-capacity" ? "frontier-over-capacity"
      : "graph-invalid";
    const diagnostics = {
      rounds: expansionRounds, loadedWays: graph.wayIds.size, loadedNodes: graph.nodePoints.size,
      frontierWays: frontierWayIds.size, parsedWays: expandedWays,
      stopReason: stopReason || "expansion-limit",
    };
    console.warn(`[OSM GRAPH] crossing=${crossingId} build-failed reason=${reason}`, {
      ...diagnostics, excludedOutsideRadius, radiusMeters: CORRIDOR_RADIUS_METERS,
    });
    return { ok: false, reason, diagnostics };
  }

  const value: CorridorGraph = { graph, wayIds: graph.wayIds, complete: true };
  corridorGraphCache.set(crossingId, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  console.log(
    `[OSM GRAPH] crossing=${crossingId} complete ways=${graph.wayIds.size} nodes=${graph.nodePoints.size} ` +
    `rounds=${expansionRounds} expandedWays=${expandedWays} excludedOutsideRadius=${excludedOutsideRadius} ` +
    `radiusMeters=${CORRIDOR_RADIUS_METERS}`,
  );
  return { ok: true, corridor: value };
}

function findCrossingOnPath(graph: CorridorGraph["graph"], pathNodes: string[], crossingNodeIds: Set<string>) {
  for (let i = 0; i < pathNodes.length; i += 1) {
    const nodeId = pathNodes[i];
    if (!crossingNodeIds.has(nodeId)) continue;
    return { nodeId, index: i };
  }
  return null;
}

export async function filterTrainByCrossingOsm(crossingId: string, route: string[] | undefined, selectedWayIds?: string[], observationStation?: string): Promise<CrossingOsmFilterResult> {
  if (!route?.length) return { status: "unknown", reason: "route-missing" };
  const selectedWays = selectedWayIds?.map(String).filter(Boolean) ?? [];
  const selectedWaySet = selectedWays.length ? new Set(selectedWays) : null;
  const resultKey = `${crossingId}|${selectedWays.slice().sort().join(",")}|${route.join("|")}|${observationStation || ""}`;
  const cachedResult = resultCache.get(resultKey);
  if (cachedResult && cachedResult.expiresAt > Date.now()) return cachedResult.value;
  try {
    const mapping = await loadMappingCached(crossingId);
    if (!mapping) return { status: "unknown", reason: "crossing-osm-mapping-missing" };
    if (mapping.crossingNodeIds.size === 0) return { status: "unknown", reason: "crossing-osm-node-missing" };

    // The UI-selected physical ways and the persisted corridor must describe
    // exactly the same infrastructure. A partial/stale selection is not a
    // valid basis for a positive assignment.
    if (selectedWaySet) {
      const mappedWays = new Set(mapping.railwayWayIds.map(String));
      const sameSelection = selectedWaySet.size === mappedWays.size &&
        [...selectedWaySet].every((wayId) => mappedWays.has(wayId));
      if (!sameSelection) {
        return {
          status: "unknown",
          reason: "selected-track-corridor-mismatch",
          diagnostics: {
            crossingNodes: [...mapping.crossingNodeIds].map((nodeId) => ({
              nodeId,
              presentInGraph: false,
              degree: 0,
              selectedWayEdges: [],
            })),
          },
        };
      }
    }
    const coordinateRoute = await routeToCoordinates(route);
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
    const crossingHits: Array<{ fromIndex: number; toIndex: number; pathDistance: number; distanceFromStart: number; distanceToEnd: number; crossingDistance: number; wayId: string; nodeId: string }> = [];
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
      const crossingPathIndex = crossingHit.index;
      const adjacentSelectedWays = new Set<string>();
      if (crossingPathIndex > 0) {
        const previousNode = path.nodes[crossingPathIndex - 1];
        for (const edge of graph.adjacency.get(previousNode) ?? []) {
          if (edge.to === crossingHit.nodeId && mapping.railwayWayIds.includes(edge.wayId)) {
            adjacentSelectedWays.add(edge.wayId);
          }
        }
      }
      if (crossingPathIndex < path.nodes.length - 1) {
        const nextNode = path.nodes[crossingPathIndex + 1];
        for (const edge of graph.adjacency.get(crossingHit.nodeId) ?? []) {
          if (edge.to === nextNode && mapping.railwayWayIds.includes(edge.wayId)) {
            adjacentSelectedWays.add(edge.wayId);
          }
        }
      }
      // A route may enter and leave a crossing node through two different
      // selected ways. Without a topology-level continuation proof, that is
      // not enough to identify one physical track.
      if (adjacentSelectedWays.size !== 1) continue;
      const railwayWayId = [...adjacentSelectedWays][0];
      const graphPoint = graph.nodePoints.get(crossingHit.nodeId);
      if (!graphPoint) continue;
      const crossingDistance = distanceMeters({ lat: mapping.crossingLat, lon: mapping.crossingLon }, graphPoint);
      const pathDistanceAt = (startIndex: number, endIndex: number) => {
        let distance = 0;
        for (let index = startIndex + 1; index <= endIndex; index += 1) {
          const a = graph.nodePoints.get(path.nodes[index - 1]);
          const b = graph.nodePoints.get(path.nodes[index]);
          if (!a || !b) return NaN;
          distance += distanceMeters(a, b);
        }
        return distance;
      };
      const distanceFromStart = pathDistanceAt(0, crossingPathIndex);
      const distanceToEnd = pathDistanceAt(crossingPathIndex, path.nodes.length - 1);
      crossingHits.push({ fromIndex, toIndex, pathDistance: path.distance, distanceFromStart, distanceToEnd, crossingDistance, wayId: railwayWayId, nodeId: crossingHit.nodeId });
      }
    }
    if (!crossingHits.length) {
      // With explicit user-selected tracks, an incomplete route/network match
      // is not evidence that the train uses another track. Include compact
      // topology diagnostics so missing station snaps or disconnected crossing
      // nodes can be distinguished without expanding the graph on a live request.
      if (selectedWaySet) {
        const routeStations = stations.map((station) => {
          const snap = nearestNode(graph, { lat: station.lat, lon: station.lon }, 10_000);
          return {
            name: station.name,
            nodeId: snap?.nodeId ?? null,
            snapDistanceMeters: snap ? Math.round(snap.distance) : null,
          };
        });
        const crossingNodes = [...mapping.crossingNodeIds].map((nodeId) => ({
          nodeId,
          presentInGraph: graph.nodePoints.has(nodeId),
          degree: graph.adjacency.get(nodeId)?.length ?? 0,
          selectedWayEdges: (graph.adjacency.get(nodeId) ?? [])
            .filter((edge) => mapping.railwayWayIds.includes(edge.wayId))
            .map((edge) => edge.wayId),
        }));
        return {
          status: "unknown",
          reason: "no-network-path-through-crossing",
          diagnostics: { routeStations, crossingNodes },
        };
      }
      const result: CrossingOsmFilterResult = { status: "rejected" };
      resultCache.set(resultKey, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, value: result });
      console.log(`[OSM MATCH] crossing=${crossingId} route=${route.join(" -> ")} result=REJECTED reason=no-network-path`);
      return result;
    }
    // Several ordered station pairs can produce a crossing path. If they
    // imply different physical selected ways, the available stop sequence
    // does not identify one track uniquely. Do not pick whichever happens
    // to have the closest OSM crossing coordinate.
    const candidateWayIds = [...new Set(crossingHits.map((hit) => hit.wayId))];
    if (candidateWayIds.length !== 1) {
      return {
        status: "unknown",
        reason: "ambiguous-track-paths",
        diagnostics: {
          routeStations: stations.map((station) => {
            const snap = nearestNode(graph, { lat: station.lat, lon: station.lon }, 10_000);
            return { name: station.name, nodeId: snap?.nodeId ?? null, snapDistanceMeters: snap ? Math.round(snap.distance) : null };
          }),
          crossingNodes: [...mapping.crossingNodeIds].map((nodeId) => ({
            nodeId,
            presentInGraph: graph.nodePoints.has(nodeId),
            degree: graph.adjacency.get(nodeId)?.length ?? 0,
            selectedWayEdges: (graph.adjacency.get(nodeId) ?? [])
              .filter((edge) => mapping.railwayWayIds.includes(edge.wayId))
              .map((edge) => edge.wayId),
          })),
        },
      };
    }

    const observationIndex = observationStation
      ? route.findIndex((name) => normalizeStationName(name) === normalizeStationName(observationStation))
      : -1;
    const directedHits = crossingHits.map((hit) => ({
      ...hit,
      signedDistanceMeters: observationIndex === hit.fromIndex && Number.isFinite(hit.distanceFromStart)
        ? hit.distanceFromStart
        : observationIndex === hit.toIndex && Number.isFinite(hit.distanceToEnd)
          ? -hit.distanceToEnd
          : null,
    }));
    const best = directedHits.sort((a, b) =>
      Number(b.signedDistanceMeters != null) - Number(a.signedDistanceMeters != null) ||
      a.crossingDistance - b.crossingDistance
    )[0];
    if (selectedWaySet && !selectedWaySet.has(String(best.wayId))) {
      const result: CrossingOsmFilterResult = { status: "rejected", railwayWayId: best.wayId };
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
    const result: CrossingOsmFilterResult = {
      status: "matched",
      score,
      railwayWayId: best.wayId,
      ref,
      reason: best.signedDistanceMeters == null ? "matched-direction-distance-unavailable" : "matched-with-directed-distance",
      directedDistanceMeters: best.signedDistanceMeters == null ? undefined : Math.round(best.signedDistanceMeters),
      diagnostics: best.signedDistanceMeters == null ? undefined : {
        observationStation,
        crossingBeforeObservation: best.signedDistanceMeters < 0,
      },
    };
    resultCache.set(resultKey, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, value: result });
    console.log(`[OSM MATCH] crossing=${crossingId} segment=${stations[best.fromIndex].name} -> ${stations[best.toIndex].name} way=${best.wayId ?? "?"} ref=${ref ?? "?"} pathDistance=${best.pathDistance.toFixed(0)}m crossingDistance=${best.crossingDistance.toFixed(1)}m score=${score.toFixed(3)} result=MATCHED`);
    return result;
  } catch (error) {
    console.error(`[OSM MATCH] crossing=${crossingId} failed:`, error);
    return { status: "unknown", reason: "osm-filter-exception" };
  }
}