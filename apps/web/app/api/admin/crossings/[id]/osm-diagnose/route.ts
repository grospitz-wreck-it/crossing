import { db } from "../../../../../lib/db";
import { getStationTimetable } from "../../../../../../../../packages/db-api-client/src/getStationTimetable";

type Point = { lat: number; lon: number };
type Train = { category: string; journeyNumber: string; line?: string; origin?: string; destination?: string; route?: Array<any> };

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

function parseJson(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  try { return value ? JSON.parse(String(value)) : []; } catch { return []; }
}

function pointSegmentDistance(p: Point, a: Point, b: Point) {
  const scale = 111320;
  const cos = Math.cos((p.lat * Math.PI) / 180);
  const x = (p.lon - a.lon) * scale * cos;
  const y = (p.lat - a.lat) * scale;
  const bx = (b.lon - a.lon) * scale * cos;
  const by = (b.lat - a.lat) * scale;
  const denom = bx * bx + by * by;
  let t = denom ? (x * bx + y * by) / denom : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - bx * t, y - by * t);
}

function routeDistanceToWay(route: Point[], geometry: Point[]) {
  if (!route.length || geometry.length < 2) return Infinity;
  let sum = 0;
  let count = 0;
  for (const point of route) {
    let best = Infinity;
    for (let i = 1; i < geometry.length; i += 1) best = Math.min(best, pointSegmentDistance(point, geometry[i - 1], geometry[i]));
    if (Number.isFinite(best)) { sum += best; count += 1; }
  }
  return count ? sum / count : Infinity;
}

function routePoints(train: Train): Point[] {
  return (train.route || []).map((stop: any) => ({
    lat: Number(stop?.lat ?? stop?.latitude ?? stop?.location?.latitude),
    lon: Number(stop?.lon ?? stop?.longitude ?? stop?.location?.longitude),
  })).filter((p: Point) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

async function fetchOverpass(lat: number, lon: number) {
  const query = `[out:json][timeout:30];node[railway=level_crossing](around:500,${lat},${lon});out body;`;
  let lastError = "";
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?${new URLSearchParams({ data: query })}`, { cache: "no-store", headers: { accept: "application/json", "user-agent": "Crossings/1.0 (meineschranke.com)" } });
      if (!response.ok) { lastError = `${endpoint} HTTP ${response.status}`; continue; }
      const data = await response.json();
      return { endpoint, crossings: Array.isArray(data?.elements) ? data.elements : [] };
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
  }
  throw new Error(lastError || "Overpass unavailable");
}

async function fetchWay(wayId: number) {
  const query = `[out:json][timeout:30];way(${wayId});out body geom;`;
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?${new URLSearchParams({ data: query })}`, { cache: "no-store", headers: { accept: "application/json", "user-agent": "Crossings/1.0 (meineschranke.com)" } });
      if (!response.ok) continue;
      const data = await response.json();
      const way = data?.elements?.find((x: any) => x.type === "way");
      if (way) return way;
    } catch { /* try next endpoint */ }
  }
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const crossingResult = await db.execute({ sql: `SELECT id,name,eva,lat,lon,observation_evas,required_route_stops FROM crossings WHERE id = ? LIMIT 1`, args: [id] });
  const crossing: any = crossingResult.rows[0];
  if (!crossing) return Response.json({ error: "Crossing not found" }, { status: 404 });

  const mappingResult = await db.execute({ sql: `SELECT crossing_osm_id,railway_way_id,crossing_node_index,way_direction,tags_json FROM osm_crossing_rail_ways WHERE crossing_osm_id IN (SELECT osm_crossing_id FROM crossing_osm_links WHERE crossing_id = ?)`, args: [id] }).catch(() => ({ rows: [] as any[] }));
  const linkResult = await db.execute({ sql: `SELECT osm_crossing_id,match_method,confidence FROM crossing_osm_links WHERE crossing_id = ? LIMIT 1`, args: [id] }).catch(() => ({ rows: [] as any[] }));

  const mappedWays = (mappingResult.rows as any[]).map((row) => ({
    crossingOsmId: Number(row.crossing_osm_id), railwayWayId: Number(row.railway_way_id), crossingNodeIndex: row.crossing_node_index == null ? null : Number(row.crossing_node_index), wayDirection: String(row.way_direction || "unknown"),
    tags: (() => { try { return JSON.parse(String(row.tags_json || "{}")); } catch { return {}; } })(),
  }));
  const crossingOsmId = linkResult.rows[0] ? Number((linkResult.rows[0] as any).osm_crossing_id) : null;

  let osmNodes: any[] = [];
  let osmEndpoint = "";
  try { const osm = await fetchOverpass(Number(crossing.lat), Number(crossing.lon)); osmNodes = osm.crossings; osmEndpoint = osm.endpoint; }
  catch (error) { osmEndpoint = error instanceof Error ? error.message : String(error); }

  const ways = [];
  for (const mapped of mappedWays) {
    const way = await fetchWay(mapped.railwayWayId);
    if (!way) continue;
    const geometry: Point[] = (way.geometry || []).map((p: any) => ({ lat: Number(p.lat), lon: Number(p.lon) })).filter((p: Point) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    ways.push({ osmId: mapped.railwayWayId, crossingOsmId: mapped.crossingOsmId, ref: mapped.tags.ref || way.tags?.ref || null, tags: mapped.tags, geometryPoints: geometry.length, geometry });
  }

  const evas = parseJson(crossing.observation_evas).map(String).filter(Boolean);
  const trainsByKey = new Map<string, Train>();
  const timetableErrors: any[] = [];
  for (const eva of evas.slice(0, 6)) {
    try {
      const trains = await getStationTimetable(eva, 4);
      for (const train of trains as any[]) {
        if (train.cancelled) continue;
        const key = `${train.category}-${train.journeyNumber}`;
        if (!trainsByKey.has(key)) trainsByKey.set(key, train as Train);
      }
    } catch (error) { timetableErrors.push({ eva, error: error instanceof Error ? error.message : String(error) }); }
  }

  const trainMatches = [...trainsByKey.values()].map((train) => {
    const points = routePoints(train);
    const matches = ways.map((way) => {
      const meanDistanceMeters = routeDistanceToWay(points, way.geometry);
      const proximity = Number.isFinite(meanDistanceMeters) ? Math.max(0, 1 - meanDistanceMeters / 5000) : 0;
      return { railwayWayId: way.osmId, ref: way.ref, meanDistanceMeters: Number.isFinite(meanDistanceMeters) ? Math.round(meanDistanceMeters) : null, score: Number(proximity.toFixed(3)) };
    }).sort((a, b) => b.score - a.score);
    return { category: train.category, journeyNumber: train.journeyNumber, line: train.line || null, origin: train.origin || null, destination: train.destination || null, routeStations: (train.route || []).map((stop: any) => stop?.name || stop?.stationName || stop?.eva).filter(Boolean), routePointCount: points.length, matches, winner: matches[0] || null };
  });

  return Response.json({ crossing: { id: String(crossing.id), name: String(crossing.name), lat: Number(crossing.lat), lon: Number(crossing.lon) }, osm: { linkedCrossingId: crossingOsmId, link: linkResult.rows[0] || null, discoveredNearbyCrossings: osmNodes.map((x: any) => ({ id: Number(x.id), lat: Number(x.lat), lon: Number(x.lon), tags: x.tags || {} })), ways: ways.map(({ geometry, ...rest }) => rest), endpoint: osmEndpoint }, trains: trainMatches, timetableErrors, note: "Diagnostic only. No prediction is changed by this endpoint." });
}
