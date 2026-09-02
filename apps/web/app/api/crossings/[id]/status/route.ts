import { db } from "../../../../lib/db";
import { getStationTimetable } from "../../../../../../../packages/db-api-client/src/getStationTimetable";
import { getThroughTrains } from "../../../../../../../packages/db-api-client/src/getThroughTrains";
import { getDivertedTrains } from "../../../../../../../packages/db-api-client/src/getDivertedTrains";
import { getReroutedTrains } from "../../../../../../../packages/db-api-client/src/getReroutedTrains";
import { getCrossingDirection } from "../../../../../../../packages/prediction-engine/src/getCrossingDirection";
import { crossings as staticCrossings } from "../../../../../../../packages/crossing-model/src/crossings";
import { withMemoryCache } from "../../../../../../../packages/db-api-client/src/memoryCache";
import { filterTrainByCrossingOsm } from "../../../../lib/crossingOsmFilter";
import { isTrainRouteNearCrossing } from "../../../../lib/crossingRouteProximity";
import { readCrossingForecastCache, writeCrossingForecastCache } from "../../../../lib/crossingForecastCache";

function jsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  try { return value ? JSON.parse(String(value)) : []; } catch { return []; }
}
function normalizeLine(value: unknown) {
  return String(value || "").toUpperCase().replace(/\s+/g, "").replace(/[._-]/g, "");
}
function lineMatchesHints(train: any, lineHints: string[]) {
  if (!lineHints.length) return true;
  const line = normalizeLine(train?.line), category = normalizeLine(train?.category);
  return lineHints.some((hint) => {
    const h = normalizeLine(hint);
    return h && (line === h || line.includes(h) || h.includes(line) || category === h);
  });
}
function buildCrossingFromDb(row: any, stationRows: any[]): any {
  let observationEvas = jsonArray(row.observation_evas).map(String).filter(Boolean);
  if (!observationEvas.length) observationEvas = stationRows.filter(s => !s.role || s.role === "observation" || s.role === "automatic").map(s => String(s.eva || "").trim()).filter(Boolean);
  if (row.eva && !observationEvas.includes(String(row.eva))) observationEvas.unshift(String(row.eva));
  const contextEvas = jsonArray(row.context_evas).map(String).filter(Boolean);
  const requiredRouteStops = jsonArray(row.required_route_stops).map(String).filter(Boolean);
  const throughRules = jsonArray(row.through_rules);
  const diversionRules = jsonArray(row.diversion_rules);
  const rerouteWatchRules = jsonArray(row.reroute_watch_rules);
  const stationNameByEva = new Map<string, string>();
  for (const station of stationRows) {
    const eva = String(station.eva || "").trim();
    if (eva) stationNameByEva.set(eva, String(station.station_name || station.name || eva));
  }
  const sourceRules = throughRules.length ? throughRules : observationEvas.map(eva => ({ observationEva: eva, observationStation: stationNameByEva.get(eva) || eva, categories: [], trackDistanceMeters: 0, fallbackOffsetSeconds: 300, direction: "unknown" }));
  const normalizedThroughRules = sourceRules.map((rule: any) => ({ ...rule, observationEva: String(rule.observationEva || "").trim(), observationStation: String(rule.observationStation || stationNameByEva.get(String(rule.observationEva || "")) || rule.observationEva || ""), categories: Array.isArray(rule.categories) ? rule.categories : [], trackDistanceMeters: Number(rule.trackDistanceMeters || 0), fallbackOffsetSeconds: Number(rule.fallbackOffsetSeconds || 300), direction: rule.direction || "unknown" })).filter((rule: any) => rule.observationEva);
  return { id: String(row.id), name: String(row.name || row.id), eva: String(row.eva || ""), observationEvas, contextEvas, requiredRouteStops, lat: Number(row.lat), lon: Number(row.lon), closeOffsetSeconds: Number(row.close_offset_seconds || 80), openOffsetSeconds: Number(row.open_offset_seconds || 20), rules: [], throughRules: normalizedThroughRules, diversionRules, rerouteWatchRules, confidence: Number(row.confidence || 0.5) };
}
async function loadCrossing(id: string): Promise<any | null> {
  try {
    const [result, stations] = await Promise.all([
      db.execute({ sql: `SELECT id,name,eva,lat,lon,close_offset_seconds,open_offset_seconds,confidence,status,observation_evas,context_evas,required_route_stops,through_rules,diversion_rules,reroute_watch_rules FROM crossings WHERE id = ? LIMIT 1`, args: [id] }),
      db.execute({ sql: `SELECT eva,station_name,role FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order ASC`, args: [id] }),
    ]);
    const row: any = result.rows[0];
    if (!row) return null;
    return buildCrossingFromDb(row, stations.rows as any[]);
  } catch (error) {
    console.error("[STATUS] loadCrossing failed:", error);
    return null;
  }
}

async function allowTrainForCrossing(crossingId: string, crossing: any, train: any, timing?: TimingState): Promise<boolean> {
  const journey = train?.journeyNumber ?? train?.id ?? "?";
  const line = train?.line ?? "?";
  const route = Array.isArray(train?.route) ? train.route.map(String).filter(Boolean) : [];

  if (!route.length) {
    timing?.osmDecisions.push(`[CROSSING DECISION] journey=${journey} line=${line} FINAL=REJECT reason=no-route`);
    return false;
  }

  const proximityStarted = performance.now();
  const routeNearCrossing = isTrainRouteNearCrossing(crossing, route as any);
  const proximityElapsed = performance.now() - proximityStarted;
  if (timing) timing.routeProximityMs += proximityElapsed;
  if (!routeNearCrossing) {
    timing?.osmDecisions.push(`[CROSSING DECISION] journey=${journey} line=${line} FINAL=REJECT reason=route-proximity`);
    return false;
  }

  const started = performance.now();
  const result = await filterTrainByCrossingOsm(crossingId, route);
  const elapsed = performance.now() - started;
  if (timing) timing.osmFilterMs += elapsed;

  timing?.osmDecisions.push(`[CROSSING DECISION] journey=${journey} line=${line} OSM=${result.status} way=${result.railwayWayId ?? "?"} score=${result.score?.toFixed(3) ?? "?"} ${elapsed.toFixed(1)}ms`);
  const allowed = result.status === "matched";
  timing?.osmDecisions.push(`[CROSSING DECISION] journey=${journey} line=${line} FINAL=${allowed ? "ACCEPT" : "REJECT"} reason=osm-${result.status}`);
  return allowed;
}

const STATUS_TIMETABLE_HOURS = 1;
const STATUS_CACHE_TTL_MS = 30_000;
const STATUS_TIMING_DEBUG = process.env.STATUS_TIMING_DEBUG !== "false";

type TimingState = { debug: boolean; startedAt: number; cacheReadMs: number; loadCrossingMs: number; localEventsMs: number; observationEventsMs: number; throughTrainsMs: number; divertedTrainsMs: number; reroutedTrainsMs: number; infrastructureForecastMs: number; filterDirectMs: number; filterThroughMs: number; routeProximityMs: number; osmFilterMs: number; closuresMs: number; cacheWriteMs: number; osmDecisions: string[]; };

function logTimingSummary(id: string, timing: TimingState, counts: Record<string, number>) {
  if (!timing.debug) return;
  console.log(`[STATUS TIMING ${id}]\n==========================\ntotal: ${(performance.now() - timing.startedAt).toFixed(1)}ms\ncache: ${timing.cacheReadMs.toFixed(1)}ms\nloadCrossing: ${timing.loadCrossingMs.toFixed(1)}ms\nlocalEvents: ${timing.localEventsMs.toFixed(1)}ms\nobservationEvents: ${timing.observationEventsMs.toFixed(1)}ms\nthroughTrains: ${timing.throughTrainsMs.toFixed(1)}ms\ndivertedTrains: ${timing.divertedTrainsMs.toFixed(1)}ms\nreroutedTrains: ${timing.reroutedTrainsMs.toFixed(1)}ms\ninfrastructureForecast: ${timing.infrastructureForecastMs.toFixed(1)}ms\nfilterDirect: ${timing.filterDirectMs.toFixed(1)}ms\nfilterThrough: ${timing.filterThroughMs.toFixed(1)}ms\nrouteProximity: ${timing.routeProximityMs.toFixed(1)}ms\nosmFilter: ${timing.osmFilterMs.toFixed(1)}ms\nclosures: ${timing.closuresMs.toFixed(1)}ms\ncacheWrite: ${timing.cacheWriteMs.toFixed(1)}ms\n--------------------------\nlocalCandidates: ${counts.localCandidates}\nobservationCandidates: ${counts.observationCandidates}\nthroughCandidates: ${counts.throughCandidates}\ndivertedCandidates: ${counts.divertedCandidates}\nreroutedCandidates: ${counts.reroutedCandidates}\ndirectFiltered: ${counts.directFiltered}\nthroughFiltered: ${counts.throughFiltered}\nallowCalls: ${counts.allowCalls}\naccepted: ${counts.accepted}\nrejected: ${counts.rejected}\nfinalTrains: ${counts.finalTrains}\nfinalClosures: ${counts.finalClosures}\n==========================\nOSM MATCH RESULTS\n${timing.osmDecisions.join("\n")}`);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const timing: TimingState = { debug: STATUS_TIMING_DEBUG, startedAt: performance.now(), cacheReadMs: 0, loadCrossingMs: 0, localEventsMs: 0, observationEventsMs: 0, throughTrainsMs: 0, divertedTrainsMs: 0, reroutedTrainsMs: 0, infrastructureForecastMs: 0, filterDirectMs: 0, filterThroughMs: 0, routeProximityMs: 0, osmFilterMs: 0, closuresMs: 0, cacheWriteMs: 0, osmDecisions: [] };
  const counts = { localCandidates: 0, observationCandidates: 0, throughCandidates: 0, divertedCandidates: 0, reroutedCandidates: 0, directFiltered: 0, throughFiltered: 0, allowCalls: 0, accepted: 0, rejected: 0, finalTrains: 0, finalClosures: 0 };
  const cacheKey = `status:${id}`;
  const cacheStarted = performance.now();
  const cached = await readCrossingForecastCache<any>(cacheKey, STATUS_CACHE_TTL_MS);
  timing.cacheReadMs = performance.now() - cacheStarted;
  if (cached) { if (timing.debug) console.log(`[STATUS TIMING ${id}] CACHE HIT ${timing.cacheReadMs.toFixed(1)}ms`); return Response.json(cached, { headers: { "X-Crossing-Status-Cache": "HIT" } }); }
  const loadStarted = performance.now();
  const crossing = (await loadCrossing(id)) || staticCrossings.find(c => c.id === id);
  timing.loadCrossingMs = performance.now() - loadStarted;
  if (!crossing) return Response.json({ error: "Crossing not found" }, { status: 404 });
  const lineHints = !crossing.eva && ((crossing.requiredRouteStops || []).includes("2530") || String(crossing.name || "").includes("2530")) ? ["S28"] : [];

  if (lineHints.length) {
    const started = performance.now();
    const { GET: getInfrastructureForecast } = await import("../../../admin/crossings/[id]/forecast/route");
    const forecastResponse = await getInfrastructureForecast(request, { params: Promise.resolve({ id }) });
    timing.infrastructureForecastMs = performance.now() - started;
    if (timing.debug) console.log(`[STATUS TIMING ${id}] infrastructureForecast ${timing.infrastructureForecastMs.toFixed(1)}ms ok=${forecastResponse.ok}`);
    if (forecastResponse.ok) {
      const forecast: any = await forecastResponse.json();
      const next = forecast.nextClosure; const now = Date.now(); const closures = Array.isArray(forecast.closures) ? forecast.closures : [];
      const nextStart = next?.start ? new Date(next.start).getTime() : 0; const nextEnd = next?.end ? new Date(next.end).getTime() : 0;
      const payload = { crossing: { id: crossing.id, name: crossing.name, lat: crossing.lat, lon: crossing.lon }, state: forecast.state || "OPEN", nextCloseIn: next?.closeInSeconds ?? (nextStart > now ? Math.floor((nextStart - now) / 1000) : 0), nextOpenIn: next?.openInSeconds ?? (nextEnd > now ? Math.floor((nextEnd - now) / 1000) : 0), phase: next ? { start: next.start, end: next.end, durationMinutes: Math.round((nextEnd - nextStart) / 60000), trainCount: Array.isArray(next.trains) ? next.trains.length : 0, trains: next.trains || [] } : null, closureCount: closures.length, closures, trainCount: Array.isArray(forecast.trains) ? forecast.trains.length : 0, trains: forecast.trains || [], divertedTrains: [], lineHints: forecast.crossing?.lineHints || lineHints };
      const writeStarted = performance.now(); await writeCrossingForecastCache(cacheKey, payload); timing.cacheWriteMs = performance.now() - writeStarted;
      logTimingSummary(id, timing, { ...counts, finalTrains: payload.trainCount, finalClosures: payload.closureCount });
      return Response.json(payload, { headers: { "X-Crossing-Status-Cache": "MISS", "X-Crossing-Status-Source": "infrastructure-forecast" } });
    }
  }

  const localEventsPromise = crossing.eva ? (async () => { const started = performance.now(); const value = await getStationTimetable(crossing.eva, STATUS_TIMETABLE_HOURS).catch(() => []); timing.localEventsMs = performance.now() - started; return value; })() : Promise.resolve([]);
  const observationEventsPromise = !crossing.eva && crossing.observationEvas?.length ? (async () => { const started = performance.now(); const sets = await Promise.all(crossing.observationEvas.map((eva: string) => getStationTimetable(eva, STATUS_TIMETABLE_HOURS).catch(() => []))); timing.observationEventsMs = performance.now() - started; return sets.flat(); })() : Promise.resolve([]);
  const throughPromise = (async () => { const started = performance.now(); const value = await withMemoryCache(`through-${crossing.id}`, 5000, () => getThroughTrains(crossing)).catch(() => []); timing.throughTrainsMs = performance.now() - started; return value; })();
  const divertedPromise = (async () => { const started = performance.now(); const value = await withMemoryCache(`diverted-${crossing.id}`, 5000, () => getDivertedTrains(crossing)).catch(() => []); timing.divertedTrainsMs = performance.now() - started; return value; })();
  const reroutedPromise = (async () => { const started = performance.now(); const value = await withMemoryCache(`rerouted-${crossing.id}`, 5000, () => getReroutedTrains(crossing)).catch(() => []); timing.reroutedTrainsMs = performance.now() - started; return value; })();
  const [localEvents, observationEvents, throughTrains, divertedTrains, reroutedTrains] = await Promise.all([localEventsPromise, observationEventsPromise, throughPromise, divertedPromise, reroutedPromise]);
  counts.localCandidates = localEvents.length; counts.observationCandidates = observationEvents.length; counts.throughCandidates = throughTrains.length; counts.divertedCandidates = divertedTrains.length; counts.reroutedCandidates = reroutedTrains.length;
  const trains: any[] = [];
  const directBase = crossing.eva ? localEvents : observationEvents.map((train: any) => ({ ...train, source: "observation", detection: "station-observation" }));
  const directEvents = directBase.filter((train: any) => !train.cancelled && lineMatchesHints(train, lineHints));
  counts.directFiltered = directEvents.length;

  const directResults = await Promise.all(directEvents.map(async (train: any) => { counts.allowCalls++; const started = performance.now(); const allowed = await allowTrainForCrossing(crossing.id, crossing, train, timing); timing.filterDirectMs += performance.now() - started; return { train, allowed }; }));
  for (const { train, allowed } of directResults) {
    if (!allowed) { counts.rejected++; continue; }
    counts.accepted++; const crossingTime = train.actualTime;
    trains.push({ id: `${train.category}-${train.journeyNumber}-${train.id}`, line: train.line, category: train.category, journeyNumber: train.journeyNumber, origin: train.origin, destination: train.destination, platform: train.platform, isStoppingTrain: train.platform === "1" || train.platform === "2", direction: getCrossingDirection(train.route), directionLabel: train.destination ? `Richtung ${train.destination}` : null, delayMinutes: train.delayMinutes, crossingTime: crossingTime.toISOString(), arrival: crossingTime.toISOString(), etaSeconds: Math.floor((crossingTime.getTime() - Date.now()) / 1000) });
  }

  const throughFiltered = throughTrains.filter((train: any) => lineMatchesHints(train, lineHints));
  counts.throughFiltered = throughFiltered.length;
  const throughResults = await Promise.all(throughFiltered.map(async (train: any) => { counts.allowCalls++; const started = performance.now(); const allowed = await allowTrainForCrossing(crossing.id, crossing, train, timing); timing.filterThroughMs += performance.now() - started; return { train, allowed }; }));
  for (const { train, allowed } of throughResults) {
    if (!allowed) { counts.rejected++; continue; }
    counts.accepted++; const crossingTime = new Date(train.crossingTime);
    trains.push({ id: `${train.category}-${train.journeyNumber}`, line: train.line, category: train.category, journeyNumber: train.journeyNumber, origin: train.origin, destination: train.destination, platform: undefined, isStoppingTrain: false, direction: train.direction, directionLabel: "Durchfahrt", delayMinutes: train.delayMinutes, crossingTime: crossingTime.toISOString(), arrival: crossingTime.toISOString(), etaSeconds: Math.floor((crossingTime.getTime() - Date.now()) / 1000) });
  }

  trains.sort((a, b) => new Date(a.crossingTime).getTime() - new Date(b.crossingTime).getTime());
  const closureStarted = performance.now(); const closures: any[] = [];
  for (const train of trains.filter(t => t.etaSeconds > 0)) {
    const crossingTime = new Date(train.crossingTime); const closeAt = new Date(crossingTime.getTime() - crossing.closeOffsetSeconds * 1000), openAt = new Date(crossingTime.getTime() + crossing.openOffsetSeconds * 1000), last = closures[closures.length - 1];
    if (!last || closeAt.getTime() > last.end.getTime() + 30000) closures.push({ start: closeAt, end: openAt, trains: [train] }); else { if (openAt.getTime() > last.end.getTime()) last.end = openAt; last.trains.push(train); }
  }
  timing.closuresMs = performance.now() - closureStarted;
  const visibleClosures = closures.filter(c => c.start.getTime() <= Date.now() + 30 * 60 * 1000); const nextClosure = closures.find(c => c.end.getTime() > Date.now()) || null;
  const payload = { crossing: { id: crossing.id, name: crossing.name, lat: crossing.lat, lon: crossing.lon }, state: nextClosure && Date.now() >= nextClosure.start.getTime() ? "CLOSED" : "OPEN", nextCloseIn: nextClosure ? Math.max(0, Math.floor((nextClosure.start.getTime() - Date.now()) / 1000)) : 0, nextOpenIn: nextClosure ? Math.max(0, Math.floor((nextClosure.end.getTime() - Date.now()) / 1000)) : 0, phase: nextClosure ? { start: nextClosure.start.toISOString(), end: nextClosure.end.toISOString(), durationMinutes: Math.round((nextClosure.end.getTime() - nextClosure.start.getTime()) / 60000), trainCount: nextClosure.trains.length, trains: nextClosure.trains } : null, closureCount: visibleClosures.length, closures: visibleClosures.map(c => ({ start: c.start.toISOString(), end: c.end.toISOString(), durationMinutes: Math.round((c.end.getTime() - c.start.getTime()) / 60000), trainCount: c.trains.length, trains: c.trains })), trainCount: trains.length, trains, divertedTrains, lineHints };
  const writeStarted = performance.now(); await writeCrossingForecastCache(cacheKey, payload); timing.cacheWriteMs = performance.now() - writeStarted;
  counts.finalTrains = trains.length; counts.finalClosures = visibleClosures.length; logTimingSummary(id, timing, counts);
  return Response.json(payload, { headers: { "X-Crossing-Status-Cache": "MISS" } });
}
