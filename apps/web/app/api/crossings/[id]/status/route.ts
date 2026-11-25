import { db } from "../../../../lib/db";
import { getSnapshotPrimaryTrains } from "../../../../../../../packages/db-api-client/src/getSnapshotPrimaryTrains";
import { getSnapshotThroughTrains } from "../../../../../../../packages/db-api-client/src/getSnapshotThroughTrains";
import { getOpenBoardsObservations } from "../../../../../../../packages/db-api-client/src/openBoardsObservations";
import { getOpenBoardsForecastTrains } from "../../../../../../../packages/db-api-client/src/getOpenBoardsForecastTrains";
import { getCrossingDirection } from "../../../../../../../packages/prediction-engine/src/getCrossingDirection";
import { crossings as staticCrossings } from "../../../../../../../packages/crossing-model/src/crossings";
import { readCrossingForecastCache, writeCrossingForecastCache } from "../../../../lib/crossingForecastCache";
import { filterTrainByCrossingOsm } from "../../../../lib/crossingOsmFilter";
import { assignTrainToOsmTrack } from "../../../../../../../packages/crossing-model/src/osmLineMatching";

function jsonArray(value: unknown): any[] { if (Array.isArray(value)) return value; try { const parsed = value ? JSON.parse(String(value)) : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function jsonValue(value: unknown, fallback: any = {}) { if (value && typeof value === "object") return value; try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; } }
function buildCrossingFromDb(row: any, stationRows: any[]): any {
  const linkedObservationEvas = stationRows.filter(s => !s.role || s.role === "observation" || s.role === "automatic" || s.role === "primary").map(s => String(s.eva || "").trim()).filter(Boolean);
  const observationEvas = linkedObservationEvas.length ? Array.from(new Set(linkedObservationEvas)) : jsonArray(row.observation_evas).map(String).filter(Boolean);
  // Primary anchors must be explicit. Observation links are auxiliary timing
  // stations and must never become primary merely because older admin records
  // stored them with role=observation. If no primary was configured, use only
  // the crossing's own station EVA (when available), never every linked station.
  // Only station links explicitly marked "primary" are allowed to create
  // direct OpenBoards train candidates. The legacy reference_stations JSON
  // may contain observation/context EVAs from older configurations; treating
  // that list as primary caused unrelated trains (e.g. Hannover S-Bahn) to
  // appear at this crossing. If no primary link exists, use the crossing EVA.
  const linkedPrimaryEvas = stationRows
    .filter(s => s.role === "primary")
    .map(s => String(s.eva || "").trim())
    .filter(Boolean);
  const referenceStations = Array.from(new Set(
    linkedPrimaryEvas.length
      ? linkedPrimaryEvas
      : row.eva ? [String(row.eva).trim()] : [],
  ));
  if (row.eva && !observationEvas.length) observationEvas.unshift(String(row.eva));
  const linkedContextEvas = stationRows.filter(s => s.role === "context").map(s => String(s.eva || "").trim()).filter(Boolean);
  const stationNameByEva = new Map<string, string>();
  for (const station of stationRows) { const eva = String(station.eva || "").trim(); if (eva) stationNameByEva.set(eva, String(station.station_name || station.name || eva)); }
  const configuredThroughRules = jsonArray(row.through_rules);
  // Station links with role=anchor are additional journey-observation points.
  // They must not become primary candidates, but they must be queried alongside
  // the crossing's primary EVA so journeys observed at these stations can be
  // matched back to the crossing through their ordered route.
  const anchorRules = stationRows
    .filter((station) => station.role === "anchor")
    .map((station) => ({
      observationEva: String(station.eva || "").trim(),
      observationStation: stationNameByEva.get(String(station.eva || "").trim()) || String(station.station_name || station.eva || ""),
      categories: [],
      trackDistanceMeters: Number(station.track_distance_meters || 0),
      fallbackOffsetSeconds: Math.max(30, Number(station.fallback_offset_seconds || 300)),
      direction: station.direction === "eastbound" || station.direction === "westbound" ? station.direction : "unknown",
    }))
    .filter((rule) => rule.observationEva);
  const throughRules = [
    ...configuredThroughRules,
    ...anchorRules.filter((anchor) => !configuredThroughRules.some((rule: any) => String(rule.observationEva || "").trim() === anchor.observationEva)),
  ];
  const sourceRules = throughRules.length ? throughRules : observationEvas.map(eva => ({ observationEva: eva, observationStation: stationNameByEva.get(eva) || eva, categories: [], trackDistanceMeters: 0, fallbackOffsetSeconds: 300, direction: "unknown" }));
  return {
    id: String(row.id), name: String(row.name || row.id), eva: String(row.eva || ""), referenceStations, observationEvas,
    contextEvas: linkedContextEvas.length ? Array.from(new Set(linkedContextEvas)) : jsonArray(row.context_evas).map(String).filter(Boolean),
    requiredRouteStops: jsonArray(row.required_route_stops).map(String).filter(Boolean),
    lat: Number(row.lat), lon: Number(row.lon), closeOffsetSeconds: Number(row.close_offset_seconds || 80), openOffsetSeconds: Number(row.open_offset_seconds || 20),
    rules: jsonValue(row.rules, {}),
    // The legacy Kirchlengern alias still uses the static platform timing rules.
    // Keep them separate: the persisted rules field now stores OSM configuration.
    platformRules: String(row.id) === "kirchlengern-bahnhof-lubbecker-str-b8095d49"
      ? (staticCrossings.find((item) => item.id === "kirchlengern")?.rules as any[] || [])
      : [],
    configUpdatedAt: String(row.updated_at || ""),
    throughRules: sourceRules.map((rule: any) => ({ ...rule, observationEva: String(rule.observationEva || "").trim(), observationStation: String(rule.observationStation || stationNameByEva.get(String(rule.observationEva || "")) || rule.observationEva || ""), categories: Array.isArray(rule.categories) ? rule.categories : [], trackDistanceMeters: Number(rule.trackDistanceMeters || 0), fallbackOffsetSeconds: Number(rule.fallbackOffsetSeconds || 300), direction: rule.direction || "unknown" })).filter((rule: any) => rule.observationEva),
    anchorStations: stationRows.filter((station) => station.role === "anchor").map((station) => ({
      eva: String(station.eva || "").trim(),
      stationName: String(station.station_name || station.eva || ""),
      direction: station.direction === "eastbound" || station.direction === "westbound" ? station.direction : "unknown",
      trackDistanceMeters: Number(station.track_distance_meters || 0),
      fallbackOffsetSeconds: Number(station.fallback_offset_seconds || 0),
    })).filter((station) => station.eva),
    diversionRules: jsonArray(row.diversion_rules), rerouteWatchRules: jsonArray(row.reroute_watch_rules), confidence: Number(row.confidence || 0.5)
  };
}
async function loadCrossing(id: string): Promise<any | null> {
  try {
    const [result, stations] = await Promise.all([
      db.execute({ sql: `SELECT id,name,eva,lat,lon,close_offset_seconds,open_offset_seconds,confidence,status,updated_at,observation_evas,reference_stations,context_evas,required_route_stops,rules,through_rules,diversion_rules,reroute_watch_rules FROM crossings WHERE id = ? LIMIT 1`, args: [id] }),
      db.execute({ sql: `SELECT eva,station_name,role,direction,fallback_offset_seconds,track_distance_meters FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order ASC`, args: [id] })
    ]);
    const row: any = result.rows[0]; return row ? buildCrossingFromDb(row, stations.rows as any[]) : null;
  } catch (error) { console.error("[STATUS] loadCrossing failed:", error); return null; }
}
function explicitLineHintsForCrossing(crossing: any): string[] {
  const rules = crossing.rules;
  const values = Array.isArray(rules)
    ? rules.flatMap((rule: any) => Array.isArray(rule?.lineHints) ? rule.lineHints : [])
    : Array.isArray(rules?.lineHints) ? rules.lineHints : [];
  return Array.from(new Set<string>(values.map((value: unknown) => String(value || "").trim()))).filter(Boolean);
}
function selectedOsmTracksForCrossing(crossing: any): any[] {
  const tracks = crossing.rules && !Array.isArray(crossing.rules) && Array.isArray(crossing.rules.selectedOsmTracks)
    ? crossing.rules.selectedOsmTracks : [];
  return tracks.filter((track: any) => track && track.wayId != null);
}
function selectedOsmWayIdsForCrossing(crossing: any): string[] {
  const tracks = crossing.rules && !Array.isArray(crossing.rules) && Array.isArray(crossing.rules.selectedOsmTracks)
    ? crossing.rules.selectedOsmTracks : [];
  return Array.from(new Set(tracks.map((track: any) => String(track?.wayId ?? "").trim()).filter(Boolean)));
}
function lineHintsForCrossing(crossing: any): string[] {
  const explicit = explicitLineHintsForCrossing(crossing);
  if (explicit.length) return explicit;
  const refs = (crossing.requiredRouteStops || []).map(String);
  return !crossing.eva && (refs.includes("2530") || /strecke\s*2530/i.test(String(crossing.name || ""))) ? ["S28"] : [];
}
function lineMatches(train: any, hints: string[]) { if (!hints.length) return true; const normalize=(v:any)=>String(v||"").toUpperCase().replace(/\s+/g,"").replace(/[._-]/g,""); const line=normalize(train.line),cat=normalize(train.category); return hints.some(h=>{const x=normalize(h);return line===x||line.includes(x)||x.includes(line)||cat===x;}); }
function normalizeTrainKey(value: unknown): string {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// OpenBoards can place its internal journey number into the line label
// (for example "RB 989638" with category "RB" and journeyNumber 989638).
// Keep the DB-style product label in the UI, but only strip an exact match;
// real line designations such as RB71 and RE62 remain unchanged.
function displayLineForTrain(train: any): string {
  const line = String(train?.line || "").trim();
  const category = String(train?.category || "").trim();
  const journeyNumber = String(train?.journeyNumber || "").trim();
  const categoryKey = normalizeTrainKey(category);
  const lineKey = normalizeTrainKey(line);
  const numberKey = normalizeTrainKey(journeyNumber);
  const regionalCategories = new Set(["RB", "RE", "S", "R", "IRE"]);
  if (
    line &&
    categoryKey &&
    numberKey &&
    regionalCategories.has(categoryKey) &&
    lineKey === categoryKey + numberKey
  ) {
    return category;
  }
  return line;
}

async function addStationNames(db: any, trains: any[]) {
  const evas = Array.from(new Set(
    trains.flatMap((train) => [train.destination, train.origin])
      .map((value) => String(value || "").trim())
      .filter((value) => /^\d{7}$/.test(value)),
  ));
  if (!evas.length) return trains;

  try {
    const result = await db.execute({
      sql: `SELECT eva, name FROM railway_station_catalog WHERE eva IN (${evas.map(() => "?").join(",")})`,
      args: evas,
    });
    const names = new Map((result.rows as any[]).map((row) => [
      String(row.eva || "").trim(),
      String(row.name || "").trim(),
    ]));
    return trains.map((train) => {
      const destination = String(train.destination || "").trim();
      const origin = String(train.origin || "").trim();
      const destinationName = names.get(destination) || destination;
      const originName = names.get(origin) || origin;
      return {
        ...train,
        destination: destinationName || train.destination,
        origin: originName || train.origin,
        directionLabel: destinationName && /^\d{7}$/.test(destination)
          ? `Richtung ${destinationName}`
          : train.directionLabel,
      };
    });
  } catch (error) {
    console.warn("[STATUS] station-name lookup failed:", error);
    return trains;
  }
}

function matchOpenBoardsReal(
  candidate: { stationEva: string; line: string; journeyNumber: number; scheduledTime?: string },
  observations: any[],
) {
  const scheduledAt = Date.parse(String(candidate.scheduledTime || ""));
  if (!candidate.stationEva || !candidate.journeyNumber || !candidate.line || !Number.isFinite(scheduledAt)) return null;
  const line = normalizeTrainKey(candidate.line);
  const matches = observations.filter((item) => {
    if (String(item.evaNumber) !== String(candidate.stationEva)) return false;
    if (Number(item.journeyNumber) !== Number(candidate.journeyNumber)) return false;
    if (normalizeTrainKey(item.line) !== line) return false;
    if (item.timeType !== "REAL" && item.timeType !== "PREVIEW") return false;
    const boardScheduled = Date.parse(String(item.scheduledTime || ""));
    const eventAt = Date.parse(String(item.eventTime || ""));
    return Number.isFinite(boardScheduled) && Number.isFinite(eventAt) &&
      Math.abs(boardScheduled - scheduledAt) <= 180_000;
  });
  matches.sort((a, b) => {
    const quality = (item: any) => item.timeType === "REAL" ? 0 : 1;
    if (quality(a) !== quality(b)) return quality(a) - quality(b);
    const deltaA = Math.abs(Date.parse(a.scheduledTime) - scheduledAt);
    const deltaB = Math.abs(Date.parse(b.scheduledTime) - scheduledAt);
    if (deltaA !== deltaB) return deltaA - deltaB;
    return Date.parse(String(b.observedAt || "")) - Date.parse(String(a.observedAt || ""));
  });
  const best = matches[0];
  return best?.timeType === "REAL" ? best : null;
}

function timingCorrectionForCrossing(crossing: any, configuredGlobal?: number, direction?: string): number {
  const envValue = Number(process.env.CROSSING_TIME_CORRECTION_SECONDS ?? 0);
  const globalCorrection = configuredGlobal != null && Number.isFinite(configuredGlobal) ? configuredGlobal : Number.isFinite(envValue) ? envValue : 0;
  const timing = crossing?.rules && !Array.isArray(crossing.rules) ? crossing.rules?.timing : undefined;
  const directional = direction === "eastbound" || direction === "westbound" ? timing?.directionalCrossingTimeCorrectionSeconds?.[direction] : undefined;
  if (directional != null && directional !== "" && Number.isFinite(Number(directional))) return Number(directional);
  const configured = timing?.crossingTimeCorrectionSeconds;
  if (configured == null || configured === "") return globalCorrection;
  const override = Number(configured);
  return Number.isFinite(override) ? override : globalCorrection;
}

function toPayload(crossing: any, trains: any[], lineHints: string[], globalTimingCorrectionSeconds = 0) {
  const now = Date.now();
  // Positive values move the calculated crossing event later; negative values
  // move it earlier. The same correction is applied before deriving both the
  // barrier-close and barrier-open timestamps.
  const platformRules = Array.isArray(crossing.platformRules)
    ? crossing.platformRules
    : Array.isArray(crossing.rules) ? crossing.rules : [];
  const offsetsForTrain = (train: any) => {
    const isStopping = train?.isStoppingTrain === true;
    const matchingRule = isStopping ? platformRules.find((rule: any) =>
      rule?.stopping === true &&
      String(rule?.platform ?? "").trim() !== "" &&
      String(rule.platform).trim() === String(train?.platform ?? "").trim()
    ) : undefined;
    const safeOffset = (value: unknown, fallback: number) =>
      value == null || value === "" || !Number.isFinite(Number(value)) ? fallback : Math.max(0, Number(value));

    // Initial conservative model: through-runs use the configured base clearance;
    // stopping trains get a longer tail-clearance allowance unless an explicit
    // platform rule provides a crossing-specific value. Five seconds are then
    // reserved for the release/safety interval before the barrier may rise.
    // These are operational estimates, not measured train speeds or relay timings.
    const configuredClearance = safeOffset(crossing.openOffsetSeconds, 20);
    const tailClearance = matchingRule
      ? safeOffset(matchingRule.openOffsetSeconds, configuredClearance)
      : isStopping
        ? Math.max(configuredClearance, 30)
        : configuredClearance;
    const releaseBuffer = 5;

    return {
      // Seconds before the train's front reaches the crossing.
      approach: safeOffset(matchingRule?.closeOffsetSeconds, crossing.closeOffsetSeconds),
      tailClearance,
      releaseBuffer,
      clearance: tailClearance + releaseBuffer,
      clearanceModel: matchingRule
        ? "platform-rule"
        : isStopping
          ? "stopping-train-conservative"
          : train?.isStoppingTrain === false
            ? "through-train-base"
            : "unknown-train-base",
    };
  };

  // Each train occupies the crossing from its predicted approach until its tail
  // has cleared. The crossing may reopen immediately after that clearance.
  // Intervals are merged only when the next approach begins before the previous
  // train has cleared; there is no arbitrary extra 30-second hold-down.
  const occupancies = trains.flatMap((train: any) => {
    const rawCrossingAt = Date.parse(String(train.crossingTime || ""));
    if (!Number.isFinite(rawCrossingAt)) return [];
    const timingCorrectionSeconds = timingCorrectionForCrossing(crossing, globalTimingCorrectionSeconds, train.direction);
    const crossingAt = rawCrossingAt + timingCorrectionSeconds * 1000;
    const offsets = offsetsForTrain(train);
    const start = new Date(crossingAt - offsets.approach * 1000);
    const end = new Date(crossingAt + offsets.clearance * 1000);
    if (end.getTime() <= now) return [];
    return [{
      start,
      end,
      crossingAt: new Date(crossingAt),
      trackId: train.osmRailwayWayId == null ? null : String(train.osmRailwayWayId),
      train: {
        ...train,
        predictedCrossingAt: new Date(crossingAt).toISOString(),
        timingCorrectionSeconds,
        predictedBarrierCloseAt: start.toISOString(),
        predictedBarrierOpenAt: end.toISOString(),
        predictedTailClearanceSeconds: offsets.tailClearance,
        predictedReleaseBufferSeconds: offsets.releaseBuffer,
        predictedClearanceSeconds: offsets.clearance,
        clearanceModel: offsets.clearanceModel,
      },
    }];
  }).sort((a, b) => a.start.getTime() - b.start.getTime());

  // Until independent barrier sections are explicitly configured, every
  // selected track at this crossing shares one conservative barrier group.
  // This avoids predicting an unsafe opening between trains on parallel tracks.
  const closures: any[] = [];
  for (const occupancy of occupancies) {
    const last = closures[closures.length - 1];
    if (!last || occupancy.start.getTime() > last.end.getTime()) {
      closures.push({
        start: occupancy.start,
        end: occupancy.end,
        trains: [occupancy.train],
        trackIds: occupancy.trackId ? [occupancy.trackId] : [],
      });
    } else {
      if (occupancy.end.getTime() > last.end.getTime()) last.end = occupancy.end;
      last.trains.push(occupancy.train);
      if (occupancy.trackId && !last.trackIds.includes(occupancy.trackId)) last.trackIds.push(occupancy.trackId);
    }
  }

  // The snapshot source covers up to three hours ahead. Return that same horizon
  // to the UI; otherwise valid trains disappear between the hero and the later list.
  const forecastHorizonMs = 3 * 60 * 60 * 1000;
  const visible = closures.filter((closure) => closure.start.getTime() <= now + forecastHorizonMs);
  const next = closures.find((closure) => closure.end.getTime() > now) || null;
  return {
    crossing: { id: crossing.id, name: crossing.name, lat: crossing.lat, lon: crossing.lon },
    state: next && now >= next.start.getTime() ? "CLOSED" : "OPEN",
    nextCloseIn: next ? Math.max(0, Math.floor((next.start.getTime() - now) / 1000)) : 0,
    nextOpenIn: next ? Math.max(0, Math.floor((next.end.getTime() - now) / 1000)) : 0,
    phase: next ? {
      start: next.start.toISOString(),
      end: next.end.toISOString(),
      durationMinutes: Math.round((next.end.getTime() - next.start.getTime()) / 60000),
      trainCount: next.trains.length,
      trains: next.trains,
    } : null,
    closureCount: visible.length,
    closures: visible.map((closure) => ({
      start: closure.start.toISOString(),
      end: closure.end.toISOString(),
      durationMinutes: Math.round((closure.end.getTime() - closure.start.getTime()) / 60000),
      trainCount: closure.trains.length,
      trains: closure.trains,
    })),
    trainCount: trains.length,
    trains,
    divertedTrains: [],
    lineHints,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id }=await params;
  let crossing = await loadCrossing(id);
  if (!crossing) {
    // Explicit aliases for legacy IDs still stored by older app clients.
    // Do not infer these from EVA: multiple database crossings can share one station.
    const legacyAliases: Record<string, string> = {
      kirchlengern: "kirchlengern-bahnhof-lubbecker-str-b8095d49",
    };
    const legacyCrossing = staticCrossings.find((item) => item.id === id);
    const canonicalId = legacyAliases[id];
    if (canonicalId) {
      crossing = await loadCrossing(canonicalId);
    }
    // Keep the unique-EVA fallback for other legacy crossings without an explicit map.
    if (!crossing && legacyCrossing?.eva) {
      try {
        const matches = await db.execute({
          sql: "SELECT id FROM crossings WHERE eva = ? LIMIT 2",
          args: [String(legacyCrossing.eva)],
        });
        if (matches.rows.length === 1) {
          crossing = await loadCrossing(String((matches.rows[0] as any).id));
        }
      } catch (error) {
        console.warn("[STATUS] legacy crossing alias lookup failed:", error);
      }
    }
    crossing = crossing || legacyCrossing || null;
  }
  if(!crossing)return Response.json({error:"Crossing not found"},{status:404});
  let globalTimingCorrectionSeconds = 0;
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS crossing_timing_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const timingSetting = await db.execute({
      sql: "SELECT setting_value FROM crossing_timing_settings WHERE setting_key = ? LIMIT 1",
      args: ["global_crossing_time_correction_seconds"],
    });
    const storedValue = timingSetting.rows[0]?.setting_value;
    const envValue = Number(process.env.CROSSING_TIME_CORRECTION_SECONDS ?? 0);
    globalTimingCorrectionSeconds = storedValue == null
      ? (Number.isFinite(envValue) ? envValue : 0)
      : Number(storedValue);
    if (!Number.isFinite(globalTimingCorrectionSeconds)) globalTimingCorrectionSeconds = 0;
  } catch (error) {
    console.warn("[STATUS] global timing setting unavailable; using environment default", error);
    const envValue = Number(process.env.CROSSING_TIME_CORRECTION_SECONDS ?? 0);
    globalTimingCorrectionSeconds = Number.isFinite(envValue) ? envValue : 0;
  }
  // Version the forecast cache with the persisted crossing configuration. A saved
  // OSM track/rule edit must never keep serving a forecast computed from old rules.
  // Keep verbose OSM diagnostics in a separate cache entry so normal app requests
  // never pay the response-size or cache-storage cost of per-journey route details.
  const debugMode = new URL(request.url).searchParams.get("debug");
  const includeOsmDetails = debugMode === "osm";
  const includeComparisonDetails = debugMode === "compare";
  const timingCorrectionSeconds = timingCorrectionForCrossing(crossing, globalTimingCorrectionSeconds);
  const timingConfigKey = JSON.stringify(crossing.rules && !Array.isArray(crossing.rules) ? crossing.rules.timing || {} : {});
  const cacheKey=`status:${crossing.id}:${crossing.configUpdatedAt || "unversioned"}:global-${globalTimingCorrectionSeconds}:timing-${timingConfigKey}${includeOsmDetails ? ":osm-debug" : ""}`;
  const cached=includeComparisonDetails ? null : await readCrossingForecastCache<any>(cacheKey,30_000);
  if(cached)return Response.json(cached,{headers:{"X-Crossing-Status-Cache":"HIT"}});
  // Keep a short-lived previous forecast as a safety net when one snapshot poll
  // temporarily loses a journey. Explicit OSM rejections are never resurrected.
  const previousForecast = await readCrossingForecastCache<any>(cacheKey,90_000);
  const lineHints=lineHintsForCrossing(crossing);
  // When a crossing has an explicitly selected physical OSM track, station
  // line hints must not pre-filter its trains. The track topology, not a
  // hand-maintained line allowlist, decides which station journeys pass here.
  const hasSelectedOsmTracks = selectedOsmWayIdsForCrossing(crossing).length > 0;
  // PRIMARY is explicitly declared by reference_stations. Never treat automatically
  // discovered observation_evas as primary; those remain legacy/context data.
  const primaryEvas = Array.from(new Set((crossing.referenceStations || []).map((eva: string) => String(eva).trim()).filter(Boolean)));
  if(!primaryEvas.length) console.warn("[STATUS] no explicit primary reference station",{crossingId:crossing.id});

  // Keep the legacy infrastructure forecast only for the old implicit S28
  // configuration. Explicitly selected lines are handled by the station/snapshot
  // analysis so that adjacent stations remain the primary data source.
  const useLegacyInfrastructureForecast = explicitLineHintsForCrossing(crossing).length === 0 && lineHints.length === 1 && lineHints[0] === "S28";
  if(useLegacyInfrastructureForecast){ try { const { GET: getInfrastructureForecast }=await import("../../../admin/crossings/[id]/forecast/route"); const response=await getInfrastructureForecast(request,{params:Promise.resolve({id})}); if(response.ok){ const forecast:any=await response.json(); const payload={crossing:{id:crossing.id,name:crossing.name,lat:crossing.lat,lon:crossing.lon},state:forecast.state||"OPEN",nextCloseIn:forecast.nextClosure?.closeInSeconds||0,nextOpenIn:forecast.nextClosure?.openInSeconds||0,phase:forecast.nextClosure?{start:forecast.nextClosure.start,end:forecast.nextClosure.end,durationMinutes:Math.round((Date.parse(forecast.nextClosure.end)-Date.parse(forecast.nextClosure.start))/60000),trainCount:forecast.nextClosure.trains?.length||0,trains:forecast.nextClosure.trains||[]}:null,closureCount:Array.isArray(forecast.closures)?forecast.closures.length:0,closures:forecast.closures||[],trainCount:Array.isArray(forecast.trains)?forecast.trains.length:0,trains:forecast.trains||[],divertedTrains:[],lineHints:forecast.crossing?.lineHints||lineHints}; await writeCrossingForecastCache(cacheKey,payload); return Response.json(payload,{headers:{"X-Crossing-Status-Cache":"MISS","X-Crossing-Status-Source":"infrastructure-forecast"}}); } } catch(error){ console.warn("[STATUS] infrastructure forecast failed",error); } }

  // Primary path: use the worker-fed Mobilithek snapshot. This is a single Turso
  // query and does not contact the DB Timetables API or Overpass during page load.
  try {
    const trains:any[]=[];

    // One bounded Mobilithek read feeds both primary-stop and through-route
    // detection. The time index supports newest-first retrieval without sorting
    // the full snapshot table; all candidate matching then happens in memory.
    const snapshotFrom = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const snapshotTo = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    const snapshotResult = await db.execute({
      sql: `SELECT line,category,journey_number,journey_ref,origin,destination,route_json,calls_json,delay_minutes,actual_time,scheduled_time,direction
             FROM mobilithek_train_snapshot
             WHERE actual_time >= ? AND actual_time <= ?
             ORDER BY actual_time DESC
             LIMIT 1500`,
      args: [snapshotFrom, snapshotTo],
    });
    const snapshotRows = snapshotResult.rows as any[];

    // PRIMARY: only explicitly declared reference stations.
    const primarySnapshot=await getSnapshotPrimaryTrains(db,crossing,snapshotRows);
    // SECONDARY: through candidates are derived from the exact same snapshot rows.
    const throughSnapshot=await getSnapshotThroughTrains(db,crossing,snapshotRows);
    const realtimeEvas = Array.from(new Set([
      ...primaryEvas,
      ...(crossing.throughRules || []).map((rule: any) => String(rule.observationEva || "").trim()),
      ...((crossing.rules && !Array.isArray(crossing.rules) && Array.isArray(crossing.rules.observationStations)) ? crossing.rules.observationStations.map((station: any) => String(station.eva || "").trim()) : []),
    ].filter(Boolean)));
    const realtimeObservations = await getOpenBoardsObservations(db, realtimeEvas, {
      from: new Date(Date.now() - 5 * 60_000).toISOString(),
      to: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
      limit: 1000,
    });

    for(const train of primarySnapshot) {
      const realtime = matchOpenBoardsReal({
        stationEva: train.stationEva,
        line: train.line,
        journeyNumber: train.journeyNumber,
        scheduledTime: train.scheduledTime,
      }, realtimeObservations);
      const liveTime = realtime?.eventTime || train.arrival;
      // A primary call at the crossing's own EVA is already the crossing event.
      // Only remote observation stations need a track-travel offset.
      const offsetSeconds = String(train.stationEva) === String(crossing.eva)
        ? 0
        : Math.max(30, Number((crossing.throughRules || []).find((rule: any) => String(rule.observationEva) === train.stationEva)?.fallbackOffsetSeconds || 300));
      const predictedCrossingTime = new Date(Date.parse(liveTime) + offsetSeconds * 1000).toISOString();
      const observationPoints = (train.observationPoints || []).map((point: any) => {
        const pointRealtime = matchOpenBoardsReal({ stationEva: point.eva, line: train.line, journeyNumber: train.journeyNumber, scheduledTime: point.scheduledTime }, realtimeObservations);
        return { ...point, actualTime: pointRealtime?.eventTime || point.actualTime, realtimeSource: pointRealtime ? "DB OpenBoards REAL" : "Mobilithek actual" };
      });
      trains.push({
        id:`primary-${train.stationEva}-${train.category}-${train.journeyNumber}`,
        source:"primary-stop",
        line:train.line,
        category:train.category,
        journeyNumber:train.journeyNumber,
        journeyRef:train.journeyRef,
        origin:train.origin,
        destination:train.destination,
        platform:train.platform,
        isStoppingTrain:true,
        observationStation:train.stationName,
        observationTime:liveTime,
        observationPoints,
        fallbackOffsetSeconds:offsetSeconds,
        direction:getCrossingDirection([]),
        directionLabel:train.destination?`Richtung ${train.destination}`:null,
        delayMinutes:realtime
          ? Math.round((Date.parse(realtime.eventTime) - Date.parse(realtime.scheduledTime || train.scheduledTime)) / 60000)
          : train.delayMinutes,
        realtimeSource:realtime ? "DB OpenBoards REAL" : "Mobilithek",
        realtimeTimeType:realtime?.timeType || null,
        crossingTime:predictedCrossingTime,
        arrival:train.arrival,
        etaSeconds:Math.floor((Date.parse(predictedCrossingTime)-Date.now())/1000)
      });
    }

    // SECONDARY: context stations are evaluated in parallel with the primary
    // station-stop analysis. These candidates represent through-runs.
    for(const train of (throughSnapshot||[]).filter((t:any)=>hasSelectedOsmTracks || lineMatches(t,lineHints))) {
      const realtime = matchOpenBoardsReal({
        stationEva: train.observationEva,
        line: train.line,
        journeyNumber: train.journeyNumber,
        scheduledTime: train.observationScheduledTime,
      }, realtimeObservations);
      const liveObservationTime = realtime?.eventTime || train.observationActualTime;
      const crossingTime=new Date(Date.parse(liveObservationTime) + Number(train.fallbackOffsetSeconds || 300) * 1000);
      trains.push({
        id:`secondary-${train.category}-${train.journeyNumber}-${train.observationEva}`,
        source:"secondary-through",
        line:train.line,
        category:train.category,
        journeyNumber:train.journeyNumber,
        journeyRef:train.journeyRef,
        origin:train.origin,
        destination:train.destination,
        platform:undefined,
        isStoppingTrain:false,
        direction:train.direction||getCrossingDirection(train.route),
        directionLabel:train.direction==="unknown"?"Durchfahrt":`Richtung ${train.direction}`,
        delayMinutes:realtime
          ? Math.round((Date.parse(realtime.eventTime) - Date.parse(realtime.scheduledTime || train.observationScheduledTime)) / 60000)
          : train.delayMinutes,
        realtimeSource:realtime ? "DB OpenBoards REAL" : "Mobilithek",
        realtimeTimeType:realtime?.timeType || null,
        crossingTime:crossingTime.toISOString(),
        arrival:crossingTime.toISOString(),
        observationStation:train.observationStation,
        observationTime:liveObservationTime,
        fallbackOffsetSeconds:Number(train.fallbackOffsetSeconds || 300),
        etaSeconds:Math.floor((crossingTime.getTime()-Date.now())/1000)
      });
    }
    // OpenBoards is now a first-class fallback/source, not only a realtime
    // enrichment layer. It can supply explicit primary-stop rows even when the
    // Mobilithek snapshot is empty. Through-runs require route anchors.
    const openBoardsTrains = getOpenBoardsForecastTrains(crossing, realtimeObservations, hasSelectedOsmTracks ? [] : lineHints);
    const combined = [...trains];
    for (const candidate of openBoardsTrains) {
      const duplicateIndex = combined.findIndex((existing) =>
        Number(existing.journeyNumber) === Number(candidate.journeyNumber) &&
        normalizeTrainKey(existing.line) === normalizeTrainKey(candidate.line) &&
        Math.abs(Date.parse(existing.crossingTime) - Date.parse(candidate.crossingTime)) <= 180_000
      );
      if (duplicateIndex >= 0) {
        // Keep the existing route-rich Mobilithek candidate, but attach the
        // better OpenBoards live timestamp/source metadata.
        combined[duplicateIndex] = {
          ...combined[duplicateIndex],
          crossingTime: candidate.crossingTime,
          realtimeSource: candidate.realtimeSource,
          realtimeTimeType: candidate.realtimeTimeType,
          delayMinutes: candidate.delayMinutes,
        };
      } else {
        combined.push(candidate);
      }
    }
    const unique=Array.from(new Map(combined.map(t=>[
      t.journeyRef || `${t.line}-${t.category}-${t.journeyNumber}-${t.origin || ""}-${t.destination || ""}`,
      t,
    ])).values());
    const enrichedTrains = await addStationNames(db, unique);

    // Evaluate each journey against this crossing's explicitly selected OSM ways.
    // The result is used below as a real assignment decision, not merely telemetry.
    const osmShadowCandidates = Array.from(new Map(
      [
        ...(primarySnapshot || []),
        ...(throughSnapshot || []),
        ...(openBoardsTrains || []),
      ]
        .filter((train: any) => Array.isArray(train.route) && train.route.length >= 2)
        .map((train: any) => [train.journeyRef || `${train.line}-${train.category}-${train.journeyNumber}-${train.origin || ""}-${train.destination || ""}`, train]),
    ).values());
    const selectedOsmWayIds = selectedOsmWayIdsForCrossing(crossing);
    const selectedOsmTracks = selectedOsmTracksForCrossing(crossing);
    const osmShadowResults = await Promise.all(osmShadowCandidates.map(async (train: any) => {
      const journeyKey = train.journeyRef || `${train.line}-${train.category}-${train.journeyNumber}-${train.origin || ""}-${train.destination || ""}`;
      const lineAssignment = assignTrainToOsmTrack({
        line: train.line,
        category: train.category,
        route: train.route,
        selectedTracks: selectedOsmTracks,
      });
      const graphResult = await filterTrainByCrossingOsm(
        crossing.id,
        train.route,
        selectedOsmWayIds.length ? selectedOsmWayIds : undefined,
        train.observationStation || train.stationName || undefined,
      );

      // The prepared OSM line relations are the authoritative assignment
      // between a service and the physical tracks selected for this crossing.
      // The route graph may enrich that assignment with a directed distance,
      // but an incomplete/ambiguous graph must not veto a unique line match.
      const assignedWayId = lineAssignment.wayId == null ? "" : String(lineAssignment.wayId);
      const assignmentIsSelected = Boolean(
        lineAssignment.status === "matched" &&
        assignedWayId &&
        selectedOsmWayIds.includes(assignedWayId),
      );
      const graphConfirmsSameWay = graphResult.status === "matched" &&
        String(graphResult.railwayWayId || "") === assignedWayId;
      const result = assignmentIsSelected && !graphConfirmsSameWay
        ? {
            status: "matched" as const,
            score: 1,
            railwayWayId: assignedWayId,
            reason: "matched-by-osm-line-relation",
            directionLabel: Array.isArray(train.route) && train.route.length
              ? `Richtung ${train.route[train.route.length - 1]}`
              : undefined,
            diagnostics: {
              lineAssignment: {
                relationId: lineAssignment.relationId,
                lineRef: lineAssignment.lineRef,
                direction: lineAssignment.direction,
                reason: lineAssignment.reason,
              },
              graphResult: {
                status: graphResult.status,
                reason: graphResult.reason,
              },
            },
          }
        : graphResult;

      return {
        journeyRef: train.journeyRef || null,
        journeyKey,
        line: train.line,
        category: train.category,
        journeyNumber: train.journeyNumber,
        route: train.route,
        lineAssignment,
        observationStation: train.observationStation || train.stationName || "",
        routeDirection: train.direction || "unknown",
        result,
      };
    }));
    const osmReasonCounts = osmShadowResults.reduce((counts: Record<string, number>, item: any) => {
      const key = item.result.reason || item.result.status;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    console.log("[OSM DIAGNOSTIC]", {
      crossingId: crossing.id,
      selectedWayIds: selectedOsmWayIds,
      snapshotRows: snapshotRows.length,
      primaryCandidates: primarySnapshot.length,
      throughCandidates: (throughSnapshot || []).length,
      openBoardsCandidates: openBoardsTrains.length,
      evaluated: osmShadowResults.length,
      reasonCounts: osmReasonCounts,
      matchedExamples: osmShadowResults
        .filter((item: any) => item.result.status === "matched")
        .slice(0, 5)
        .map((item: any) => ({ line: item.line, category: item.category, journeyNumber: item.journeyNumber, wayId: item.result.railwayWayId })),
      unknownExamples: osmShadowResults
        .filter((item: any) => item.result.status === "unknown")
        .slice(0, 5)
        .map((item: any) => ({ line: item.line, category: item.category, journeyNumber: item.journeyNumber, reason: item.result.reason })),
    });

    // A selected OSM track is a hard physical assignment boundary.
    // A unique line-relation assignment to one of those selected ways is a
    // positive physical-track match. The route graph is an optional enrichment
    // for directed distance; it is not allowed to veto that OSM assignment.
    // Ambiguous or unknown line assignments still require a positive graph match.
    const rejectedJourneyRefs = new Set(osmShadowResults
      .filter((item) => item.journeyKey && item.result.status === "rejected")
      .map((item) => String(item.journeyKey)));
    const assignedJourneyRefs = new Set(osmShadowResults
      .filter((item) => item.journeyKey && item.result.status === "matched")
      .map((item) => String(item.journeyKey)));
    const osmResultByJourney = new Map(osmShadowResults.map((item: any) => [String(item.journeyKey), item.result]));
    const osmFilteredTrains = selectedOsmWayIds.length
      ? enrichedTrains.flatMap((train: any) => {
          const journeyKey = train.journeyRef || `${train.line}-${train.category}-${train.journeyNumber}-${train.origin || ""}-${train.destination || ""}`;
          if (rejectedJourneyRefs.has(journeyKey) || !assignedJourneyRefs.has(journeyKey)) return [];
          const osmResult: any = osmResultByJourney.get(String(journeyKey));
          if (!osmResult || osmResult.status !== "matched") return [];
          // A train is displayed only when its ordered route has a positive
          // physical path through the selected crossing track. Use the same
          // matched route to label the direction, never the stale endpoint field.
          const directionLabel = osmResult.directionLabel || train.directionLabel;
          const osmRailwayWayId = osmResult.railwayWayId == null ? undefined : String(osmResult.railwayWayId);
          // Use the directed OSM rail distance as the travel-time basis.
          // The time anchor is OpenBoards REAL when available, otherwise the
          // actual station event from the Mobilithek snapshot.
          const matchedWayId = Number(osmRailwayWayId || osmResult.railwayWayId);
          const configuredPoints = (Array.isArray(train.observationPoints) ? train.observationPoints : [])
            .filter((point: any) => Array.isArray(point.trackWayIds) && point.trackWayIds.map(Number).includes(matchedWayId) && Number.isFinite(Number(point.distanceMeters)) && Number(point.distanceMeters) > 0);
          const beforePoints = configuredPoints.filter((point: any) => point.side === "before");
          const afterPoints = configuredPoints.filter((point: any) => point.side === "after");
          let measuredCrossingAt: Date | null = null;
          let measuredDirection = "unknown";
          let measuredDiagnostics: any = null;
          for (const before of beforePoints) {
            for (const after of afterPoints) {
              if (before.direction !== "unknown" && after.direction !== "unknown" && before.direction !== after.direction) continue;
              const beforeAt = Date.parse(String(before.actualTime || ""));
              const afterAt = Date.parse(String(after.actualTime || ""));
              const elapsedSeconds = (afterAt - beforeAt) / 1000;
              const distanceBefore = Number(before.distanceMeters);
              const distanceAfter = Number(after.distanceMeters);
              const totalDistance = distanceBefore + distanceAfter;
              const speedKmh = totalDistance / Math.max(1, elapsedSeconds) * 3.6;
              if (!Number.isFinite(beforeAt) || !Number.isFinite(afterAt) || elapsedSeconds <= 0 || elapsedSeconds > 1800 || totalDistance < 500 || totalDistance > 100000 || speedKmh < 10 || speedKmh > 200) continue;
              const crossingAt = new Date(beforeAt + elapsedSeconds * 1000 * (distanceBefore / totalDistance));
              if (crossingAt.getTime() < Date.now() - 60_000 || crossingAt.getTime() > Date.now() + 3 * 60 * 60_000) continue;
              measuredCrossingAt = crossingAt;
              measuredDirection = before.direction !== "unknown" ? before.direction : after.direction || "unknown";
              measuredDiagnostics = {
                beforeEva: before.eva,
                afterEva: after.eva,
                distanceBeforeMeters: distanceBefore,
                distanceAfterMeters: distanceAfter,
                beforeDistanceSource: before.distanceSource || "manual-config",
                afterDistanceSource: after.distanceSource || "manual-config",
                beforeProfileCalculatedAt: before.profileCalculatedAt || null,
                afterProfileCalculatedAt: after.profileCalculatedAt || null,
                elapsedSeconds: Math.round(elapsedSeconds),
                measuredSpeedKmh: Math.round(speedKmh * 10) / 10,
                source: before.realtimeSource === "DB OpenBoards REAL" && after.realtimeSource === "DB OpenBoards REAL" ? "two-openboards-real" : "two-mobilithek-actual",
              };
              break;
            }
            if (measuredCrossingAt) break;
          }
          if (measuredCrossingAt) {
            return [{
              ...train,
              direction: measuredDirection,
              directionLabel,
              osmRailwayWayId,
              crossingTime: measuredCrossingAt.toISOString(),
              arrival: measuredCrossingAt.toISOString(),
              etaSeconds: Math.floor((measuredCrossingAt.getTime() - Date.now()) / 1000),
              crossingTimeModel: "two-station-measured-interpolation",
              crossingTimeDiagnostics: measuredDiagnostics,
            }];
          }
          if (osmResult?.directedDistanceMeters != null && train.observationTime) {
            const observationAt = Date.parse(String(train.observationTime));
            const distanceMeters = Number(osmResult.directedDistanceMeters);
            const category = String(train.category || "").toUpperCase();
            const line = String(train.line || "").toUpperCase();
            const isRegional = /^(RB|RE|R|S)/.test(line) || /REGIONAL|S-BAHN/.test(category);
            const isStopping = train.isStoppingTrain === true;
            // Conservative corridor-average speeds, not a claim about live speed.
            const configuredSpeeds = crossing.rules?.timing?.speedKmh || {};
            const validSpeed = (value: any, fallback: number) => Number.isFinite(Number(value)) && Number(value) >= 10 && Number(value) <= 200 ? Number(value) : fallback;
            const speedKmh = /ICE|IC|EC|INTERCITY/.test(category) ? validSpeed(configuredSpeeds.intercity, 90)
              : /GÜTER|FREIGHT/.test(category) ? validSpeed(configuredSpeeds.freight, 40)
              : isRegional ? (isStopping ? validSpeed(configuredSpeeds.stoppingRegional, 45) : validSpeed(configuredSpeeds.regional, 65))
              : validSpeed(configuredSpeeds.unknown, 50);
            const travelSeconds = Math.max(0, Math.round(Math.abs(distanceMeters) / (speedKmh / 3.6)));
            if (Number.isFinite(observationAt) && Number.isFinite(distanceMeters)) {
              const signedTravelSeconds = Math.sign(distanceMeters) * travelSeconds;
              const crossingAt = new Date(observationAt + signedTravelSeconds * 1000);
              return [{
                ...train,
                direction: osmResult.direction || train.direction || "unknown",
                directionLabel,
                osmRailwayWayId,
                crossingTime: crossingAt.toISOString(),
                arrival: crossingAt.toISOString(),
                etaSeconds: Math.floor((crossingAt.getTime() - Date.now()) / 1000),
                osmDirectedDistanceMeters: distanceMeters,
                osmEstimatedSpeedKmh: speedKmh,
                osmEstimatedTravelSeconds: travelSeconds,
                crossingTimeModel: "osm-distance-estimated-speed",
              }];
            }
          }
          return [{ ...train, directionLabel, osmRailwayWayId }];
        })
      : enrichedTrains;
    const osmShadow = {
      mode: selectedOsmWayIds.length ? "selected-track-filter" : "corridor-diagnostic",
      selectedWayIds: selectedOsmWayIds,
      evaluated: osmShadowResults.length,
      matched: osmShadowResults.filter((item) => item.result.status === "matched").length,
      rejected: osmShadowResults.filter((item) => item.result.status === "rejected").length,
      unknown: osmShadowResults.filter((item) => item.result.status === "unknown").length,
      assignedToSelectedTrack: assignedJourneyRefs.size,
      unassignedExcluded: selectedOsmWayIds.length
        ? osmShadowResults.filter((item) => item.journeyRef && !assignedJourneyRefs.has(String(item.journeyRef))).length
        : 0,
      lineAssignmentSummary: {
        matched: osmShadowResults.filter((item) => item.lineAssignment.status === "matched").length,
        ambiguous: osmShadowResults.filter((item) => item.lineAssignment.status === "ambiguous").length,
        unknown: osmShadowResults.filter((item) => item.lineAssignment.status === "unknown").length,
      },
      anchorStations: includeOsmDetails ? (crossing.anchorStations || []) : undefined,
      results: includeOsmDetails ? osmShadowResults : undefined,
    };

    const journeyKeyForRetention = (train: any) => String(train.journeyRef || `${train.line}-${train.category}-${train.journeyNumber}-${train.origin || ""}-${train.destination || ""}`);
    const currentJourneyKeys = new Set(osmFilteredTrains.map(journeyKeyForRetention));
    const rejectedKeys = new Set(osmShadowResults
      .filter((item: any) => item.journeyKey && item.result.status === "rejected")
      .map((item: any) => String(item.journeyKey)));
    const nowForRetention = Date.now();
    const retainedFromPrevious = (Array.isArray(previousForecast?.trains) ? previousForecast.trains : [])
      .filter((train: any) => {
        const key = journeyKeyForRetention(train);
        const crossingAt = Date.parse(String(train.crossingTime || ""));
        const firstSeenAt = Number(train.forecastObservedAt || nowForRetention);
        return key && !currentJourneyKeys.has(key) && !rejectedKeys.has(key) &&
          Number.isFinite(crossingAt) && crossingAt > nowForRetention &&
          Number.isFinite(firstSeenAt) && nowForRetention - firstSeenAt <= 90_000;
      });
    // Preserve the original observation timestamp so repeated cache refreshes
    // cannot extend a missing journey's grace period indefinitely.
    const forecastTrains = [
      ...osmFilteredTrains.map((train: any) => ({
        ...train,
        forecastObservedAt: Number(train.forecastObservedAt || nowForRetention),
      })),
      ...retainedFromPrevious,
    ];
    const dbDisplayTrains = forecastTrains.map((train: any) => ({
      ...train,
      line: displayLineForTrain(train),
    }));
    const payload=toPayload(crossing,dbDisplayTrains,lineHints,globalTimingCorrectionSeconds);
    (payload as any).forecastDiagnostics = {
      snapshotRows: snapshotRows.length,
      primaryCandidates: primarySnapshot.length,
      throughCandidates: (throughSnapshot || []).length,
      openBoardsObservations: realtimeObservations.length,
      openBoardsCandidates: openBoardsTrains.length,
      enrichedCandidates: enrichedTrains.length,
      osmAcceptedCandidates: osmFilteredTrains.length,
      retainedPreviousCandidates: retainedFromPrevious.length,
      retentionWindowSeconds: 90,
    };
    (payload as any).osmTrackFilter = { selectedWayIds: selectedOsmWayIds, evaluated: osmShadowResults.length, matched: osmShadow.matched, rejected: osmShadow.rejected, unknown: osmShadow.unknown, removedTrainCount: enrichedTrains.length - osmFilteredTrains.length };
    (payload as any).osmShadow = osmShadow;

    // Read-only reconciliation for DB.info comparisons. Reuses the exact
    // OpenBoards rows already fetched for the forecast; no additional Turso
    // query, table, write, or cache entry is created.
    if (includeComparisonDetails) {
      const primaryEvaSet = new Set(primaryEvas.map(String));
      const finalByJourney = new Map(
        forecastTrains.map((train: any) => [String(train.journeyRef || ""), train]),
      );
      const candidateByJourney = new Map(
        openBoardsTrains.map((train: any) => [String(train.journeyRef || ""), train]),
      );
      const primaryDepartures = realtimeObservations
        .filter((observation: any) =>
          primaryEvaSet.has(String(observation.evaNumber)) &&
          observation.direction === "departures" &&
          !observation.cancelled
        )
        .map((observation: any) => {
          const journeyRef = String(observation.journeyId || "");
          const candidate = candidateByJourney.get(journeyRef);
          const forecast = finalByJourney.get(journeyRef);
          const matchingClosure = forecast
            ? (payload as any).closures?.find((closure: any) =>
                closure.trains?.some((train: any) => String(train.journeyRef || "") === journeyRef)
              )
            : null;
          return {
            journeyRef,
            stationEva: String(observation.evaNumber),
            line: String(observation.line || ""),
            category: String(observation.category || ""),
            journeyNumber: Number(observation.journeyNumber || 0),
            destinationEva: observation.destinationEva || null,
            route: Array.isArray(observation.routeNames) ? observation.routeNames : [],
            platform: observation.platform || null,
            scheduledTime: observation.scheduledTime || null,
            eventTime: observation.eventTime || null,
            timeType: observation.timeType || "UNKNOWN",
            status: forecast ? "forecasted" : candidate ? "candidate-not-in-forecast" : "not-a-forecast-candidate",
            forecastCrossingTime: forecast?.crossingTime || null,
            barrierCloseAt: matchingClosure?.start || null,
            barrierOpenAt: matchingClosure?.end || null,
          };
        })
        .sort((a: any, b: any) => Date.parse(String(a.eventTime || "")) - Date.parse(String(b.eventTime || "")));

      (payload as any).dbInfoComparison = {
        mode: "read-only-existing-openboards-rows",
        primaryEvas: [...primaryEvaSet],
        window: {
          from: new Date(Date.now() - 5 * 60_000).toISOString(),
          to: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
        },
        counts: {
          primaryDepartures: primaryDepartures.length,
          forecasted: primaryDepartures.filter((item: any) => item.status === "forecasted").length,
          candidateNotInForecast: primaryDepartures.filter((item: any) => item.status === "candidate-not-in-forecast").length,
          notForecastCandidates: primaryDepartures.filter((item: any) => item.status === "not-a-forecast-candidate").length,
        },
        departures: primaryDepartures,
      };
    }

    if (!includeComparisonDetails) await writeCrossingForecastCache(cacheKey,payload);
    return Response.json(payload,{headers:{"X-Crossing-Status-Cache":"MISS","X-Crossing-Status-Source":openBoardsTrains.length ? "mobilithek+openboards" : "mobilithek-snapshot"}});
  } catch(error) { console.error("[STATUS] snapshot path failed",error); return Response.json({error:"Forecast temporarily unavailable"},{status:503}); }
}