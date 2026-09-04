import { db } from "../../../../lib/db";
import { getStationTimetable } from "../../../../../../../packages/db-api-client/src/getStationTimetable";
import { getThroughTrains } from "../../../../../../../packages/db-api-client/src/getThroughTrains";
import { getSnapshotThroughTrains } from "../../../../../../../packages/db-api-client/src/getSnapshotThroughTrains";
import { getDivertedTrains } from "../../../../../../../packages/db-api-client/src/getDivertedTrains";
import { getReroutedTrains } from "../../../../../../../packages/db-api-client/src/getReroutedTrains";
import { getCrossingDirection } from "../../../../../../../packages/prediction-engine/src/getCrossingDirection";
import { withMemoryCache } from "../../../../../../../packages/db-api-client/src/memoryCache";
import { filterTrainByCrossingOsm } from "../../../../lib/crossingOsmFilter";
import { readCrossingForecastCache, writeCrossingForecastCache } from "../../../../lib/crossingForecastCache";

function jsonArray(value: unknown): any[] { if (Array.isArray(value)) return value; try { return value ? JSON.parse(String(value)) : []; } catch { return []; } }
function normalizeStationName(value: string) { return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\([^)]*\)/g, " ").replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ").replace(/[^a-z0-9]+/g, "").trim(); }
function routeContainsStation(route: unknown, stationName: string) { if (!Array.isArray(route) || !stationName) return false; const target = normalizeStationName(stationName); if (!target) return false; return route.some((stop) => { const value = normalizeStationName(String(stop || "")); return value === target || value.includes(target) || target.includes(value); }); }
function normalizeLine(value: unknown) { return String(value || "").toUpperCase().replace(/\s+/g, "").trim(); }
function lineMatchesReference(train: any, crossing: any) {
  const references = Array.isArray(crossing.referenceLines) ? crossing.referenceLines.map(normalizeLine).filter(Boolean) : [];
  if (!references.length) return true;
  const line = normalizeLine(train?.line);
  if (!line) return true;
  return references.includes(line);
}
function buildCrossingFromDb(row: any, stationRows: any[]): any {
  const linkedEvas = stationRows.filter((s) => !s.role || s.role === "observation" || s.role === "automatic").map((s) => String(s.eva || "").trim()).filter(Boolean);
  let observationEvas = linkedEvas.length ? linkedEvas : jsonArray(row.observation_evas).map(String).filter(Boolean);
  if (!observationEvas.length && row.eva) observationEvas = [String(row.eva)];
  const contextEvas = jsonArray(row.context_evas).map(String).filter(Boolean);
  const requiredRouteStops = jsonArray(row.required_route_stops).map(String).filter(Boolean);
  const referenceLines = jsonArray(row.reference_lines).map(normalizeLine).filter(Boolean);
  const throughRules = jsonArray(row.through_rules); const diversionRules = jsonArray(row.diversion_rules); const rerouteWatchRules = jsonArray(row.reroute_watch_rules);
  const stationNameByEva = new Map<string, string>(); for (const station of stationRows) { const eva = String(station.eva || "").trim(); if (eva) stationNameByEva.set(eva, String(station.station_name || station.name || eva)); }
  const observationStationNames = observationEvas.map((eva) => stationNameByEva.get(eva) || "").filter(Boolean);
  if (!observationStationNames.length) { const fallback = String(row.name || "").replace(/bahnübergang|bahnuebergang|bue|bü/gi, " ").split(/[,/;|]+/)[0].trim(); if (fallback) observationStationNames.push(fallback); }
  const sourceRules = throughRules.length ? throughRules : observationEvas.map((eva) => ({ observationEva: eva, observationStation: stationNameByEva.get(eva) || eva, categories: [], trackDistanceMeters: 0, fallbackOffsetSeconds: 300, direction: "unknown" }));
  const normalizedThroughRules = sourceRules.map((rule: any) => ({ ...rule, observationEva: String(rule.observationEva || "").trim(), observationStation: String(rule.observationStation || stationNameByEva.get(String(rule.observationEva || "")) || rule.observationEva || ""), categories: Array.isArray(rule.categories) ? rule.categories : [], trackDistanceMeters: Number(rule.trackDistanceMeters || 0), fallbackOffsetSeconds: Number(rule.fallbackOffsetSeconds || 300), direction: rule.direction || "unknown" })).filter((rule: any) => rule.observationEva);
  return { id: String(row.id), name: String(row.name || row.id), eva: observationEvas[0] || String(row.eva || ""), observationEvas, observationStationNames, contextEvas, requiredRouteStops, referenceLines, lat: Number(row.lat), lon: Number(row.lon), closeOffsetSeconds: Number(row.close_offset_seconds || 80), openOffsetSeconds: Number(row.open_offset_seconds || 20), rules: [], throughRules: normalizedThroughRules, diversionRules, rerouteWatchRules, confidence: Number(row.confidence || 0.5) };
}
async function loadCrossing(id: string): Promise<any | null> { try { const result = await db.execute({ sql: `SELECT id,name,eva,lat,lon,close_offset_seconds,open_offset_seconds,confidence,status,observation_evas,context_evas,required_route_stops,reference_lines,through_rules,diversion_rules,reroute_watch_rules FROM crossings WHERE id = ? LIMIT 1`, args: [id] }); const row: any = result.rows[0]; if (!row) return null; let stationRows: any[] = []; try { const stations = await db.execute({ sql: `SELECT eva,station_name,role FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order ASC`, args: [id] }); stationRows = stations.rows as any[]; } catch {} return buildCrossingFromDb(row, stationRows); } catch { return null; } }
function directTrainBelongsToCrossing(train: any, crossing: any) { const names = Array.isArray(crossing.observationStationNames) ? crossing.observationStationNames : []; if (!names.length) return true; return names.some((name: string) => routeContainsStation(train?.route, name)); }
async function allowTrainForCrossing(crossingId: string, train: any, mode: "direct" | "through"): Promise<boolean> {
  if (!lineMatchesReference(train, await loadCrossing(crossingId))) return false;
  if (mode === "direct") return true;
  const route = Array.isArray(train?.route) ? train.route.map(String).filter(Boolean) : [];
  if (route.length < 2) return false;
  const result = await filterTrainByCrossingOsm(crossingId, route);
  return result.status === "matched";
}
const STATUS_TIMETABLE_HOURS = 1; const STATUS_CACHE_TTL_MS = 30_000;
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const cacheKey = `status:${id}`; const cached = await readCrossingForecastCache<any>(cacheKey, STATUS_CACHE_TTL_MS); if (cached) return Response.json(cached, { headers: { "X-Crossing-Status-Cache": "HIT" } }); const crossing = await loadCrossing(id); if (!crossing) return Response.json({ error: "Crossing not found" }, { status: 404 });
  const observationEventsPromise = crossing.observationEvas?.length ? Promise.all(crossing.observationEvas.map((eva: string) => getStationTimetable(eva, STATUS_TIMETABLE_HOURS).catch(() => []))).then((sets) => sets.flat()) : Promise.resolve([]);
  const throughPromise = withMemoryCache(`through-${crossing.id}`, 15_000, async () => { const snapshot = await getSnapshotThroughTrains(db, crossing); return snapshot ?? getThroughTrains(crossing); }).catch(() => []);
  const divertedPromise = withMemoryCache(`diverted-${crossing.id}`, 5000, () => getDivertedTrains(crossing)).catch(() => []); const reroutedPromise = withMemoryCache(`rerouted-${crossing.id}`, 5000, () => getReroutedTrains(crossing)).catch(() => []); const [observationEvents, throughTrains, divertedTrains, reroutedTrains] = await Promise.all([observationEventsPromise, Promise.race([throughPromise, new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 4500))]), divertedPromise, reroutedPromise]);
  const directCandidates = observationEvents.filter((train: any) => !train.cancelled && directTrainBelongsToCrossing(train, crossing) && lineMatchesReference(train, crossing));
  const trains: any[] = [];
  for (const train of directCandidates) { const crossingTime = train.actualTime; trains.push({ id: `${train.category}-${train.journeyNumber}-${train.id}`, line: train.line, category: train.category, journeyNumber: train.journeyNumber, origin: train.origin, destination: train.destination, platform: train.platform, isStoppingTrain: train.platform === "1" || train.platform === "2", direction: getCrossingDirection(train.route), directionLabel: train.destination ? `Richtung ${train.destination}` : null, delayMinutes: train.delayMinutes, crossingTime: crossingTime.toISOString(), arrival: crossingTime.toISOString(), etaSeconds: Math.floor((crossingTime.getTime() - Date.now()) / 1000) }); }
  for (const train of throughTrains) { if (!(await allowTrainForCrossing(crossing.id, train, "through"))) continue; const crossingTime = new Date(train.crossingTime); trains.push({ id: `${train.category}-${train.journeyNumber}`, line: train.line, category: train.category, journeyNumber: train.journeyNumber, platform: undefined, isStoppingTrain: false, direction: train.direction, directionLabel: "Durchfahrt", delayMinutes: train.delayMinutes, crossingTime: crossingTime.toISOString(), arrival: crossingTime.toISOString(), etaSeconds: Math.floor((crossingTime.getTime() - Date.now()) / 1000) }); }
  trains.sort((a, b) => new Date(a.crossingTime).getTime() - new Date(b.crossingTime).getTime()); const closures: any[] = []; for (const train of trains.filter((t) => t.etaSeconds > 0)) { const crossingTime = new Date(train.crossingTime); const closeAt = new Date(crossingTime.getTime() - crossing.closeOffsetSeconds * 1000); const openAt = new Date(crossingTime.getTime() + crossing.openOffsetSeconds * 1000); const last = closures[closures.length - 1]; if (!last || closeAt.getTime() > last.end.getTime() + 30000) closures.push({ start: closeAt, end: openAt, trains: [train] }); else { if (openAt.getTime() > last.end.getTime()) last.end = openAt; last.trains.push(train); } }
  const visibleClosures = closures.filter((c) => c.start.getTime() <= Date.now() + 30 * 60 * 1000); const nextClosure = closures.find((c) => c.end.getTime() > Date.now()) || null; const payload = { crossing: { id: crossing.id, name: crossing.name, lat: crossing.lat, lon: crossing.lon }, state: nextClosure && Date.now() >= nextClosure.start.getTime() ? "CLOSED" : "OPEN", nextCloseIn: nextClosure ? Math.max(0, Math.floor((nextClosure.start.getTime() - Date.now()) / 1000)) : 0, nextOpenIn: nextClosure ? Math.max(0, Math.floor((nextClosure.end.getTime() - Date.now()) / 1000)) : 0, phase: nextClosure ? { start: nextClosure.start.toISOString(), end: nextClosure.end.toISOString(), durationMinutes: Math.round((nextClosure.end.getTime() - nextClosure.start.getTime()) / 60000), trainCount: nextClosure.trains.length, trains: nextClosure.trains } : null, closureCount: visibleClosures.length, closures: visibleClosures.map((c) => ({ start: c.start.toISOString(), end: c.end.toISOString(), durationMinutes: Math.round((c.end.getTime() - c.start.getTime()) / 60000), trainCount: c.trains.length, trains: c.trains })), trainCount: trains.length, trains, divertedTrains, lineHints: [] }; await writeCrossingForecastCache(cacheKey, payload); return Response.json(payload, { headers: { "X-Crossing-Status-Cache": "MISS" } });
}
