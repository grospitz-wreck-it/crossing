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
  // Prefer explicitly selected primary links. Older admin saves used role=observation
  // for selected primary stations, so retain that fallback only when no primary
  // link exists and the dedicated reference_stations field is empty.
  const storedReferenceStations = jsonArray(row.reference_stations).map((value: any) => String(value).trim()).filter(Boolean);
  const linkedPrimaryEvas = stationRows.filter(s => s.role === "primary").map(s => String(s.eva || "").trim()).filter(Boolean);
  const legacyPrimaryEvas = stationRows.filter(s => s.role === "observation").map(s => String(s.eva || "").trim()).filter(Boolean);
  const referenceStations = storedReferenceStations.length
    ? storedReferenceStations
    : Array.from(new Set(linkedPrimaryEvas.length ? linkedPrimaryEvas : legacyPrimaryEvas));
  if (row.eva && !observationEvas.length) observationEvas.unshift(String(row.eva));
  const linkedContextEvas = stationRows.filter(s => s.role === "context").map(s => String(s.eva || "").trim()).filter(Boolean);
  const stationNameByEva = new Map<string, string>();
  for (const station of stationRows) { const eva = String(station.eva || "").trim(); if (eva) stationNameByEva.set(eva, String(station.station_name || station.name || eva)); }
  const throughRules = jsonArray(row.through_rules);
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
    diversionRules: jsonArray(row.diversion_rules), rerouteWatchRules: jsonArray(row.reroute_watch_rules), confidence: Number(row.confidence || 0.5)
  };
}
async function loadCrossing(id: string): Promise<any | null> {
  try {
    const [result, stations] = await Promise.all([
      db.execute({ sql: `SELECT id,name,eva,lat,lon,close_offset_seconds,open_offset_seconds,confidence,status,updated_at,observation_evas,reference_stations,context_evas,required_route_stops,rules,through_rules,diversion_rules,reroute_watch_rules FROM crossings WHERE id = ? LIMIT 1`, args: [id] }),
      db.execute({ sql: `SELECT eva,station_name,role FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order ASC`, args: [id] })
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

function toPayload(crossing: any, trains: any[], lineHints: string[]) {
  const now = Date.now();
  const platformRules = Array.isArray(crossing.platformRules)
    ? crossing.platformRules
    : Array.isArray(crossing.rules) ? crossing.rules : [];
  const offsetsForTrain = (train: any) => {
    const matchingRule = platformRules.find((rule: any) =>
      rule?.stopping === true &&
      train?.isStoppingTrain === true &&
      String(rule?.platform ?? "").trim() !== "" &&
      String(rule.platform).trim() === String(train?.platform ?? "").trim()
    );
    const safeOffset = (value: unknown, fallback: number) =>
      value == null || value === "" || !Number.isFinite(Number(value)) ? fallback : Math.max(0, Number(value));
    return {
      // Seconds before the train's front reaches the crossing.
      approach: safeOffset(matchingRule?.closeOffsetSeconds, crossing.closeOffsetSeconds),
      // Seconds after the train's front passes until its tail has cleared the danger area.
      clearance: safeOffset(matchingRule?.openOffsetSeconds, crossing.openOffsetSeconds),
    };
  };

  // Each train occupies the crossing from its predicted approach until its tail
  // has cleared. The crossing may reopen immediately after that clearance.
  // Intervals are merged only when the next approach begins before the previous
  // train has cleared; there is no arbitrary extra 30-second hold-down.
  const occupancies = trains.flatMap((train: any) => {
    const crossingAt = Date.parse(String(train.crossingTime || ""));
    if (!Number.isFinite(crossingAt)) return [];
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
        predictedBarrierCloseAt: start.toISOString(),
        predictedBarrierOpenAt: end.toISOString(),
        predictedClearanceSeconds: offsets.clearance,
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
  // Version the forecast cache with the persisted crossing configuration. A saved
  // OSM track/rule edit must never keep serving a forecast computed from old rules.
  // Keep verbose OSM diagnostics in a separate cache entry so normal app requests
  // never pay the response-size or cache-storage cost of per-journey route details.
  const includeOsmDetails = new URL(request.url).searchParams.get("debug") === "osm";
  const cacheKey=`status:${crossing.id}:${crossing.configUpdatedAt || "unversioned"}${includeOsmDetails ? ":osm-debug" : ""}`;
  const cached=await readCrossingForecastCache<any>(cacheKey,30_000);
  if(cached)return Response.json(cached,{headers:{"X-Crossing-Status-Cache":"HIT"}});
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
        observationTime:train.observationActualTime,
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
    const osmShadowResults = await Promise.all(osmShadowCandidates.map(async (train: any) => ({
      journeyRef: train.journeyRef || null,
      journeyKey: train.journeyRef || `${train.line}-${train.category}-${train.journeyNumber}-${train.origin || ""}-${train.destination || ""}`,
      line: train.line,
      category: train.category,
      journeyNumber: train.journeyNumber,
      route: train.route,
      // Independent, conservative line-plan assignment. This is diagnostic only
      // until real-world examples prove that OSM relation membership is unique.
      lineAssignment: assignTrainToOsmTrack({
        line: train.line,
        category: train.category,
        route: train.route,
        selectedTracks: selectedOsmTracks,
      }),
      observationStation: train.observationStation || "",
      result: await filterTrainByCrossingOsm(
        crossing.id,
        train.route,
        selectedOsmWayIds.length ? selectedOsmWayIds : undefined,
        train.observationStation || undefined,
      ),
    })));
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
    // Only a positive route through the selected crossing node on the selected
    // physical way may release a train into the forecast. OSM line relations are
    // useful diagnostics, but they describe a line's planned infrastructure
    // membership and do not prove that this particular journey traverses this
    // crossing. In particular, never promote an unknown graph result to matched
    // merely because a line relation points at one of the selected ways.
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
          // The ordered OSM path determines which side of the observation
          // station the crossing lies on. Keep the configured travel-time
          // magnitude for now, but apply its sign from the actual route topology.
          if (osmResult?.directedDistanceMeters != null && train.observationTime) {
            const observationAt = Date.parse(String(train.observationTime));
            const offsetSeconds = Math.abs(Number(train.fallbackOffsetSeconds || 300));
            if (Number.isFinite(observationAt) && Number.isFinite(offsetSeconds)) {
              const signedOffset = Math.sign(Number(osmResult.directedDistanceMeters)) * offsetSeconds;
              const crossingAt = new Date(observationAt + signedOffset * 1000);
              return [{ ...train, directionLabel, osmRailwayWayId, crossingTime: crossingAt.toISOString(), arrival: crossingAt.toISOString(), etaSeconds: Math.floor((crossingAt.getTime() - Date.now()) / 1000), osmDirectedDistanceMeters: osmResult.directedDistanceMeters }];
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
      results: includeOsmDetails ? osmShadowResults : undefined,
    };

    const payload=toPayload(crossing,osmFilteredTrains,lineHints);
    (payload as any).osmTrackFilter = { selectedWayIds: selectedOsmWayIds, evaluated: osmShadowResults.length, matched: osmShadow.matched, rejected: osmShadow.rejected, unknown: osmShadow.unknown, removedTrainCount: enrichedTrains.length - osmFilteredTrains.length };
    (payload as any).osmShadow = osmShadow;
    await writeCrossingForecastCache(cacheKey,payload);
    return Response.json(payload,{headers:{"X-Crossing-Status-Cache":"MISS","X-Crossing-Status-Source":openBoardsTrains.length ? "mobilithek+openboards" : "mobilithek-snapshot"}});
  } catch(error) { console.error("[STATUS] snapshot path failed",error); return Response.json({error:"Forecast temporarily unavailable"},{status:503}); }
}