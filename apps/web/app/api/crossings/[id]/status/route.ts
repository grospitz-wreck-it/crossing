import { db } from "../../../../lib/db";
import { getStationTimetable } from "../../../../../../../packages/db-api-client/src/getStationTimetable";
import { getThroughTrains } from "../../../../../../../packages/db-api-client/src/getThroughTrains";
import { getDivertedTrains } from "../../../../../../../packages/db-api-client/src/getDivertedTrains";
import { getReroutedTrains } from "../../../../../../../packages/db-api-client/src/getReroutedTrains";
import { getCrossingDirection } from "../../../../../../../packages/prediction-engine/src/getCrossingDirection";
import { crossings as staticCrossings } from "../../../../../../../packages/crossing-model/src/crossings";
import { withMemoryCache } from "../../../../../../../packages/db-api-client/src/memoryCache";
import { filterTrainByCrossingOsm } from "../../../../lib/crossingOsmFilter";

function jsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  try { return value ? JSON.parse(String(value)) : []; } catch { return []; }
}

function buildCrossingFromDb(row: any, stationRows: any[]): any {
  let observationEvas = jsonArray(row.observation_evas).map(String).filter(Boolean);
  if (!observationEvas.length) {
    observationEvas = stationRows
      .filter((station) => !station.role || station.role === "observation" || station.role === "automatic")
      .map((station) => String(station.eva || "").trim())
      .filter(Boolean);
  }
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
    id: String(row.id), name: String(row.name || row.id), eva: String(row.eva || ""), observationEvas,
    contextEvas, requiredRouteStops, lat: Number(row.lat), lon: Number(row.lon),
    closeOffsetSeconds: Number(row.close_offset_seconds || 80), openOffsetSeconds: Number(row.open_offset_seconds || 20),
    rules: [], throughRules: normalizedThroughRules, diversionRules, rerouteWatchRules,
    confidence: Number(row.confidence || 0.5),
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

/**
 * OSM is authoritative only when the crossing has a trusted mapping.
 * Without one, preserve the existing timetable/through-rule behaviour.
 */
async function allowTrainForCrossing(crossingId: string, train: any): Promise<boolean> {
  const route = Array.isArray(train?.route) ? train.route.map(String).filter(Boolean) : [];
  if (!route.length) return true;

  const result = await filterTrainByCrossingOsm(crossingId, route);
  if (result.status === "rejected") {
    console.info("OSM rejected train for crossing", {
      crossingId,
      journeyNumber: train.journeyNumber,
      line: train.line,
      score: result.score,
      railwayWayId: result.railwayWayId,
      ref: result.ref,
    });
    return false;
  }
  return true;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const crossing = (await loadCrossing(id)) || staticCrossings.find((c) => c.id === id);
  if (!crossing) return Response.json({ error: "Crossing not found" }, { status: 404 });

  const trains: any[] = [];

  if (crossing.eva) {
    try {
      const localEvents = await getStationTimetable(crossing.eva, 4);
      for (const train of localEvents) {
        if (train.cancelled) continue;
        if (!(await allowTrainForCrossing(crossing.id, train))) continue;
        const isStoppingTrain = train.platform === "1" || train.platform === "2";
        const crossingTime = train.actualTime;
        const etaSeconds = Math.floor((crossingTime.getTime() - Date.now()) / 1000);
        trains.push({
          id: `${train.category}-${train.journeyNumber}-${train.id}`,
          line: train.line, category: train.category, journeyNumber: train.journeyNumber,
          origin: train.origin, destination: train.destination, platform: train.platform,
          isStoppingTrain, direction: getCrossingDirection(train.route),
          directionLabel: train.destination ? `Richtung ${train.destination}` : null,
          delayMinutes: train.delayMinutes, crossingTime: crossingTime.toISOString(),
          arrival: crossingTime.toISOString(), etaSeconds,
        });
      }
    } catch (error) { console.error("Failed to load local timetable:", error); }
  }

  if (!crossing.eva && crossing.observationEvas?.length) {
    const existingKeys = new Set(trains.map((t) => `${t.category}-${t.journeyNumber}`));
    for (const observationEva of crossing.observationEvas) {
      try {
        const events = await getStationTimetable(observationEva, 4);
        for (const train of events) {
          if (train.cancelled || train.actualTime.getTime() <= Date.now() - 60_000) continue;
          if (!(await allowTrainForCrossing(crossing.id, train))) continue;
          const crossingTime = train.actualTime;
          const key = `${train.category}-${train.journeyNumber}`;
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);
          trains.push({
            id: `${train.category}-${train.journeyNumber}-${observationEva}`,
            line: train.line, category: train.category, journeyNumber: train.journeyNumber,
            origin: train.origin, destination: train.destination, platform: train.platform,
            isStoppingTrain: train.platform === "1" || train.platform === "2",
            direction: getCrossingDirection(train.route),
            directionLabel: train.destination ? `Richtung ${train.destination}` : null,
            delayMinutes: train.delayMinutes, crossingTime: crossingTime.toISOString(),
            arrival: crossingTime.toISOString(), etaSeconds: Math.floor((crossingTime.getTime() - Date.now()) / 1000),
            estimatedFrom: { observationEva },
          });
        }
      } catch (error) { console.error(`Failed to load observation timetable ${observationEva}:`, error); }
    }
  }

  try {
    const throughTrains = await withMemoryCache(`through-${crossing.id}`, 5000, () => getThroughTrains(crossing));
    const existingKeys = new Set(trains.map((t) => `${t.category}-${t.journeyNumber}`));
    for (const train of throughTrains) {
      if (!(await allowTrainForCrossing(crossing.id, train))) continue;
      const key = `${train.category}-${train.journeyNumber}`;
      if (existingKeys.has(key)) continue;
      const crossingTime = new Date(train.crossingTime);
      trains.push({
        id: `${train.category}-${train.journeyNumber}`, line: train.line, category: train.category,
        journeyNumber: train.journeyNumber, origin: train.origin, destination: train.destination,
        platform: train.direction === "westbound" ? "1" : train.direction === "eastbound" ? "2" : undefined,
        isStoppingTrain: false, direction: train.direction, directionLabel: "Durchfahrt",
        delayMinutes: train.delayMinutes, crossingTime: crossingTime.toISOString(), arrival: crossingTime.toISOString(),
        etaSeconds: Math.floor((crossingTime.getTime() - Date.now()) / 1000),
        estimatedFrom: { observationStation: train.observationStation, observationActualTime: train.observationActualTime, fallbackOffsetSeconds: train.fallbackOffsetSeconds },
      });
    }
  } catch (error) { console.error("Failed to load through trains:", error); }

  let divertedTrains: any[] = [];
  try { divertedTrains = await withMemoryCache(`diverted-${crossing.id}`, 5000, () => getDivertedTrains(crossing)); }
  catch (error) { console.error("Failed to load diverted trains:", error); }

  try {
    const reroutedTrains = await withMemoryCache(`rerouted-${crossing.id}`, 5000, () => getReroutedTrains(crossing));
    const existingKeys = new Set(trains.map((t) => `${t.category}-${t.journeyNumber}`));
    for (const train of reroutedTrains) {
      if (!(await allowTrainForCrossing(crossing.id, train))) continue;
      const key = `${train.category}-${train.journeyNumber}`;
      if (existingKeys.has(key)) continue;
      const crossingTime = new Date(train.crossingTime);
      trains.push({
        id: `${train.category}-${train.journeyNumber}-rerouted`, line: train.line, category: train.category,
        journeyNumber: train.journeyNumber, origin: train.origin, destination: train.destination,
        platform: undefined, isStoppingTrain: false, direction: train.direction, directionLabel: "Umleitung",
        delayMinutes: train.delayMinutes, crossingTime: crossingTime.toISOString(), arrival: crossingTime.toISOString(),
        etaSeconds: Math.floor((crossingTime.getTime() - Date.now()) / 1000),
        estimatedFrom: { observationStation: train.observationStation, observationActualTime: train.observationActualTime, fallbackOffsetSeconds: train.fallbackOffsetSeconds },
        rerouted: true, note: train.note,
      });
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
  let state = "OPEN", nextCloseIn = 0, nextOpenIn = 0;
  let phaseStart: string | null = null, phaseEnd: string | null = null;
  if (nextClosure) {
    phaseStart = nextClosure.start.toISOString(); phaseEnd = nextClosure.end.toISOString();
    const nowMs = Date.now();
    if (nowMs < nextClosure.start.getTime()) nextCloseIn = Math.floor((nextClosure.start.getTime() - nowMs) / 1000);
    else { state = "CLOSED"; nextOpenIn = Math.floor((nextClosure.end.getTime() - nowMs) / 1000); }
  }

  return Response.json({
    crossing: { id: crossing.id, name: crossing.name, lat: crossing.lat, lon: crossing.lon }, state, nextCloseIn, nextOpenIn,
    phase: nextClosure ? { start: phaseStart, end: phaseEnd, durationMinutes: Math.round((nextClosure.end.getTime() - nextClosure.start.getTime()) / 60000), trainCount: nextClosure.trains.length, trains: nextClosure.trains } : null,
    closureCount: visibleClosures.length,
    closures: visibleClosures.map((closure) => ({ start: closure.start.toISOString(), end: closure.end.toISOString(), durationMinutes: Math.round((closure.end.getTime() - closure.start.getTime()) / 60000), trainCount: closure.trains.length, trains: closure.trains })),
    trainCount: trains.length, trains, divertedTrains,
  });
}