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

/**
 * Match a train to the OSM-derived corridor without requiring the train to
 * stop at the observation station.
 *
 * The observation station is only the place where we obtain the timetable.
 * ICE/IC trains can pass the crossing corridor without appearing as a stop
 * there. Therefore a valid match is either:
 *   - observation station + at least one additional corridor anchor, or
 *   - at least two corridor anchors, even when the observation station is not
 *     part of the train's stop list.
 *
 * This keeps the corridor filter strict enough to prevent unrelated trains
 * from a shared observation station from leaking into a crossing forecast.
 */
function matchesOsmCorridor(trainRoute: string[], observationStation: string, requiredRouteStops: string[]) {
  const observationMatches = routeContainsStation(trainRoute, observationStation);
  const observationKey = normalizeStationName(observationStation);
  const anchors = requiredRouteStops.filter((stop) => normalizeStationName(stop) !== observationKey);
  const matchedAnchors = anchors.filter((anchor) => routeContainsStation(trainRoute, anchor));

  // Legacy/static crossings without corridor anchors keep the observation
  // station as the matching signal.
  if (!anchors.length) return observationMatches;

  // Preferred signal: observed station plus another corridor anchor.
  if (observationMatches && matchedAnchors.length >= 1) return true;

  // Through trains such as ICE may skip the observed station. Two independent
  // corridor anchors are sufficient to establish that the train is on the
  // configured rail corridor.
  return matchedAnchors.length >= 2;
}

export async function getThroughTrains(crossing: Crossing): Promise<ThroughTrain[]> {
  if (!crossing.throughRules?.length) return [];

  const candidates: ThroughTrain[] = [];

  for (const rule of crossing.throughRules) {
    let events;
    try {
      events = await getStationTimetable(rule.observationEva);
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
