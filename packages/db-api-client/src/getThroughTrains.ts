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
 * OSM is used when the crossing is configured: the selected OSM railway
 * relation supplies the corridor stations/anchors which are persisted as
 * requiredRouteStops. A train does NOT have to stop at every anchor. This is
 * important for ICE/IC services because they can traverse the selected
 * infrastructure while skipping local stations.
 *
 * We therefore require two independent signals for a through-rule:
 *  1. the train's actual route contains the observation station that was
 *     selected on/near the OSM railway geometry; and
 *  2. the route contains at least one additional OSM-derived corridor anchor.
 *
 * This prevents a train which merely visits a shared junction station from
 * being treated as a train on the selected crossing route, while still
 * allowing trains which pass the crossing without stopping there.
 */
function matchesOsmCorridor(trainRoute: string[], observationStation: string, requiredRouteStops: string[]) {
  if (!routeContainsStation(trainRoute, observationStation)) return false;

  const observationKey = normalizeStationName(observationStation);
  const additionalAnchors = requiredRouteStops.filter((stop) => normalizeStationName(stop) !== observationKey);

  // Older/static crossings may not have corridor anchors. Keep their former
  // behaviour rather than rejecting them solely because the new OSM metadata
  // is absent.
  if (!additionalAnchors.length) return true;

  return additionalAnchors.some((anchor) => routeContainsStation(trainRoute, anchor));
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

      // IMPORTANT: requiredRouteStops are corridor anchors derived from the
      // selected OSM railway infrastructure. They are NOT required train
      // stops. A train may pass the crossing without stopping at the crossing
      // station, so matching is based on the observed station + another
      // corridor anchor.
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
