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
  if (!routeContainsStation(trainRoute, observationStation)) return false;
  const observationKey = normalizeStationName(observationStation);
  const anchors = requiredRouteStops.filter((stop) => normalizeStationName(stop) !== observationKey);
  if (!anchors.length) return true;
  const matched = anchors.filter((anchor) => routeContainsStation(trainRoute, anchor));
  // One additional official timetable stop is enough to establish the
  // configured corridor. The OSM filter in the status route remains the
  // final geometric gate.
  return matched.length >= 1;
}

function trainKey(train: OfficialTrainEvent) {
  return `${train.category}-${train.journeyNumber}`;
}

function directionForRoute(route: string[], observationStation: string, requiredRouteStops: string[]): "eastbound" | "westbound" | "unknown" {
  const observation = routeIndex(route, observationStation);
  const anchors = requiredRouteStops
    .map((stop) => ({ stop, index: routeIndex(route, stop) }))
    .filter((entry) => entry.index >= 0 && entry.index !== observation);
  if (observation < 0 || !anchors.length) return "unknown";

  const next = anchors.find((entry) => entry.index > observation);
  if (!next) return "unknown";
  if (/osnabrück|osnabruck|münster|munster/i.test(next.stop)) return "westbound";
  if (/hannover|herford|bielefeld/i.test(next.stop)) return "eastbound";
  return "unknown";
}

function chooseRule(rules: Crossing["throughRules"], train: OfficialTrainEvent, route: string[], crossing: Crossing) {
  return (rules || []).find((rule) => {
    if (rule.observationEva !== String(crossing.throughRules?.find((candidate) => candidate.observationEva === rule.observationEva)?.observationEva || rule.observationEva)) return false;
    if (!rule.categories.includes(train.category)) return false;
    if (!matchesOsmCorridor(route, rule.observationStation, crossing.requiredRouteStops || [])) return false;
    const expectedDirection = directionForRoute(route, rule.observationStation, crossing.requiredRouteStops || []);
    return rule.direction === "unknown" || expectedDirection === "unknown" || rule.direction === expectedDirection;
  });
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

  // Load each configured observation EVA once. getStationTimetable has the
  // shared 60-second cache/in-flight deduplication, so this does not create
  // duplicate DB API calls when another part of the forecast needs the same EVA.
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

  // When the same train is visible at two configured observation stations and
  // both rules have a configured distance to the crossing, anchor the crossing
  // time between the two official DB actual times instead of using a fixed
  // offset. No private journey API is involved.
  const byTrain = new Map<string, ThroughTrain[]>();
  for (const candidate of candidates) {
    const key = trainKey({ category: candidate.category, journeyNumber: candidate.journeyNumber } as OfficialTrainEvent);
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
