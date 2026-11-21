import { db } from "../../../../../lib/db";
import { getStationTimetable } from "../../../../../../../../packages/db-api-client/src/getStationTimetable";
import { getMobilithekTrainRegistry, type MobilithekTrainEvent } from "../../../../../../../../packages/db-api-client/src/mobilithekTimetable";
import { loadCrossingOsmRoute, readCrossingForecastCache, writeCrossingForecastCache } from "../../../../../lib/crossingForecastCache";
import { resolveClosureMergeGapSeconds, shouldMergeClosures } from "../../../../../lib/closureMerge";
function jsonArray(value: unknown): any[] { if (Array.isArray(value)) return value; try { return value ? JSON.parse(String(value)) : []; } catch { return []; } }
const MAX_DIRECT_OBSERVATION_STATIONS = 6;
const MAX_RULE_STATIONS = 8;
const FORECAST_TIMETABLE_HOURS = 1;
const FORECAST_CACHE_TTL_MS = 60_000;
const FORECAST_VERSION = 7;
function normalizeStationName(value: string) { return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\([^)]*\)/g, " ").replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ").replace(/[^a-z0-9]+/g, "").trim(); }
function normalizeLine(value: unknown) { return String(value || "").toUpperCase().replace(/\s+/g, "").replace(/[._-]/g, ""); }
function routeIndex(route: string[], station: string) { const target = normalizeStationName(station); if (!target) return -1; return route.findIndex((stop) => { const value = normalizeStationName(stop); return value === target || value.includes(target) || target.includes(value); }); }
function matchesCorridor(route: string[], observationStation: string, requiredRouteStops: string[]) { if (!route.length) return false; const infrastructureRefs = requiredRouteStops.filter((stop) => /^\d{2,6}$/.test(String(stop).trim())); if (infrastructureRefs.length) return routeIndex(route, observationStation) >= 0; if (requiredRouteStops.length >= 2) { let previous = -1; for (const stop of requiredRouteStops) { const index = routeIndex(route, stop); if (index < 0 || index <= previous) return false; previous = index; } const observation = routeIndex(route, observationStation); if (observation >= 0) { const first = routeIndex(route, requiredRouteStops[0]); const last = routeIndex(route, requiredRouteStops[requiredRouteStops.length - 1]); if (observation < first || observation > last) return false; } return true; } if (requiredRouteStops.length === 1) return routeIndex(route, requiredRouteStops[0]) >= 0; return routeIndex(route, observationStation) >= 0; }
function mobilithekCallForStation(train: MobilithekTrainEvent, station: string) { const target = normalizeStationName(station); return train.calls.find((call) => { const value = normalizeStationName(call.name); return value === target || value.includes(target) || target.includes(value); }); }
function lineMatchesHints(train: MobilithekTrainEvent, lineHints: string[]) { if (!lineHints.length) return true; const line = normalizeLine(train.line); const category = normalizeLine(train.category); return lineHints.some((hint) => { const normalized = normalizeLine(hint); return normalized && (line === normalized || line.includes(normalized) || normalized.includes(line) || category === normalized); }); }
function ruleAllowsTrain(rule: any, train: MobilithekTrainEvent, lineHints: string[]) { if (lineHints.length) return lineMatchesHints(train, lineHints); const categories = Array.isArray(rule.categories) ? rule.categories.map((v: any) => String(v).toUpperCase()) : []; if (!categories.length) return true; return categories.includes(String(train.category || "").toUpperCase()) || categories.some((category: string) => String(train.line || "").toUpperCase().includes(category)); }
function addCandidate(trainsByKey: Map<string, any>, crossing: any, train: MobilithekTrainEvent, rule: any, stationName: string, crossingTime: Date, now: number, source: string) { const etaSeconds = Math.floor((crossingTime.getTime() - now) / 1000); if (etaSeconds <= 0 || etaSeconds > 3 * 60 * 60) return; const key = `${train.category}-${train.journeyNumber}`; const candidate = { id: `${key}-${rule.observationEva || "observation"}`, line: train.line, category: train.category, journeyNumber: train.journeyNumber, origin: train.origin, destination: train.destination, platform: undefined, delayMinutes: train.delayMinutes, observationStation: stationName, observationEva: rule.observationEva, crossingTime: crossingTime.toISOString(), closeAt: new Date(crossingTime.getTime() - Number(crossing.close_offset_seconds || 80) * 1000).toISOString(), openAt: new Date(crossingTime.getTime() + Number(crossing.open_offset_seconds || 20) * 1000).toISOString(), etaSeconds, direction: rule.direction || "unknown", route: train.route, source, detection: "official-route", isThrough: source === "through-rule", throughObservation: stationName }; const existing = trainsByKey.get(key); if (!existing || candidate.etaSeconds < existing.etaSeconds) trainsByKey.set(key, candidate); }
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestStarted = performance.now();
  const { id } = await params;
  const cached = await readCrossingForecastCache<any>(id, FORECAST_CACHE_TTL_MS);
  if (cached?.forecastVersion === FORECAST_VERSION) return Response.json(cached, { headers: { "X-Crossing-Forecast-Cache": "HIT" } });
  const osmRoute = await loadCrossingOsmRoute(id);
  const result = await db.execute({ sql: `SELECT id,name,eva,lat,lon,close_offset_seconds,open_offset_seconds,confidence,status,observation_evas,context_evas,required_route_stops,rules,through_rules,diversion_rules,reroute_watch_rules FROM crossings WHERE id = ? LIMIT 1`, args: [id] });
  const crossing: any = result.rows[0];
  if (!crossing) return Response.json({ error: "Crossing not found" }, { status: 404 });
  const storedRouteStops = jsonArray(crossing.required_route_stops).map((v) => String(v || "").trim()).filter(Boolean);
  const osmRefs = Array.isArray(osmRoute?.railwayRefs) ? osmRoute.railwayRefs.map(String) : [];
  const infrastructureRefs = Array.from(new Set([...storedRouteStops.filter((value) => /^\d{2,6}$/.test(value)), ...osmRefs.filter((value) => /^\d{2,6}$/.test(value))]));
  const storedThroughRules = jsonArray(crossing.through_rules).slice(0, MAX_RULE_STATIONS);
  const storedRules = jsonArray(crossing.rules);
  const explicitLineHints = Array.from(new Set(
    storedRules.flatMap((rule: any) =>
      Array.isArray(rule?.lineHints) ? rule.lineHints.map((value: any) => String(value || "").trim()) : []
    )
  )).filter(Boolean);
  const isInfrastructureForecast = infrastructureRefs.length > 0 || /strecke\s*2530/i.test(String(crossing.name || ""));
  // Only real railway line identifiers may constrain a train registry.
  // Infrastructure IDs and station names are not train lines and must never
  // be used as broad fallbacks (an empty filter previously admitted every train).
  const osmLineHints = Array.isArray(osmRoute?.lineRelations)
    ? osmRoute.lineRelations.flatMap((relation: any) => [relation.ref, relation.name]).map(String).map((value) => value.trim()).filter(Boolean)
    : [];
  const lineHints = Array.from(new Set([...explicitLineHints, ...osmLineHints]));
  const stationLinks = await db.execute({ sql: `SELECT eva,station_name,role,sort_order FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order ASC`, args: [id] }).catch(() => ({ rows: [] as any[] }));
  const stationNameByEva = new Map<string, string>();
  for (const row of stationLinks.rows as any[]) { const eva = String(row.eva || "").trim(); if (eva) stationNameByEva.set(eva, String(row.station_name || eva)); }
  const allObservationEvas = jsonArray(crossing.observation_evas).map((v) => String(v || "").trim()).filter(Boolean);
  if (crossing.eva && !allObservationEvas.includes(String(crossing.eva))) allObservationEvas.unshift(String(crossing.eva));
  const contextEvas = jsonArray(crossing.context_evas).map((v) => String(v || "").trim()).filter(Boolean);
  const observationEvas = allObservationEvas.slice(0, MAX_DIRECT_OBSERVATION_STATIONS);
  const now = Date.now();
  const mergeGapSeconds = resolveClosureMergeGapSeconds(process.env.CROSSING_MERGE_GAP_SECONDS);
  const trainsByKey = new Map<string, any>();
  const stationResults: any[] = [];
  const diagnostics: any = { mode: isInfrastructureForecast ? "infrastructure" : (!crossing.eva && storedThroughRules.length ? "through-rules" : "station-timetable"), registryTotal: 0, registryAfterLineFilter: 0, categories: {}, relevantCategoryCounts: { ICE: 0, IC: 0, EC: 0 }, categorySamples: [], stationChecks: [], registryFetchMs: 0, matchingMs: 0, candidateInsertions: 0, candidateRejectionsOutsideWindow: 0 };
  if (isInfrastructureForecast && lineHints.length === 0) {
    // Fail closed: without a verified OSM/explicit railway line, a registry-wide
    // query would produce unrelated trains and false crossing closures.
    diagnostics.warning = "Keine verkehrende Eisenbahnlinie zugeordnet. OSM-Streckenrelation oder Linienauswahl prüfen.";
    stationResults.push({ role: "infrastructure-observation", ok: false, count: 0, error: diagnostics.warning, lineHints: [] });
  } else if (isInfrastructureForecast) {
    try {
      const registryStarted = performance.now();
      const registry = await getMobilithekTrainRegistry();
      diagnostics.registryFetchMs = Math.round(performance.now() - registryStarted);
      diagnostics.registryTotal = registry.length;
      for (const train of registry) {
        const category = String(train.category || "unknown");
        diagnostics.categories[category] = (diagnostics.categories[category] || 0) + 1;
        for (const wanted of ["ICE", "IC", "EC"]) if (category.toUpperCase() === wanted || String(train.line || "").toUpperCase().includes(wanted)) diagnostics.relevantCategoryCounts[wanted] += 1;
      }
      diagnostics.categorySamples = registry.filter((train) => ["ICE", "IC", "EC"].some((wanted) => String(train.category || "").toUpperCase() === wanted || String(train.line || "").toUpperCase().includes(wanted))).slice(0, 12).map((train) => ({ line: train.line, category: train.category, journeyNumber: train.journeyNumber, route: (train.route || []).slice(0, 30), calls: (train.calls || []).slice(0, 30).map((call) => ({ name: call.name, planned: call.planned?.toISOString() || null, actual: call.actual?.toISOString() || null, stopPointRef: call.stopPointRef || null, stopPlaceRef: call.stopPlaceRef || null })) }));
      const scopedRegistry = registry.filter((train) => lineMatchesHints(train, lineHints));
      diagnostics.registryAfterLineFilter = scopedRegistry.length;
      const fallbackStations = (stationLinks.rows as any[]).map((row) => ({ observationEva: String(row.eva || ""), observationStation: String(row.station_name || row.eva || "") })).filter((rule) => rule.observationStation);
      const configuredRules = storedThroughRules.map((rule: any) => ({ ...rule, observationStation: String(rule.observationStation || stationNameByEva.get(String(rule.observationEva || "")) || "").trim() })).filter((rule: any) => rule.observationStation);
      const rules = configuredRules.length ? configuredRules : fallbackStations;
      for (const rule of rules) {
        const matchingStarted = performance.now();
        let categoryPassed = 0, routeContainsStation = 0, corridorPassed = 0, callWithTime = 0, candidateCountBefore = trainsByKey.size;
        for (const train of scopedRegistry) {
          if (!ruleAllowsTrain(rule, train, lineHints)) continue;
          categoryPassed += 1;
          const route = train.route || [];
          if (routeIndex(route, rule.observationStation) < 0) continue;
          routeContainsStation += 1;
          if (!matchesCorridor(route, rule.observationStation, infrastructureRefs)) continue;
          corridorPassed += 1;
          const call = mobilithekCallForStation(train, rule.observationStation);
          const observationTime = call?.actual || call?.planned;
          if (!observationTime) continue;
          callWithTime += 1;
          const fallbackOffset = Number(rule.fallbackOffsetSeconds || 0);
          const before = trainsByKey.size;
          addCandidate(trainsByKey, crossing, train, rule, rule.observationStation, new Date(observationTime.getTime() + fallbackOffset * 1000), now, "through-rule");
          if (trainsByKey.size > before) diagnostics.candidateInsertions += 1;
          else if ((observationTime.getTime() + fallbackOffset * 1000) <= now || (observationTime.getTime() + fallbackOffset * 1000) > now + 3 * 60 * 60 * 1000) diagnostics.candidateRejectionsOutsideWindow += 1;
        }
        const stationDiagnostic = { eva: String(rule.observationEva || ""), stationName: rule.observationStation, categoryPassed, routeContainsStation, corridorPassed, callWithTime, uniqueCandidatesAdded: trainsByKey.size - candidateCountBefore, matchingMs: Math.round(performance.now() - matchingStarted) };
        diagnostics.stationChecks.push(stationDiagnostic);
        diagnostics.matchingMs += stationDiagnostic.matchingMs;
        stationResults.push({ eva: String(rule.observationEva || ""), stationName: rule.observationStation, role: "infrastructure-observation", ok: true, registryS28: scopedRegistry.length, matched: callWithTime, lineHints });
      }
    } catch (error) { stationResults.push({ role: "infrastructure-observation", ok: false, count: 0, error: error instanceof Error ? error.message : String(error), lineHints }); }
  } else if (!crossing.eva && storedThroughRules.length) {
    try {
      const registryStarted = performance.now();
      const registry = await getMobilithekTrainRegistry();
      diagnostics.registryFetchMs = Math.round(performance.now() - registryStarted);
      diagnostics.registryTotal = registry.length;
      for (const train of registry) {
        const category = String(train.category || "unknown");
        diagnostics.categories[category] = (diagnostics.categories[category] || 0) + 1;
        for (const wanted of ["ICE", "IC", "EC"]) if (category.toUpperCase() === wanted || String(train.line || "").toUpperCase().includes(wanted)) diagnostics.relevantCategoryCounts[wanted] += 1;
      }
      diagnostics.categorySamples = registry.filter((train) => ["ICE", "IC", "EC"].some((wanted) => String(train.category || "").toUpperCase() === wanted || String(train.line || "").toUpperCase().includes(wanted))).slice(0, 12).map((train) => ({ line: train.line, category: train.category, journeyNumber: train.journeyNumber, route: (train.route || []).slice(0, 30), calls: (train.calls || []).slice(0, 30).map((call) => ({ name: call.name, planned: call.planned?.toISOString() || null, actual: call.actual?.toISOString() || null, stopPointRef: call.stopPointRef || null, stopPlaceRef: call.stopPlaceRef || null })) }));
      const scopedRegistry = lineHints.length ? registry.filter((train) => lineMatchesHints(train, lineHints)) : registry;
      diagnostics.registryAfterLineFilter = scopedRegistry.length;
      for (const rule of storedThroughRules) {
        const matchingStarted = performance.now();
        const station = String(rule.observationStation || stationNameByEva.get(String(rule.observationEva || "")) || "").trim(); if (!station) continue;
        let categoryPassed = 0, routeContainsStation = 0, corridorPassed = 0, callWithTime = 0;
        const candidateCountBefore = trainsByKey.size;
        for (const train of scopedRegistry) {
          if (!ruleAllowsTrain(rule, train, lineHints)) continue;
          categoryPassed += 1;
          const route = train.route || [];
          if (routeIndex(route, station) < 0) continue;
          routeContainsStation += 1;
          if (!matchesCorridor(route, station, storedRouteStops)) continue;
          corridorPassed += 1;
          const call = mobilithekCallForStation(train, station);
          const observationTime = call?.actual || call?.planned;
          if (!observationTime) continue;
          callWithTime += 1;
          const predictedTime = observationTime.getTime() + Number(rule.fallbackOffsetSeconds || 0) * 1000;
          const before = trainsByKey.size;
          addCandidate(trainsByKey, crossing, train, rule, station, new Date(predictedTime), now, "through-rule");
          if (trainsByKey.size > before) diagnostics.candidateInsertions += 1;
          else if (predictedTime <= now || predictedTime > now + 3 * 60 * 60 * 1000) diagnostics.candidateRejectionsOutsideWindow += 1;
        }
        const stationDiagnostic = { eva: String(rule.observationEva || ""), stationName: station, categories: Array.isArray(rule.categories) ? rule.categories : [], categoryPassed, routeContainsStation, corridorPassed, callWithTime, uniqueCandidatesAdded: trainsByKey.size - candidateCountBefore, matchingMs: Math.round(performance.now() - matchingStarted) };
        diagnostics.stationChecks.push(stationDiagnostic);
        diagnostics.matchingMs += stationDiagnostic.matchingMs;
        stationResults.push({ eva: String(rule.observationEva || ""), stationName: station, role: "rule", ok: true, count: scopedRegistry.length, lineHints });
      }
    } catch (error) { stationResults.push({ role: "rule", ok: false, count: 0, error: error instanceof Error ? error.message : String(error) }); }
  } else {
    const observationResults = await Promise.all(observationEvas.map(async (eva) => { try { return { eva, events: await getStationTimetable(eva, FORECAST_TIMETABLE_HOURS), error: null as any }; } catch (error) { return { eva, events: [] as any[], error: error instanceof Error ? error.message : String(error) }; } }));
    for (const { eva, events, error } of observationResults) { const stationName = stationNameByEva.get(eva) || eva; if (error) { stationResults.push({ eva, stationName, role: "observation", count: 0, ok: false, error }); continue; } const scopedEvents = lineHints.length ? events.filter((train: any) => lineMatchesHints(train, lineHints)) : events; stationResults.push({ eva, stationName, role: "observation", count: scopedEvents.length, ok: true, lineHints }); for (const train of scopedEvents) { if (train.cancelled || train.actualTime.getTime() <= now - 60000) continue; if (!matchesCorridor(train.route || [], stationName, storedRouteStops)) continue; addCandidate(trainsByKey, crossing, train as any, { observationEva: eva }, stationName, train.actualTime, now, "observation"); } }
  }
  for (const eva of contextEvas.slice(0, 2)) if (!storedThroughRules.some((rule: any) => String(rule.observationEva || "") === eva)) stationResults.push({ eva, stationName: stationNameByEva.get(eva) || eva, role: "context", rule: false, ok: true });
  const trains = [...trainsByKey.values()].filter((train) => train.etaSeconds > 0).sort((a, b) => a.etaSeconds - b.etaSeconds);
  const closures: any[] = [];
  for (const train of trains) { const start = new Date(train.closeAt); const end = new Date(train.openAt); const last = closures[closures.length - 1]; if (!last || !shouldMergeClosures(last.end, start, mergeGapSeconds)) closures.push({ start, end, trains: [train] }); else { if (end.getTime() > last.end.getTime()) last.end = end; last.trains.push(train); } }
  const nextClosure = closures.find((closure) => closure.end.getTime() > now) || null;
  let state = "OPEN"; if (nextClosure && now >= nextClosure.start.getTime() && now < nextClosure.end.getTime()) state = "CLOSED";
  diagnostics.closureMergeGapSeconds = mergeGapSeconds;
  diagnostics.finalUniqueTrains = trains.length;
  diagnostics.finalClosures = closures.length;
  diagnostics.totalMs = Math.round(performance.now() - requestStarted);
  diagnostics.osmRouteLoaded = Boolean(osmRoute);
  diagnostics.osmRouteRailwayRefs = osmRefs.length;
  diagnostics.infrastructureRefs = infrastructureRefs;
  diagnostics.rulesUsed = storedThroughRules.length;
  diagnostics.observationLinks = stationLinks.rows.length;
  const payload = { forecastVersion: FORECAST_VERSION, message: diagnostics.warning || undefined, diagnostics, crossing: { id: String(crossing.id), name: String(crossing.name), lat: Number(crossing.lat), lon: Number(crossing.lon), route: storedRouteStops, lineHints, infrastructureRefs }, state, nextClosure: nextClosure ? { start: nextClosure.start.toISOString(), end: nextClosure.end.toISOString(), closeInSeconds: Math.max(0, Math.floor((nextClosure.start.getTime() - now) / 1000)), openInSeconds: Math.max(0, Math.floor((nextClosure.end.getTime() - now) / 1000)), trains: nextClosure.trains } : null, closures: closures.slice(0, 30).map((closure) => ({ start: closure.start.toISOString(), end: closure.end.toISOString(), durationMinutes: Math.round((closure.end.getTime() - closure.start.getTime()) / 60000), trainCount: closure.trains.length, trains: closure.trains })), trains, stations: stationResults, rules: { requiredRouteStops: storedRouteStops, throughRules: storedThroughRules, diversionRules: jsonArray(crossing.diversion_rules), rerouteWatchRules: jsonArray(crossing.reroute_watch_rules), apiProtection: { maxDirectObservationStations: MAX_DIRECT_OBSERVATION_STATIONS, maxRuleStations: MAX_RULE_STATIONS, timetableHours: FORECAST_TIMETABLE_HOURS, routeOnlyForInfrastructureCrossings: true } } };
  await writeCrossingForecastCache(id, payload);
  return Response.json(payload, { headers: { "X-Crossing-Forecast-Cache": "MISS" } });
}
