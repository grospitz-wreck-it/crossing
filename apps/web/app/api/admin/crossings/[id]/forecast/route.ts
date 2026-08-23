import { db } from "../../../../../lib/db";
import { getStationTimetable } from "../../../../../../../../packages/db-api-client/src/getStationTimetable";
import { getMobilithekTrainRegistry, type MobilithekTrainEvent } from "../../../../../../../../packages/db-api-client/src/mobilithekTimetable";

function jsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  try { return value ? JSON.parse(String(value)) : []; } catch { return []; }
}

const MAX_DIRECT_OBSERVATION_STATIONS = 6;
const MAX_RULE_STATIONS = 8;
const FORECAST_TIMETABLE_HOURS = 1;

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

function routeIndex(route: string[], station: string) {
  const target = normalizeStationName(station);
  if (!target) return -1;
  return route.findIndex((stop) => {
    const value = normalizeStationName(stop);
    return value === target || value.includes(target) || target.includes(value);
  });
}

function matchesCorridor(route: string[], observationStation: string, requiredRouteStops: string[]) {
  if (!route.length) return false;
  if (requiredRouteStops.length >= 2) {
    let previous = -1;
    for (const stop of requiredRouteStops) {
      const index = routeIndex(route, stop);
      if (index < 0 || index <= previous) return false;
      previous = index;
    }
    const observation = routeIndex(route, observationStation);
    if (observation >= 0) {
      const first = routeIndex(route, requiredRouteStops[0]);
      const last = routeIndex(route, requiredRouteStops[requiredRouteStops.length - 1]);
      if (observation < first || observation > last) return false;
    }
    return true;
  }
  if (requiredRouteStops.length === 1) return routeIndex(route, requiredRouteStops[0]) >= 0;
  return routeIndex(route, observationStation) >= 0;
}

function mobilithekCallForStation(train: MobilithekTrainEvent, station: string) {
  const target = normalizeStationName(station);
  return train.calls.find((call) => {
    const value = normalizeStationName(call.name);
    return value === target || value.includes(target) || target.includes(value);
  });
}

function ruleAllowsTrain(rule: any, train: MobilithekTrainEvent) {
  const categories = Array.isArray(rule.categories) ? rule.categories.map((v: any) => String(v).toUpperCase()) : [];
  const legacyLongDistance = categories.length === 3 && categories.includes("ICE") && categories.includes("IC") && categories.includes("EC");
  if (legacyLongDistance || !categories.length) return true;
  return categories.includes(String(train.category || "").toUpperCase()) || categories.some((category: string) => String(train.line || "").toUpperCase().includes(category));
}

function addCandidate(trainsByKey: Map<string, any>, crossing: any, train: MobilithekTrainEvent, rule: any, stationName: string, crossingTime: Date, now: number, source: string) {
  const etaSeconds = Math.floor((crossingTime.getTime() - now) / 1000);
  if (etaSeconds <= 0 || etaSeconds > 3 * 60 * 60) return;
  const key = `${train.category}-${train.journeyNumber}`;
  const candidate = {
    id: `${key}-${rule.observationEva || "observation"}`,
    line: train.line,
    category: train.category,
    journeyNumber: train.journeyNumber,
    origin: train.origin,
    destination: train.destination,
    platform: undefined,
    delayMinutes: train.delayMinutes,
    observationStation: stationName,
    observationEva: rule.observationEva,
    crossingTime: crossingTime.toISOString(),
    closeAt: new Date(crossingTime.getTime() - Number(crossing.close_offset_seconds || 80) * 1000).toISOString(),
    openAt: new Date(crossingTime.getTime() + Number(crossing.open_offset_seconds || 20) * 1000).toISOString(),
    etaSeconds,
    direction: rule.direction || "unknown",
    route: train.route,
    source,
    detection: "official-route",
    isThrough: source === "through-rule",
    throughObservation: stationName,
  };
  const existing = trainsByKey.get(key);
  if (!existing || candidate.etaSeconds < existing.etaSeconds) trainsByKey.set(key, candidate);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await db.execute({
    sql: `SELECT id,name,eva,lat,lon,close_offset_seconds,open_offset_seconds,confidence,status,observation_evas,context_evas,required_route_stops,through_rules,diversion_rules,reroute_watch_rules FROM crossings WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const crossing: any = result.rows[0];
  if (!crossing) return Response.json({ error: "Crossing not found" }, { status: 404 });

  const stationLinks = await db.execute({
    sql: `SELECT eva,station_name,role,sort_order FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order ASC`,
    args: [id],
  }).catch(() => ({ rows: [] as any[] }));
  const stationNameByEva = new Map<string, string>();
  for (const row of stationLinks.rows as any[]) {
    const eva = String(row.eva || "").trim();
    if (eva) stationNameByEva.set(eva, String(row.station_name || eva));
  }

  const allObservationEvas = jsonArray(crossing.observation_evas).map((v) => String(v || "").trim()).filter(Boolean);
  if (crossing.eva && !allObservationEvas.includes(String(crossing.eva))) allObservationEvas.unshift(String(crossing.eva));
  const contextEvas = jsonArray(crossing.context_evas).map((v) => String(v || "").trim()).filter(Boolean);
  const requiredRouteStops = jsonArray(crossing.required_route_stops).map((v) => String(v || "").trim()).filter(Boolean);
  const throughRules = jsonArray(crossing.through_rules).slice(0, MAX_RULE_STATIONS);
  const observationEvas = allObservationEvas.slice(0, MAX_DIRECT_OBSERVATION_STATIONS);
  const now = Date.now();
  const trainsByKey = new Map<string, any>();
  const stationResults: any[] = [];

  if (!crossing.eva && throughRules.length) {
    try {
      const registry = await getMobilithekTrainRegistry();
      for (const rule of throughRules) {
        const station = String(rule.observationStation || stationNameByEva.get(String(rule.observationEva || "")) || "").trim();
        if (!station) continue;
        for (const train of registry) {
          if (!ruleAllowsTrain(rule, train)) continue;
          if (!matchesCorridor(train.route || [], station, requiredRouteStops)) continue;
          const call = mobilithekCallForStation(train, station);
          if (!call?.actual) continue;
          const fallbackOffset = Number(rule.fallbackOffsetSeconds || 0);
          addCandidate(trainsByKey, crossing, train, rule, station, new Date(call.actual.getTime() + fallbackOffset * 1000), now, "through-rule");
        }
        stationResults.push({ eva: String(rule.observationEva || ""), stationName: station, role: "rule", rule: true, ok: true, count: registry.length });
      }
    } catch (error) {
      stationResults.push({ role: "rule", ok: false, count: 0, error: error instanceof Error ? error.message : String(error) });
    }
  } else {
    const observationResults = await Promise.all(observationEvas.map(async (eva) => {
      try { return { eva, events: await getStationTimetable(eva, FORECAST_TIMETABLE_HOURS), error: null as any }; }
      catch (error) { return { eva, events: [] as any[], error: error instanceof Error ? error.message : String(error) }; }
    }));
    for (const { eva, events, error } of observationResults) {
      const stationName = stationNameByEva.get(eva) || eva;
      if (error) {
        stationResults.push({ eva, stationName, role: "observation", count: 0, ok: false, error });
        continue;
      }
      stationResults.push({ eva, stationName, role: "observation", count: events.length, ok: true });
      for (const train of events) {
        if (train.cancelled || train.actualTime.getTime() <= now - 60000) continue;
        if (!matchesCorridor(train.route || [], stationName, requiredRouteStops)) continue;
        addCandidate(trainsByKey, crossing, train as any, { observationEva: eva }, stationName, train.actualTime, now, "observation");
      }
    }
  }

  for (const eva of contextEvas.slice(0, 2)) {
    if (!throughRules.some((rule: any) => String(rule.observationEva || "") === eva)) {
      stationResults.push({ eva, stationName: stationNameByEva.get(eva) || eva, role: "context", rule: false, ok: true });
    }
  }

  const trains = [...trainsByKey.values()].filter((train) => train.etaSeconds > 0).sort((a, b) => a.etaSeconds - b.etaSeconds);
  const closures: any[] = [];
  for (const train of trains) {
    const start = new Date(train.closeAt);
    const end = new Date(train.openAt);
    const last = closures[closures.length - 1];
    if (!last || start.getTime() > last.end.getTime() + 30000) closures.push({ start, end, trains: [train] });
    else { if (end.getTime() > last.end.getTime()) last.end = end; last.trains.push(train); }
  }

  const nextClosure = closures.find((closure) => closure.end.getTime() > now) || null;
  let state = "OPEN";
  if (nextClosure && now >= nextClosure.start.getTime() && now < nextClosure.end.getTime()) state = "CLOSED";

  return Response.json({
    crossing: { id: String(crossing.id), name: String(crossing.name), lat: Number(crossing.lat), lon: Number(crossing.lon), route: requiredRouteStops },
    state,
    nextClosure: nextClosure ? {
      start: nextClosure.start.toISOString(),
      end: nextClosure.end.toISOString(),
      closeInSeconds: Math.max(0, Math.floor((nextClosure.start.getTime() - now) / 1000)),
      openInSeconds: Math.max(0, Math.floor((nextClosure.end.getTime() - now) / 1000)),
      trains: nextClosure.trains,
    } : null,
    closures: closures.slice(0, 30).map((closure) => ({
      start: closure.start.toISOString(), end: closure.end.toISOString(),
      durationMinutes: Math.round((closure.end.getTime() - closure.start.getTime()) / 60000),
      trainCount: closure.trains.length, trains: closure.trains,
    })),
    trains,
    stations: stationResults,
    rules: {
      requiredRouteStops,
      throughRules,
      diversionRules: jsonArray(crossing.diversion_rules),
      rerouteWatchRules: jsonArray(crossing.reroute_watch_rules),
      apiProtection: {
        maxDirectObservationStations: MAX_DIRECT_OBSERVATION_STATIONS,
        maxRuleStations: MAX_RULE_STATIONS,
        timetableHours: FORECAST_TIMETABLE_HOURS,
        routeOnlyForInfrastructureCrossings: true,
      },
    },
  });
}
