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

/**
 * A crossing is a point on an OSM railway corridor, not necessarily a DB stop.
 * Therefore the train must NOT contain the crossing/observation station in its
 * route. The official timetable route is used to prove that the train actually
 * traverses the configured corridor between at least two of its route anchors.
 *
 * This is deliberately based on the CURRENT official route. If DB changes the
 * path because of an operational diversion, the changed route is what counts:
 * a diverted ICE/IC/RE/RB can therefore become a valid THROUGH candidate when
 * its actual route passes the crossing corridor.
 */
function matchesOsmCorridor(
  trainRoute: string[],
  observationStation: string,
  requiredRouteStops: string[]
) {
  if (!trainRoute.length) return false;

  const anchors = requiredRouteStops
    .map((stop, order) => ({
      stop,
      order,
      index: routeIndex(trainRoute, stop),
    }))
    .filter((entry) => entry.index >= 0);

  // A single station is not enough to prove that a train passes the crossing.
  // We need two configured OSM corridor anchors on the actual DB route.
  if (anchors.length < 2) return false;

  // The route must contain the anchors in the same order in which the
  // crossing configuration defines the corridor. This rejects trains that
  // merely happen to visit one matching station somewhere else in their run.
  const ordered = [...anchors].sort((a, b) => a.order - b.order);
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i - 1].index >= ordered[i].index) {
      return false;
    }
  }

  // If the observation station itself is present, it is a useful additional
  // consistency check. It is NOT required: through trains normally do not
  // stop at the crossing and may be observed at a different DB station.
  const observationIndex = routeIndex(trainRoute, observationStation);
  if (observationIndex >= 0) {
    const first = ordered[0].index;
    const last = ordered[ordered.length - 1].index;
    if (observationIndex < first || observationIndex > last) return false;
  }

  return true;
}

function trainKey(train: OfficialTrainEvent) {
  return `${train.category}-${train.journeyNumber}`;
}

function directionForRoute(
  route: string[],
  observationStation: string,
  requiredRouteStops: string[]
): "eastbound" | "westbound" | "unknown" {
  if (!route.length) return "unknown";

  const observation = routeIndex(route, observationStation);
  const anchors = requiredRouteStops
    .map((stop) => ({ stop, index: routeIndex(route, stop) }))
    .filter((entry) => entry.index >= 0);

  if (observation < 0) {
    // For a through train observed at a remote anchor station, derive the
    // direction from the ordered corridor itself.
    if (anchors.length >= 2) {
      const first = anchors[0].stop;
      const last = anchors[anchors.length - 1].stop;
      const westName = /osnabrück|osnabruck|münster|munster|rheine/i;
      const eastName = /hannover|herford|bielefeld/i;
      if (westName.test(first) && eastName.test(last)) return "eastbound";
      if (eastName.test(first) && westName.test(last)) return "westbound";
    }
    return "unknown";
  }

  const previous = [...anchors]
    .filter((entry) => entry.index < observation)
    .sort((a, b) => b.index - a.index)[0];
  const next = [...anchors]
    .filter((entry) => entry.index > observation)
    .sort((a, b) => a.index - b.index)[0];

  const westName = /osnabrück|osnabruck|münster|munster|rheine/i;
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

  const uniqueEvas = Array.from(
    new Set(
      crossing.throughRules
        .map((rule) => String(rule.observationEva).trim())
        .filter(Boolean)
    )
  );
  const timetableByEva = new Map<string, OfficialTrainEvent[]>();

  await Promise.all(
    uniqueEvas.map(async (eva) => {
      try {
        timetableByEva.set(
          eva,
          await getStationTimetable(eva, THROUGH_TIMETABLE_HOURS)
        );
      } catch (error) {
        console.error(
          `getThroughTrains: Timetable für ${eva} fehlgeschlagen`,
          error
        );
      }
    })
  );

  const candidates: ThroughTrain[] = [];

  for (const rule of crossing.throughRules) {
    const events =
      timetableByEva.get(String(rule.observationEva).trim()) || [];

    for (const train of events) {
      if (train.cancelled || !rule.categories.includes(train.category)) continue;

      const route = train.route || [];

      // The actual official DB route is the decisive signal. This means an
      // operationally rerouted train is treated exactly like any other train
      // if its current route traverses the OSM corridor of this crossing.
      if (
        !matchesOsmCorridor(
          route,
          rule.observationStation,
          crossing.requiredRouteStops || []
        )
      ) {
        continue;
      }

      const expectedDirection = directionForRoute(
        route,
        rule.observationStation,
        crossing.requiredRouteStops || []
      );

      if (
        rule.direction !== "unknown" &&
        expectedDirection !== "unknown" &&
        rule.direction !== expectedDirection
      ) {
        continue;
      }

      const crossingTime = new Date(
        train.actualTime.getTime() + rule.fallbackOffsetSeconds * 1000
      ).toISOString();

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
        direction:
          rule.direction === "unknown" ? expectedDirection : rule.direction,
        crossingTime,
        detection: "official-route",
      });
    }
  }

  const byTrain = new Map<string, ThroughTrain[]>();
  for (const candidate of candidates) {
    const key = trainKey(candidate as unknown as OfficialTrainEvent);
    const list = byTrain.get(key) || [];
    list.push(candidate);
    byTrain.set(key, list);
  }

  // If the same train is observed at two configured DB stations, use the two
  // actual DB times as anchors and interpolate the crossing time. This is the
  // preferred method because it automatically follows delays and diversions.
  for (const list of byTrain.values()) {
    if (list.length < 2) continue;

    const sorted = [...list].sort(
      (a, b) =>
        Date.parse(a.observationActualTime) -
        Date.parse(b.observationActualTime)
    );

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

  return Array.from(
    new Map(
      candidates.map((train) => [
        `${train.category}-${train.journeyNumber}`,
        train,
      ])
    ).values()
  );
}
