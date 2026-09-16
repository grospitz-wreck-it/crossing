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

function normalizeRef(value: unknown) {
  const normalized = String(value ?? "").trim();
  return /^\d{4,}$/.test(normalized) ? normalized : "";
}

function routeIndex(route: string[], station: string) {
  const target = normalizeStationName(station);
  if (!target) return -1;
  return route.findIndex((stop) => {
    const value = normalizeStationName(stop);
    return value === target || value.includes(target) || target.includes(value);
  });
}

function routeRefIndex(route: string[], eva: string) {
  const target = normalizeRef(eva);
  if (!target) return -1;
  return route.findIndex((stop) => normalizeRef(stop) === target);
}

function callsRefIndex(calls: any[], eva: string) {
  const target = normalizeRef(eva);
  if (!target) return -1;
  return calls.findIndex((call) => normalizeRef(call?.name) === target);
}

function stationRuleForAnchor(crossing: Crossing, station: string) {
  const target = normalizeStationName(station);
  if (!target) return null;
  const rules = Array.isArray(crossing.throughRules) ? crossing.throughRules : [];
  return rules.find((rule: any) => {
    const value = normalizeStationName(String(rule?.observationStation || ""));
    return value === target || value.includes(target) || target.includes(value);
  }) ?? null;
}

function anchorRefs(crossing: Crossing) {
  return (crossing.requiredRouteStops || [])
    .map((station) => {
      const rule = stationRuleForAnchor(crossing, String(station));
      return {
        station: String(station),
        eva: normalizeRef(rule?.observationEva),
      };
    })
    .filter((anchor) => Boolean(anchor.eva));
}

/**
 * Mobilithek rail journeys currently store StopPointRef values in route_json.
 * They do not necessarily carry StopPointName values. For route-aware matching
 * we therefore prefer EVAs from the crossing's rules over station-name matching.
 *
 * A journey is a direct match when the observation EVA is present. If it is an
 * observation-only rule (e.g. Bünde/Osnabrück/Hannover), the journey must also
 * contain at least two configured route anchors in the configured order. This
 * prevents a generic ICE/IC journey to Hannover from being treated as a
 * Kirchlengern movement merely because it was observed at Hannover.
 */
function matchesRoute(
  trainRoute: string[],
  calls: any[],
  rule: any,
  crossing: Crossing,
) {
  if (!trainRoute.length) return false;

  const observationEva = normalizeRef(rule?.observationEva);
  const observationRefIndex =
    routeRefIndex(trainRoute, observationEva) >= 0
      ? routeRefIndex(trainRoute, observationEva)
      : callsRefIndex(calls, observationEva);

  if (observationRefIndex < 0) return false;

  const anchors = anchorRefs(crossing)
    .map((anchor) => ({
      ...anchor,
      index: routeRefIndex(trainRoute, anchor.eva),
    }))
    .filter((anchor) => anchor.index >= 0);

  // A direct BÜ observation is sufficient: the concrete journey itself
  // contains the crossing's EVA.
  if (observationEva && observationEva === normalizeRef(crossing.eva)) {
    return true;
  }

  // Observation at an anchor station: require another anchor in the journey so
  // that the observation is tied to the configured corridor, not merely to a
  // common destination such as Hannover Hbf.
  if (anchors.length >= 2) {
    const ordered = [...anchors].sort((a, b) => {
      const aOrder = (crossing.requiredRouteStops || []).indexOf(a.station);
      const bOrder = (crossing.requiredRouteStops || []).indexOf(b.station);
      return aOrder - bOrder;
    });

    for (let i = 1; i < ordered.length; i += 1) {
      if (ordered[i - 1].index >= ordered[i].index) return false;
    }

    const observationAnchor = ordered.find((anchor) => anchor.eva === observationEva);
    if (!observationAnchor) {
      return anchors.length >= 2;
    }

    return ordered.some(
      (anchor) => anchor.eva !== observationEva && anchor.index >= 0,
    );
  }

  // Legacy/name-based configurations can still work when the feed contains
  // station names instead of EVAs.
  if (routeRefIndex(trainRoute, observationEva) < 0) {
    return routeIndex(trainRoute, String(rule?.observationStation || "")) >= 0;
  }

  return true;
}

function directionForRoute(
  route: string[],
  observationStation: string,
  requiredRouteStops: string[],
  crossing: Crossing,
) {
  const observationRule = stationRuleForAnchor(crossing, observationStation);
  const observationEva = normalizeRef(observationRule?.observationEva);
  const observation = observationEva
    ? routeRefIndex(route, observationEva)
    : routeIndex(route, observationStation);

  if (observation < 0) return "unknown" as const;

  const anchors = anchorRefs(crossing)
    .map((anchor) => ({
      ...anchor,
      index: routeRefIndex(route, anchor.eva),
    }))
    .filter((entry) => entry.index >= 0);

  const previous = [...anchors]
    .filter((entry) => entry.index < observation)
    .sort((a, b) => b.index - a.index)[0];
  const next = [...anchors]
    .filter((entry) => entry.index > observation)
    .sort((a, b) => a.index - b.index)[0];

  const westName = /osnabrück|osnabruck|münster|munster|rheine/i;
  const eastName = /hannover|herford|bielefeld/i;

  const previousStation = previous?.station || "";
  const nextStation = next?.station || "";

  if (previous && westName.test(previousStation)) return "eastbound" as const;
  if (previous && eastName.test(previousStation)) return "westbound" as const;
  if (next && westName.test(nextStation)) return "westbound" as const;
  if (next && eastName.test(nextStation)) return "eastbound" as const;

  // Keep the previous name-based fallback for feeds whose route is still
  // represented by station names rather than StopPointRefs.
  const observationByName = routeIndex(route, observationStation);
  if (observationByName >= 0) {
    const namedAnchors = requiredRouteStops
      .map((stop) => ({ stop, index: routeIndex(route, stop) }))
      .filter((entry) => entry.index >= 0);
    const previousNamed = [...namedAnchors]
      .filter((entry) => entry.index < observationByName)
      .sort((a, b) => b.index - a.index)[0];
    const nextNamed = [...namedAnchors]
      .filter((entry) => entry.index > observationByName)
      .sort((a, b) => a.index - b.index)[0];
    if (previousNamed && westName.test(previousNamed.stop)) return "eastbound" as const;
    if (previousNamed && eastName.test(previousNamed.stop)) return "westbound" as const;
    if (nextNamed && westName.test(nextNamed.stop)) return "westbound" as const;
    if (nextNamed && eastName.test(nextNamed.stop)) return "eastbound" as const;
  }

  return "unknown" as const;
}

function ruleAllowsTrain(rule: any, train: { category?: string; line?: string }) {
  const categories = Array.isArray(rule.categories) ? rule.categories : [];
  if (!categories.length) return true;
  const line = String(train.line || "").toUpperCase();
  const category = String(train.category || "");
  return (
    categories.includes(category) ||
    categories.some((value: string) => line.includes(String(value).toUpperCase()))
  );
}

function parseJson(value: unknown, fallback: any) {
  try {
    return value ? JSON.parse(String(value)) : fallback;
  } catch {
    return fallback;
  }
}

function snapshotCallsContain(calls: any[], station: string, eva?: string) {
  const targetEva = normalizeRef(eva);
  if (targetEva) {
    const byEva = calls.find((call) => normalizeRef(call?.name) === targetEva);
    if (byEva) return byEva;
  }

  const target = normalizeStationName(station);
  return calls.find((call) => {
    const value = normalizeStationName(String(call?.name || ""));
    return value === target || value.includes(target) || target.includes(value);
  });
}

export async function getSnapshotThroughTrains(
  db: Client,
  crossing: Crossing,
): Promise<SnapshotThroughTrain[] | null> {
  try {
    const rules = (crossing.throughRules?.length
      ? crossing.throughRules
      : crossing.observationEvas.map((eva: string) => ({
          observationEva: eva,
          observationStation: eva,
          categories: [],
          trackDistanceMeters: 0,
          fallbackOffsetSeconds: 300,
          direction: "unknown",
        }))) as any[];
    if (!rules.length) return null;

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
      const train = {
        line: String(row.line || ""),
        category: String(row.category || ""),
      };

      for (const rule of rules) {
        if (!ruleAllowsTrain(rule, train)) continue;
        const observationStation = String(rule.observationStation || "");
        if (!matchesRoute(route, calls, rule, crossing)) continue;

        const observationCall = snapshotCallsContain(
          calls,
          observationStation,
          String(rule.observationEva || ""),
        );
        const observationTime =
          observationCall?.actual || observationCall?.planned || row.actual_time;
        const parsedObservation = new Date(observationTime);
        if (!Number.isFinite(parsedObservation.getTime())) continue;

        const expectedDirection = directionForRoute(
          route,
          observationStation,
          crossing.requiredRouteStops || [],
          crossing,
        );
        if (
          rule.direction !== "unknown" &&
          expectedDirection !== "unknown" &&
          rule.direction !== expectedDirection
        ) {
          continue;
        }

        const crossingTime = new Date(
          parsedObservation.getTime() +
            Number(rule.fallbackOffsetSeconds || 300) * 1000,
        );
        if (
          crossingTime.getTime() < now - 60_000 ||
          crossingTime.getTime() > now + 3 * 60 * 60_000
        ) {
          continue;
        }

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
          direction:
            rule.direction === "unknown" ? expectedDirection : rule.direction,
          crossingTime: crossingTime.toISOString(),
          detection: "snapshot-route",
        });
        break;
      }
    }

    const uniqueCandidates = Array.from(
      new Map(
        candidates.map((train) => [
          `${train.line}-${train.category}-${train.journeyNumber}-${train.observationEva}`,
          train,
        ]),
      ).values(),
    );
    return uniqueCandidates.length ? uniqueCandidates : null;
  } catch (error) {
    console.warn("Mobilithek snapshot unavailable", error);
    return null;
  }
}
