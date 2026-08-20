import type { Crossing, ThroughRuleOsmRoute } from "../../crossing-model/src/types";
import { getStationTimetable } from "./getStationTimetable";
import type { OfficialTrainEvent } from "./parseOfficialTimetable";
import { getMobilithekTrainRegistry, type MobilithekTrainEvent } from "./mobilithekTimetable";

export type ThroughTrain = {
  type: "through"; line: string; category: string; journeyNumber: number;
  destination?: string; origin?: string; route: string[]; delayMinutes: number;
  observationEva: string; observationStation: string; observationActualTime: string;
  fallbackOffsetSeconds: number; trackDistanceMeters: number;
  direction: "eastbound" | "westbound" | "unknown"; crossingTime: string;
  detection: "official-route" | "official-route-time-anchored";
};

function normalizeStationName(value: string) { return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\([^)]*\)/g, " ").replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ").replace(/[^a-z0-9]+/g, "").trim(); }
function routeIndex(route: string[], station: string) { const target = normalizeStationName(station); if (!target) return -1; return route.findIndex((stop) => { const value = normalizeStationName(stop); return value === target || value.includes(target) || target.includes(value); }); }
function matchesOsmCorridor(trainRoute: string[], observationStation: string, requiredRouteStops: string[]) {
  if (!trainRoute.length) return false;
  const anchors = requiredRouteStops.map((stop, order) => ({ stop, order, index: routeIndex(trainRoute, stop) })).filter((entry) => entry.index >= 0);
  if (anchors.length < 2) return false;
  const ordered = [...anchors].sort((a, b) => a.order - b.order);
  for (let i = 1; i < ordered.length; i += 1) if (ordered[i - 1].index >= ordered[i].index) return false;
  const observationIndex = routeIndex(trainRoute, observationStation);
  if (observationIndex >= 0) { const first = ordered[0].index; const last = ordered[ordered.length - 1].index; if (observationIndex < first || observationIndex > last) return false; }
  return true;
}
function matchesSelectedOsmRoute(trainRoute: string[], trainLine: string, route?: ThroughRuleOsmRoute) {
  if (!route) return true;
  const fromIndex = route.from ? routeIndex(trainRoute, route.from) : -1;
  const toIndex = route.to ? routeIndex(trainRoute, route.to) : -1;
  const lineRefs = Array.isArray(route.lineRefs) ? route.lineRefs.map((value) => normalizeStationName(value)).filter(Boolean) : [];
  const lineMatches = lineRefs.length > 0 && lineRefs.some((ref) => normalizeStationName(trainLine) === ref || normalizeStationName(trainLine).includes(ref) || ref.includes(normalizeStationName(trainLine)));
  const hasStationFingerprint = fromIndex >= 0 || toIndex >= 0;
  if (fromIndex >= 0 && toIndex >= 0) return fromIndex < toIndex;
  if (hasStationFingerprint) return lineRefs.length ? lineMatches : true;
  if (lineRefs.length) return lineMatches;
  return true;
}
function trainKey(train: { category: string; journeyNumber: number; id?: string }) { return `${train.category}-${train.journeyNumber}-${train.id || ""}`; }
function directionForRoute(route: string[], observationStation: string, requiredRouteStops: string[]): "eastbound" | "westbound" | "unknown" {
  if (!route.length) return "unknown";
  const observation = routeIndex(route, observationStation);
  const anchors = requiredRouteStops.map((stop) => ({ stop, index: routeIndex(route, stop) })).filter((entry) => entry.index >= 0);
  if (observation < 0) {
    if (anchors.length >= 2) {
      const first = anchors[0].stop; const last = anchors[anchors.length - 1].stop;
      const westName = /osnabrück|osnabruck|münster|munster|rheine/i; const eastName = /hannover|herford|bielefeld/i;
      if (westName.test(first) && eastName.test(last)) return "eastbound";
      if (eastName.test(first) && westName.test(last)) return "westbound";
    }
    return "unknown";
  }
  const previous = [...anchors].filter((entry) => entry.index < observation).sort((a, b) => b.index - a.index)[0];
  const next = [...anchors].filter((entry) => entry.index > observation).sort((a, b) => a.index - b.index)[0];
  const westName = /osnabrück|osnabruck|münster|munster|rheine/i; const eastName = /hannover|herford|bielefeld/i;
  if (previous && westName.test(previous.stop)) return "eastbound";
  if (previous && eastName.test(previous.stop)) return "westbound";
  if (next && westName.test(next.stop)) return "westbound";
  if (next && eastName.test(next.stop)) return "eastbound";
  return "unknown";
}
function interpolateCrossingTime(before: ThroughTrain, after: ThroughTrain): string | null {
  const t1 = Date.parse(before.observationActualTime); const t2 = Date.parse(after.observationActualTime);
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 <= t1) return null;
  const d1 = Math.max(0, Number(before.trackDistanceMeters) || 0); const d2 = Math.max(0, Number(after.trackDistanceMeters) || 0);
  if (!(d1 > 0 && d2 > 0)) return null;
  const ratio = Math.min(0.9, Math.max(0.1, d1 / (d1 + d2)));
  return new Date(t1 + (t2 - t1) * ratio).toISOString();
}
function mobilithekCallForStation(train: MobilithekTrainEvent, station: string) { const target = normalizeStationName(station); return train.calls.find((call) => { const value = normalizeStationName(call.name); return value === target || value.includes(target) || target.includes(value); }); }

function ruleAllowsTrain(rule: any, train: MobilithekTrainEvent) {
  const categories = Array.isArray(rule.categories) ? rule.categories : [];
  const legacyLongDistance = categories.length === 3 && categories.includes("ICE") && categories.includes("IC") && categories.includes("EC");
  if (legacyLongDistance) return true;
  if (!categories.length) return true;
  return categories.includes(train.category) || categories.some((category: string) => train.line.toUpperCase().includes(String(category).toUpperCase()));
}

function buildMobilithekCandidates(events: MobilithekTrainEvent[], crossing: Crossing): ThroughTrain[] {
  const candidates: ThroughTrain[] = [];
  const requiredRouteStops = crossing.requiredRouteStops || [];
  for (const rule of crossing.throughRules || []) {
    for (const train of events) {
      if (!ruleAllowsTrain(rule, train)) continue;
      if (!matchesSelectedOsmRoute(train.route, train.line, rule.osmRoute)) continue;
      if (!matchesOsmCorridor(train.route, rule.observationStation, requiredRouteStops)) continue;
      const observationCall = mobilithekCallForStation(train, rule.observationStation);
      if (!observationCall?.actual) continue;
      const expectedDirection = directionForRoute(train.route, rule.observationStation, requiredRouteStops);
      if (rule.direction !== "unknown" && expectedDirection !== "unknown" && rule.direction !== expectedDirection) continue;
      const crossingTime = new Date(observationCall.actual.getTime() + rule.fallbackOffsetSeconds * 1000);
      if (crossingTime.getTime() < Date.now() - 60_000 || crossingTime.getTime() > Date.now() + 3 * 60 * 60_000) continue;
      candidates.push({ type: "through", line: train.line, category: train.category, journeyNumber: train.journeyNumber, destination: train.destination, origin: train.origin, route: train.route, delayMinutes: train.delayMinutes, observationEva: rule.observationEva, observationStation: rule.observationStation, observationActualTime: observationCall.actual.toISOString(), fallbackOffsetSeconds: rule.fallbackOffsetSeconds, trackDistanceMeters: rule.trackDistanceMeters, direction: rule.direction === "unknown" ? expectedDirection : rule.direction, crossingTime: crossingTime.toISOString(), detection: "official-route" });
    }
  }
  const byTrain = new Map<string, ThroughTrain[]>();
  for (const candidate of candidates) { const key = `${candidate.category}-${candidate.journeyNumber}`; const list = byTrain.get(key) || []; list.push(candidate); byTrain.set(key, list); }
  for (const list of byTrain.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => Date.parse(a.observationActualTime) - Date.parse(b.observationActualTime));
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const interpolated = interpolateCrossingTime(sorted[i], sorted[i + 1]); if (!interpolated) continue;
      for (const candidate of list) { candidate.crossingTime = interpolated; candidate.detection = "official-route-time-anchored"; }
      break;
    }
  }
  return Array.from(new Map(candidates.map((train) => [`${train.category}-${train.journeyNumber}`, train])).values());
}

const THROUGH_TIMETABLE_HOURS = 1;
export async function getThroughTrains(crossing: Crossing): Promise<ThroughTrain[]> {
  if (!crossing.throughRules?.length) return [];
  try { const registry = await getMobilithekTrainRegistry(); return buildMobilithekCandidates(registry, crossing); }
  catch (error) { console.warn("Mobilithek through-train registry unavailable; falling back to DB Timetables API", error); }

  const uniqueEvas = Array.from(new Set(crossing.throughRules.map((rule) => String(rule.observationEva).trim()).filter(Boolean)));
  const timetableByEva = new Map<string, OfficialTrainEvent[]>();
  await Promise.all(uniqueEvas.map(async (eva) => { try { timetableByEva.set(eva, await getStationTimetable(eva, THROUGH_TIMETABLE_HOURS)); } catch (error) { console.error(`getThroughTrains: Timetable für ${eva} fehlgeschlagen`, error); } }));
  const candidates: ThroughTrain[] = [];
  for (const rule of crossing.throughRules) {
    const events = timetableByEva.get(String(rule.observationEva).trim()) || [];
    for (const train of events) {
      if (train.cancelled || !ruleAllowsTrain(rule, train as any)) continue;
      const route = train.route || [];
      if (!matchesSelectedOsmRoute(route, train.line, rule.osmRoute)) continue;
      if (!matchesOsmCorridor(route, rule.observationStation, crossing.requiredRouteStops || [])) continue;
      const expectedDirection = directionForRoute(route, rule.observationStation, crossing.requiredRouteStops || []);
      if (rule.direction !== "unknown" && expectedDirection !== "unknown" && rule.direction !== expectedDirection) continue;
      const crossingTime = new Date(train.actualTime.getTime() + rule.fallbackOffsetSeconds * 1000).toISOString();
      candidates.push({ type: "through", line: train.line, category: train.category, journeyNumber: train.journeyNumber, destination: train.destination, origin: train.origin, route, delayMinutes: train.delayMinutes, observationEva: rule.observationEva, observationStation: rule.observationStation, observationActualTime: train.actualTime.toISOString(), fallbackOffsetSeconds: rule.fallbackOffsetSeconds, trackDistanceMeters: rule.trackDistanceMeters, direction: rule.direction === "unknown" ? expectedDirection : rule.direction, crossingTime, detection: "official-route" });
    }
  }
  const byTrain = new Map<string, ThroughTrain[]>();
  for (const candidate of candidates) { const key = trainKey(candidate); const list = byTrain.get(key) || []; list.push(candidate); byTrain.set(key, list); }
  for (const list of byTrain.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => Date.parse(a.observationActualTime) - Date.parse(b.observationActualTime));
    for (let i = 0; i < sorted.length - 1; i += 1) { const interpolated = interpolateCrossingTime(sorted[i], sorted[i + 1]); if (!interpolated) continue; for (const candidate of list) { candidate.crossingTime = interpolated; candidate.detection = "official-route-time-anchored"; } break; }
  }
  return Array.from(new Map(candidates.map((train) => [`${train.category}-${train.journeyNumber}`, train])).values());
}
