import type { Crossing } from "../../crossing-model/src/types";
import { getStationTimetable } from "./getStationTimetable";

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

function routeContainsStation(route: string[], requiredStop: string) {
  const target = normalizeStationName(requiredStop);
  if (!target) return false;
  return route.some((stop) => {
    const value = normalizeStationName(stop);
    return value === target || value.includes(target) || target.includes(value);
  });
}

function matchesOsmCorridor(trainRoute: string[], observationStation: string, requiredRouteStops: string[]) {
  const observationMatches = routeContainsStation(trainRoute, observationStation);
  const observationKey = normalizeStationName(observationStation);
  const anchors = requiredRouteStops.filter((stop) => normalizeStationName(stop) !== observationKey);
  const matchedAnchors = anchors.filter((anchor) => routeContainsStation(trainRoute, anchor));

  if (!anchors.length) return observationMatches;
  if (observationMatches && matchedAnchors.length >= 1) return true;
  return matchedAnchors.length >= 2;
}

// The crossing status view only forecasts the near term. Keep the same
// two-hour window as the normal observation load so a through-rule reuses the
// exact same shared timetable cache instead of creating another 4-hour batch.
const THROUGH_TIMETABLE_HOURS = 2;

export async function getThroughTrains(crossing: Crossing): Promise<ThroughTrain[]> {
  if (!crossing.throughRules?.length) return [];

  const candidates: ThroughTrain[] = [];

  for (const rule of crossing.throughRules) {
    let events;
    try {
      events = await getStationTimetable(rule.observationEva, THROUGH_TIMETABLE_HOURS);
    } catch (error) {
      console.error(`getThroughTrains: Timetable für ${rule.observationStation} (${rule.observationEva}) fehlgeschlagen`, error);
      continue;
    }

    const matching = events.filter((train) => {
      if (train.cancelled) return false;
      if (!rule.categories.includes(train.category)) return false;
      if (!matchesOsmCorridor(train.route || [], rule.observationStation, crossing.requiredRouteStops || [])) return false;
      if (rule.direction === "westbound" && train.destination !== "Amsterdam Centraal") return false;
      if (rule.direction === "eastbound" && train.destination !== "Berlin Südkreuz") return false;
      return true;
    });

    for (const train of matching) {
      const crossingTime = new Date(train.actualTime.getTime() + rule.fallbackOffsetSeconds * 1000);
      candidates.push({
        type: "through",
        line: train.line,
        category: train.category,
        journeyNumber: train.journeyNumber,
        destination: train.destination,
        origin: train.origin,
        route: train.route,
        delayMinutes: train.delayMinutes,
        observationEva: rule.observationEva,
        observationStation: rule.observationStation,
        observationActualTime: train.actualTime.toISOString(),
        fallbackOffsetSeconds: rule.fallbackOffsetSeconds,
        trackDistanceMeters: rule.trackDistanceMeters,
        direction: rule.direction,
        crossingTime: crossingTime.toISOString(),
      });
    }
  }

  return Array.from(new Map(candidates.map((train) => [`${train.category}-${train.journeyNumber}`, train])).values());
}
