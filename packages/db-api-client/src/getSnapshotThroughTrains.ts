import type { Client } from "@libsql/client";
import type { Crossing } from "../../crossing-model/src/types";

export type SnapshotThroughTrain = {
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
  detection: "snapshot-route";
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

function matchesRoute(trainRoute: string[], observationStation: string, requiredRouteStops: string[]) {
  if (!trainRoute.length) return false;
  const infrastructureRefs = requiredRouteStops.filter((stop) => /^\d{2,6}$/.test(String(stop).trim()));
  if (infrastructureRefs.length) return routeIndex(trainRoute, observationStation) >= 0;

  const anchors = requiredRouteStops
    .map((stop, order) => ({ stop, order, index: routeIndex(trainRoute, stop) }))
    .filter((entry) => entry.index >= 0);

  if (anchors.length < 2) {
    // Without two configured anchors the observation station is still a hard
    // route gate. The OSM matcher performs the final crossing-path check.
    return routeIndex(trainRoute, observationStation) >= 0;
  }

  const ordered = [...anchors].sort((a, b) => a.order - b.order);
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i - 1].index >= ordered[i].index) return false;
  }
  const observationIndex = routeIndex(trainRoute, observationStation);
  if (observationIndex >= 0) {
    if (observationIndex < ordered[0].index || observationIndex > ordered[ordered.length - 1].index) return false;
  }
  return true;
}

function directionForRoute(route: string[], observationStation: string, requiredRouteStops: string[]) {
  const observation = routeIndex(route, observationStation);
  if (observation < 0) return "unknown" as const;
  const anchors = requiredRouteStops
    .filter((stop) => !/^\d{2,6}$/.test(String(stop).trim()))
    .map((stop) => ({ stop, index: routeIndex(route, stop) }))
    .filter((entry) => entry.index >= 0);
  const previous = [...anchors].filter((entry) => entry.index < observation).sort((a, b) => b.index - a.index)[0];
  const next = [...anchors].filter((entry) => entry.index > observation).sort((a, b) => a.index - b.index)[0];
  const westName = /osnabrück|osnabruck|münster|munster|rheine/i;
  const eastName = /hannover|herford|bielefeld/i;
  if (previous && westName.test(previous.stop)) return "eastbound" as const;
  if (previous && eastName.test(previous.stop)) return "westbound" as const;
  if (next && westName.test(next.stop)) return "westbound" as const;
  if (next && eastName.test(next.stop)) return "eastbound" as const;
  return "unknown" as const;
}

function ruleAllowsTrain(rule: any, train: { category?: string; line?: string }) {
  const categories = Array.isArray(rule.categories) ? rule.categories : [];
  if (!categories.length) return true;
  const line = String(train.line || "").toUpperCase();
  const category = String(train.category || "");
  return categories.includes(category) || categories.some((value: string) => line.includes(String(value).toUpperCase()));
}

function parseJson(value: unknown, fallback: any) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}

function snapshotCallsContain(calls: any[], station: string) {
  const target = normalizeStationName(station);
  return calls.find((call) => {
    const value = normalizeStationName(String(call?.name || ""));
    return value === target || value.includes(target) || target.includes(value);
  });
}

export async function getSnapshotThroughTrains(db: Client, crossing: Crossing): Promise<SnapshotThroughTrain[] | null> {
  try {
    const rules = (crossing.throughRules?.length
      ? crossing.throughRules
      : crossing.observationEvas.map((eva: string) => ({ observationEva: eva, observationStation: eva, categories: [], trackDistanceMeters: 0, fallbackOffsetSeconds: 300, direction: "unknown" }))) as any[];
    if (!rules.length) return [];

    const now = Date.now();
    const from = new Date(now - 5 * 60_000).toISOString();
    const to = new Date(now + 3 * 60 * 60_000).toISOString();
    const result = await db.execute({
      sql: `SELECT line,category,journey_number,journey_ref,origin,destination,route_json,calls_json,delay_minutes,actual_time,scheduled_time,direction FROM mobilithek_train_snapshot WHERE actual_time >= ? AND actual_time <= ? ORDER BY actual_time ASC LIMIT 5000`,
      args: [from, to],
    });

    const candidates: SnapshotThroughTrain[] = [];
    for (const row of result.rows as any[]) {
      const route = parseJson(row.route_json, []).map(String).filter(Boolean);
      const calls = parseJson(row.calls_json, []);
      if (route.length < 2) continue;
      const train = { line: String(row.line || ""), category: String(row.category || "") };

      for (const rule of rules) {
        if (!ruleAllowsTrain(rule, train)) continue;
        const observationStation = String(rule.observationStation || "");
        if (!matchesRoute(route, observationStation, crossing.requiredRouteStops || [])) continue;

        const observationCall = snapshotCallsContain(calls, observationStation);
        const observationTime = observationCall?.actual || observationCall?.planned || row.actual_time;
        const parsedObservation = new Date(observationTime);
        if (!Number.isFinite(parsedObservation.getTime())) continue;

        const expectedDirection = directionForRoute(route, observationStation, crossing.requiredRouteStops || []);
        if (rule.direction !== "unknown" && expectedDirection !== "unknown" && rule.direction !== expectedDirection) continue;

        const crossingTime = new Date(parsedObservation.getTime() + Number(rule.fallbackOffsetSeconds || 300) * 1000);
        if (crossingTime.getTime() < now - 60_000 || crossingTime.getTime() > now + 3 * 60 * 60_000) continue;

        candidates.push({
          type: "through",
          line: String(row.line || ""),
          category: String(row.category || ""),
          journeyNumber: Number(row.journey_number || 0),
          destination: row.destination ? String(row.destination) : undefined,
          origin: row.origin ? String(row.origin) : undefined,
          route,
          delayMinutes: Number(row.delay_minutes || 0),
          observationEva: String(rule.observationEva || ""),
          observationStation,
          observationActualTime: parsedObservation.toISOString(),
          fallbackOffsetSeconds: Number(rule.fallbackOffsetSeconds || 300),
          trackDistanceMeters: Number(rule.trackDistanceMeters || 0),
          direction: rule.direction === "unknown" ? expectedDirection : rule.direction,
          crossingTime: crossingTime.toISOString(),
          detection: "snapshot-route",
        });
        break;
      }
    }

    return Array.from(new Map(candidates.map((train) => [`${train.category}-${train.journeyNumber}`, train])).values());
  } catch (error) {
    console.warn("Mobilithek snapshot unavailable", error);
    return null;
  }
}