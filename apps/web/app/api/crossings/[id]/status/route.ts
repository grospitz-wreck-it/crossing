import { db } from "../../../../lib/db";
import { getStationTimetable } from "../../../../../../../packages/db-api-client/src/getStationTimetable";
import { getThroughTrains } from "../../../../../../../packages/db-api-client/src/getThroughTrains";
import { getDivertedTrains } from "../../../../../../../packages/db-api-client/src/getDivertedTrains";
import { getReroutedTrains } from "../../../../../../../packages/db-api-client/src/getReroutedTrains";
import { getCrossingDirection } from "../../../../../../../packages/prediction-engine/src/getCrossingDirection";
import { crossings as staticCrossings } from "../../../../../../../packages/crossing-model/src/crossings";
import { withMemoryCache } from "../../../../../../../packages/db-api-client/src/memoryCache";

function jsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  try { return value ? JSON.parse(String(value)) : []; } catch { return []; }
}

function buildCrossingFromDb(row: any, stationRows: any[]): any {
  const observationEvas: string[] = jsonArray(row.observation_evas).map((value: unknown) => String(value)).filter(Boolean);
  if (row.eva && !observationEvas.includes(String(row.eva))) observationEvas.unshift(String(row.eva));
  const contextEvas: string[] = jsonArray(row.context_evas).map((value: unknown) => String(value)).filter(Boolean);
  const requiredRouteStops: string[] = jsonArray(row.required_route_stops).map((value: unknown) => String(value)).filter(Boolean);
  const throughRules = jsonArray(row.through_rules);
  const diversionRules = jsonArray(row.diversion_rules);
  const rerouteWatchRules = jsonArray(row.reroute_watch_rules);
  const stationNameByEva = new Map<string, string>();
  for (const station of stationRows) {
    const eva = String(station.eva || "").trim();
    if (eva) stationNameByEva.set(eva, String(station.station_name || station.name || eva));
  }
  const normalizedThroughRules = throughRules.map((rule: any) => ({
    ...rule,
    observationEva: String(rule.observationEva || "").trim(),
    observationStation: String(rule.observationStation || stationNameByEva.get(String(rule.observationEva || "")) || rule.observationEva || ""),
    categories: Array.isArray(rule.categories) && rule.categories.length ? rule.categories : ["ICE", "IC", "EC"],
    trackDistanceMeters: Number(rule.trackDistanceMeters || 0),
    fallbackOffsetSeconds: Number(rule.fallbackOffsetSeconds || 300),
    direction: rule.direction || "unknown",
  })).filter((rule: any) => rule.observationEva);
  return {
    id: String(row.id), name: String(row.name || row.id), eva: String(row.eva || ""), observationEvas, contextEvas,
    requiredRouteStops, lat: Number(row.lat), lon: Number(row.lon), closeOffsetSeconds: Number(row.close_offset_seconds || 80),
    openOffsetSeconds: Number(row.open_offset_seconds || 20), rules: [], throughRules: normalizedThroughRules,
    diversionRules, rerouteWatchRules, confidence: Number(row.confidence || 0.5),
  };
}

async function loadCrossing(id: string): Promise<any | null> {
  try {
    const result = await db.execute({
      sql: `SELECT id,name,eva,lat,lon,close_offset_seconds,open_offset_seconds,confidence,status,observation_evas,context_evas,required_route_stops,through_rules,diversion_rules,reroute_watch_rules FROM crossings WHERE id = ? LIMIT 1`,
      args: [id],
    });
    const row: any = result.rows[0];
    if (!row) return null;
    let stationRows: any[] = [];
    try {
      const stations = await db.execute({ sql: `SELECT eva,station_name,role FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order ASC`, args: [id] });
      stationRows = stations.rows as any[];
    } catch {}
    return buildCrossingFromDb(row, stationRows);
  } catch (error) {
    console.error("Failed to load crossing from DB:", error);
    return null;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const crossing = (await loadCrossing(id)) || staticCrossings.find((c) => c.id === id);
  if (!crossing) return Response.json({ error: "Crossing not found" }, { status: 404 });

  const trains: any[] = [];
  const now = Date.now();
  const observedKeys = new Set<string>();
  const observationEvas: string[] = Array.from(new Set<string>((Array.isArray(crossing.observationEvas) ? crossing.observationEvas : []).map((value: unknown) => String(value).trim()).filter((value: string) => Boolean(value)))).slice(0, 6);

  for (const observationEva of observationEvas) {
    try {
      const events = await withMemoryCache(`status-station-${observationEva}`, 5000, () => getStationTimetable(observationEva, 4));
      for (const train of events) {
        if (train.cancelled) continue;
        const crossingTime = train.actualTime;
        const etaSeconds = Math.floor((crossingTime.getTime() - now) / 1000);
        if (etaSeconds <= 0) continue;
        const key = `${train.category}-${train.journeyNumber}`;
        const candidate = {
          id: `${train.category}-${train.journeyNumber}-${observationEva}`,
          line: train.line,
          category: train.category,
          journeyNumber: train.journeyNumber,
          origin: train.origin,
          destination: train.destination,
          platform: train.platform,
          isStoppingTrain: Boolean(crossing.eva && observationEva === String(crossing.eva)),
          direction: getCrossingDirection(train.route),
          directionLabel: train.destination ? `Richtung ${train.destination}` : null,
          delayMinutes: train.delayMinutes,
          crossingTime: crossingTime.toISOString(),
          arrival: crossingTime.toISOString(),
          etaSeconds,
          observationEva,
          observationStation: observationEva,
          estimatedFrom: { observationEva, observationActualTime: crossingTime.toISOString(), source: "observation-station" },
        };
        const existingIndex = trains.findIndex((item) => `${item.category}-${item.journeyNumber}` === key);
        if (existingIndex < 0) trains.push(candidate);
        else if (candidate.etaSeconds < trains[existingIndex].etaSeconds) trains[existingIndex] = candidate;
        observedKeys.add(key);
      }
    } catch (error) {
      console.error(`Failed to load observation station ${observationEva}:`, error);
    }
  }

  if (crossing.eva && !observationEvas.includes(String(crossing.eva))) {
    try {
      const localEvents = await getStationTimetable(String(crossing.eva), 4);
      for (const train of localEvents) {
        if (train.cancelled) continue;
        const crossingTime = train.actualTime;
        const etaSeconds = Math.floor((crossingTime.getTime() - now) / 1000);
        if (etaSeconds <= 0) continue;
        const key = `${train.category}-${train.journeyNumber}`;
        trains.push({ id: `${train.category}-${train.journeyNumber}-${train.id}`, line: train.line, category: train.category, journeyNumber: train.journeyNumber, origin: train.origin, destination: train.destination, platform: train.platform, isStoppingTrain: true, direction: getCrossingDirection(train.route), directionLabel: train.destination ? `Richtung ${train.destination}` : null, delayMinutes: train.delayMinutes, crossingTime: crossingTime.toISOString(), arrival: crossingTime.toISOString(), etaSeconds });
      }
    } catch (error) { console.error("Failed to load local timetable:", error); }
  }

  try {
    const throughTrains = await withMemoryCache(`through-${crossing.id}`, 5000, () => getThroughTrains(crossing));
    for (const train of throughTrains) {
      const key = `${train.category}-${train.journeyNumber}`;
      const crossingTime = new Date(train.crossingTime);
      const etaSeconds = Math.floor((crossingTime.getTime() - now) / 1000);
      if (etaSeconds <= 0) continue;
      const candidate = { id: `${train.category}-${train.journeyNumber}`, line: train.line, category: train.category, journeyNumber: train.journeyNumber, origin: train.origin, destination: train.destination, platform: train.direction === "westbound" ? "1" : train.direction === "eastbound" ? "2" : undefined, isStoppingTrain: false, direction: train.direction, directionLabel: "Durchfahrt", delayMinutes: train.delayMinutes, crossingTime: crossingTime.toISOString(), arrival: crossingTime.toISOString(), etaSeconds, estimatedFrom: { observationStation: train.observationStation, observationActualTime: train.observationActualTime, fallbackOffsetSeconds: train.fallbackOffsetSeconds } };
      const existingIndex = trains.findIndex((item) => `${item.category}-${item.journeyNumber}` === key);
      if (existingIndex < 0 || candidate.etaSeconds < trains[existingIndex].etaSeconds) trains[existingIndex] = candidate;
    }
  } catch (error) { console.error("Failed to load through trains:", error); }

  let divertedTrains: any[] = [];
  try { divertedTrains = await withMemoryCache(`diverted-${crossing.id}`, 5000, () => getDivertedTrains(crossing)); }
  catch (error) { console.error("Failed to load diverted trains:", error); }

  try {
    const reroutedTrains = await withMemoryCache(`rerouted-${crossing.id}`, 5000, () => getReroutedTrains(crossing));
    for (const train of reroutedTrains) {
      const key = `${train.category}-${train.journeyNumber}`;
      const crossingTime = new Date(train.crossingTime);
      const etaSeconds = Math.floor((crossingTime.getTime() - now) / 1000);
      if (etaSeconds <= 0 || trains.some((item) => `${item.category}-${item.journeyNumber}` === key)) continue;
      trains.push({ id: `${train.category}-${train.journeyNumber}-rerouted`, line: train.line, category: train.category, journeyNumber: train.journeyNumber, origin: train.origin, destination: train.destination, platform: undefined, isStoppingTrain: false, direction: train.direction, directionLabel: "Umleitung", delayMinutes: train.delayMinutes, crossingTime: crossingTime.toISOString(), arrival: crossingTime.toISOString(), etaSeconds, estimatedFrom: { observationStation: train.observationStation, observationActualTime: train.observationActualTime, fallbackOffsetSeconds: train.fallbackOffsetSeconds }, rerouted: true, note: train.note });
    }
  } catch (error) { console.error("Failed to load rerouted trains:", error); }

  trains.sort((a, b) => new Date(a.crossingTime).getTime() - new Date(b.crossingTime).getTime());
  const upcoming = trains.filter((t) => t.etaSeconds > 0);
  const MERGE_GAP_SECONDS = 30;
  const closures: { start: Date; end: Date; trains: any[] }[] = [];
  for (const train of upcoming) {
    const crossingTime = new Date(train.crossingTime);
    let closeOffset = crossing.closeOffsetSeconds;
    let openOffset = crossing.openOffsetSeconds;
    const rule = (crossing as any).rules?.find((rule: any) => rule.platform === train.platform && rule.stopping === train.isStoppingTrain);
    if (rule) { closeOffset = rule.closeOffsetSeconds ?? closeOffset; openOffset = rule.openOffsetSeconds ?? openOffset; }
    const closeAt = new Date(crossingTime.getTime() - closeOffset * 1000);
    const openAt = new Date(crossingTime.getTime() + openOffset * 1000);
    const last = closures[closures.length - 1];
    if (!last || closeAt.getTime() > last.end.getTime() + MERGE_GAP_SECONDS * 1000) closures.push({ start: closeAt, end: openAt, trains: [train] });
    else { if (openAt.getTime() > last.end.getTime()) last.end = openAt; last.trains.push(train); }
  }

  const MAX_LOOKAHEAD_MINUTES = 30;
  const visibleClosures = closures.filter((closure) => closure.start.getTime() <= Date.now() + MAX_LOOKAHEAD_MINUTES * 60 * 1000);
  const nextClosure = closures.find((closure) => closure.end.getTime() > Date.now()) || null;
  let state = "OPEN";
  let nextCloseIn = 0;
  let nextOpenIn = 0;
  let phaseStart: string | null = null;
  let phaseEnd: string | null = null;
  if (nextClosure) {
    phaseStart = nextClosure.start.toISOString(); phaseEnd = nextClosure.end.toISOString();
    if (now < nextClosure.start.getTime()) nextCloseIn = Math.floor((nextClosure.start.getTime() - now) / 1000);
    else { state = "CLOSED"; nextOpenIn = Math.floor((nextClosure.end.getTime() - now) / 1000); }
  }

  return Response.json({ crossing: { id: crossing.id, name: crossing.name, lat: crossing.lat, lon: crossing.lon }, state, nextCloseIn, nextOpenIn, phase: nextClosure ? { start: phaseStart, end: phaseEnd, durationMinutes: Math.round((nextClosure.end.getTime() - nextClosure.start.getTime()) / 60000), trainCount: nextClosure.trains.length, trains: nextClosure.trains } : null, closureCount: visibleClosures.length, closures: visibleClosures.map((closure) => ({ start: closure.start.toISOString(), end: closure.end.toISOString(), durationMinutes: Math.round((closure.end.getTime() - closure.start.getTime()) / 60000), trainCount: closure.trains.length, trains: closure.trains })), trainCount: trains.length, trains, divertedTrains });
}
