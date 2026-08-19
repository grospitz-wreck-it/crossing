import type { Crossing } from "../../crossing-model/src/types";
import { getStationTimetable } from "./getStationTimetable";
import type { OfficialTrainEvent } from "./parseOfficialTimetable";

export type ThroughTrain = {
  type: "through";
  line: string;
  category: string;
  journeyNumber: number;
  destination?: string;
  origin?: string;
  route: string[];
  delayMinutes: number;
  observationEva: string;
  observationStation: string;
  observationActualTime: string;
  fallbackOffsetSeconds: number;
  trackDistanceMeters: number;
  direction: "eastbound" | "westbound" | "unknown";
  crossingTime: string;
  detection: "official-route" | "official-route-time-anchored";
};

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

function routeContainsStation(route: string[], station: string) {
  return routeIndex(route, station) >= 0;
}

function matchesOsmCorridor(trainRoute: string[], observationStation: string, requiredRouteStops: string[]) {
  // Some DB timetable records do not contain a usable ppth. In that case the
  // OSM filter in the status route is the independent final gate; do not throw
  // an otherwise valid ICE/IC/EC candidate away here.
  if (!trainRoute.length) return true;
  if (!routeContainsStation(trainRoute, observationStation)) return false;
  const observationKey = normalizeStationName(observationStation);
  const anchors = requiredRouteStops.filter((stop) => normalizeStationName(stop) !== observationKey);
  if (!anchors.length) return true;
  const matched = anchors.filter((anchor) => routeContainsStation(trainRoute, anchor));
  return matched.length >= 1;
}

function trainKey(train: OfficialTrainEvent) {
  return `${train.category}-${train.journeyNumber}`;
}

function directionForRoute(route: string[], observationStation: string, requiredRouteStops: string[]): "eastbound" | "westbound" | "unknown" {
  if (!route.length) return "unknown";
  const observation = routeIndex(route, observationStation);
  if (observation < 0) return "unknown";

  const anchors = requiredRouteStops
    .map((stop) => ({ stop, index: routeIndex(route, stop) }))
    .filter((entry) => entry.index >= 0 && entry.index !== observation);

  // Direction is determined from the nearest configured corridor anchor on
  // either side of the observation station. This is important at Bünde:
  // westbound trains have Osnabrück behind them, eastbound trains Hannover /
  // Herford ahead of them. Looking only at the next stop reverses westbound.
  const previous = [...anchors]
    .filter((entry) => entry.index < observation)
    .sort((a, b) => b.index - a.index)[0];
  const next = [...anchors]
    .filter((entry) => entry.index > observation)
    .sort((a, b) => a.index - b.index)[0];

  const westName = /osnabrück|osnabruck|münster|munster/i;
  const eastName = /hannover|herford|bielefeld/i;

  if (previous && westName.test(previous.stop)) return "eastbound";
  if (previous && eastName.test(previous.stop)) return "westbound";
  if (next && westName.test(next.stop)) return "westbound";
  if (next && eastName.test(next.stop)) return "eastbound";
  return "unknown";
}

function interpolateCrossingTime(before: ThroughTrain, after: ThroughTrain): string | null {
  const t1 = Date.parse(before.observationActualTime);
  const t2 = Date.parse(after.observationActualTime);
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 <= t1) return null;
  const d1 = Math.max(0, Number(before.trackDistanceMeters) || 0);
  const d2 = Math.max(0, Number(after.trackDistanceMeters) || 0);
  if (!(d1 > 0 && d2 > 0)) return null;
  const ratio = Math.min(0.9, Math.max(0.1, d1 / (d1 + d2)));
  return new Date(t1 + (t2 - t1) * ratio).toISOString();
}

const THROUGH_TIMETABLE_HOURS = 1;

export async function getThroughTrains(crossing: Crossing): Promise<ThroughTrain[]> {
  if (!crossing.throughRules?.length) return [];

  const uniqueEvas = Array.from(new Set(crossing.throughRules.map((rule) => String(rule.observationEva).trim()).filter(Boolean)));
  const timetableByEva = new Map<string, OfficialTrainEvent[]>();

  await Promise.all(uniqueEvas.map(async (eva) => {
    try {
      timetableByEva.set(eva, await getStationTimetable(eva, THROUGH_TIMETABLE_HOURS));
    } catch (error) {
      console.error(`getThroughTrains: Timetable für ${eva} fehlgeschlagen`, error);
    }
  }));

  const candidates: ThroughTrain[] = [];

  for (const rule of crossing.throughRules) {
    const events = timetableByEva.get(String(rule.observationEva).trim()) || [];
    for (const train of events) {
      if (train.cancelled || !rule.categories.includes(train.category)) continue;
      const route = train.route || [];
      if (!matchesOsmCorridor(route, rule.observationStation, crossing.requiredRouteStops || [])) continue;
      const expectedDirection = directionForRoute(route, rule.observationStation, crossing.requiredRouteStops || []);
      if (rule.direction !== "unknown" && expectedDirection !== "unknown" && rule.direction !== expectedDirection) continue;

      const crossingTime = new Date(train.actualTime.getTime() + rule.fallbackOffsetSeconds * 1000).toISOString();
      candidates.push({
        type: "through",
        line: train.line,
        category: train.category,
        journeyNumber: train.journeyNumber,
        destination: train.destination,
        origin: train.origin,
        route,
        delayMinutes: train.delayMinutes,
        observationEva: rule.observationEva,
        observationStation: rule.observationStation,
        observationActualTime: train.actualTime.toISOString(),
        fallbackOffsetSeconds: rule.fallbackOffsetSeconds,
        trackDistanceMeters: rule.trackDistanceMeters,
        direction: rule.direction === "unknown" ? expectedDirection : rule.direction,
        crossingTime,
        detection: "official-route",
      });
    }
  }

  const byTrain = new Map<string, ThroughTrain[]>();
  for (const candidate of candidates) {
    const key = `${candidate.category}-${candidate.journeyNumber}`;
    const list = byTrain.get(key) || [];
    list.push(candidate);
    byTrain.set(key, list);
  }

  for (const list of byTrain.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => Date.parse(a.observationActualTime) - Date.parse(b.observationActualTime));
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const interpolated = interpolateCrossingTime(sorted[i], sorted[i + 1]);
      if (!interpolated) continue;
      for (const candidate of list) {
        candidate.crossingTime = interpolated;
        candidate.detection = "official-route-time-anchored";
      }
      break;
    }
  }

  return Array.from(new Map(candidates.map((train) => [`${train.category}-${train.journeyNumber}`, train])).values());
}
