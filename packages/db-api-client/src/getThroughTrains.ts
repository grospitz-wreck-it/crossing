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
  if (!target) return true;
  return route.some((stop) => {
    const value = normalizeStationName(stop);
    return value === target || value.includes(target) || target.includes(value);
  });
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

      const hasRequiredRoute = (crossing.requiredRouteStops || []).every((requiredStop) =>
        routeContainsStation(train.route || [], requiredStop)
      );
      if (!hasRequiredRoute) return false;

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
