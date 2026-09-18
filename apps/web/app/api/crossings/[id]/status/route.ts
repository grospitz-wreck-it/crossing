import { db } from "../../../../lib/db";
import { getStationTimetable } from "../../../../../../../packages/db-api-client/src/getStationTimetable";
import { getSnapshotThroughTrains } from "../../../../../../../packages/db-api-client/src/getSnapshotThroughTrains";
import { getCrossingDirection } from "../../../../../../../packages/prediction-engine/src/getCrossingDirection";
import { crossings as staticCrossings } from "../../../../../../../packages/crossing-model/src/crossings";
import { readCrossingForecastCache, writeCrossingForecastCache } from "../../../../lib/crossingForecastCache";

function jsonArray(value: unknown): any[] { if (Array.isArray(value)) return value; try { return value ? JSON.parse(String(value)) : []; } catch { return []; } }
function buildCrossingFromDb(row: any, stationRows: any[]): any {
  let observationEvas = jsonArray(row.observation_evas).map(String).filter(Boolean);
  if (!observationEvas.length) observationEvas = stationRows.filter(s => !s.role || s.role === "observation" || s.role === "automatic").map(s => String(s.eva || "").trim()).filter(Boolean);
  if (row.eva && !observationEvas.includes(String(row.eva))) observationEvas.unshift(String(row.eva));
  const stationNameByEva = new Map<string, string>();
  for (const station of stationRows) { const eva = String(station.eva || "").trim(); if (eva) stationNameByEva.set(eva, String(station.station_name || station.name || eva)); }
  const throughRules = jsonArray(row.through_rules);
  const sourceRules = throughRules.length ? throughRules : observationEvas.map(eva => ({ observationEva: eva, observationStation: stationNameByEva.get(eva) || eva, categories: [], trackDistanceMeters: 0, fallbackOffsetSeconds: 300, direction: "unknown" }));
  return {
    id: String(row.id), name: String(row.name || row.id), eva: String(row.eva || ""), observationEvas,
    contextEvas: jsonArray(row.context_evas).map(String).filter(Boolean),
    requiredRouteStops: jsonArray(row.required_route_stops).map(String).filter(Boolean),
    lat: Number(row.lat), lon: Number(row.lon), closeOffsetSeconds: Number(row.close_offset_seconds || 80), openOffsetSeconds: Number(row.open_offset_seconds || 20),
    rules: jsonArray(row.rules),
    throughRules: sourceRules.map((rule: any) => ({ ...rule, observationEva: String(rule.observationEva || "").trim(), observationStation: String(rule.observationStation || stationNameByEva.get(String(rule.observationEva || "")) || rule.observationEva || ""), categories: Array.isArray(rule.categories) ? rule.categories : [], trackDistanceMeters: Number(rule.trackDistanceMeters || 0), fallbackOffsetSeconds: Number(rule.fallbackOffsetSeconds || 300), direction: rule.direction || "unknown" })).filter((rule: any) => rule.observationEva),
    diversionRules: jsonArray(row.diversion_rules), rerouteWatchRules: jsonArray(row.reroute_watch_rules), confidence: Number(row.confidence || 0.5)
  };
}
async function loadCrossing(id: string): Promise<any | null> {
  try {
    const [result, stations] = await Promise.all([
      db.execute({ sql: `SELECT id,name,eva,lat,lon,close_offset_seconds,open_offset_seconds,confidence,status,observation_evas,context_evas,required_route_stops,rules,through_rules,diversion_rules,reroute_watch_rules FROM crossings WHERE id = ? LIMIT 1`, args: [id] }),
      db.execute({ sql: `SELECT eva,station_name,role FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order ASC`, args: [id] })
    ]);
    const row: any = result.rows[0]; return row ? buildCrossingFromDb(row, stations.rows as any[]) : null;
  } catch (error) { console.error("[STATUS] loadCrossing failed:", error); return null; }
}
function explicitLineHintsForCrossing(crossing: any): string[] {
  return Array.from(new Set(
    jsonArray(crossing.rules).flatMap((rule: any) =>
      Array.isArray(rule?.lineHints) ? rule.lineHints.map((value: any) => String(value || "").trim()) : []
    )
  )).filter(Boolean);
}
function lineHintsForCrossing(crossing: any): string[] {
  const explicit = explicitLineHintsForCrossing(crossing);
  if (explicit.length) return explicit;
  const refs = (crossing.requiredRouteStops || []).map(String);
  return !crossing.eva && (refs.includes("2530") || /strecke\s*2530/i.test(String(crossing.name || ""))) ? ["S28"] : [];
}
function lineMatches(train: any, hints: string[]) { if (!hints.length) return true; const normalize=(v:any)=>String(v||"").toUpperCase().replace(/\s+/g,"").replace(/[._-]/g,""); const line=normalize(train.line),cat=normalize(train.category); return hints.some(h=>{const x=normalize(h);return line===x||line.includes(x)||x.includes(line)||cat===x;}); }
function toPayload(crossing: any, trains: any[], lineHints: string[]) {
  const now=Date.now(); trains.sort((a,b)=>Date.parse(a.crossingTime)-Date.parse(b.crossingTime));
  const closures:any[]=[];
  for(const train of trains.filter(t=>Date.parse(t.crossingTime)>now)) { const t=Date.parse(train.crossingTime); const start=new Date(t-crossing.closeOffsetSeconds*1000),end=new Date(t+crossing.openOffsetSeconds*1000); const last=closures[closures.length-1]; if(!last||start.getTime()>last.end.getTime()+30000)closures.push({start,end,trains:[train]});else{if(end>last.end)last.end=end;last.trains.push(train);} }
  const visible=closures.filter(c=>c.start.getTime()<=now+30*60*1000); const next=closures.find(c=>c.end.getTime()>now)||null;
  return { crossing:{id:crossing.id,name:crossing.name,lat:crossing.lat,lon:crossing.lon}, state:next&&now>=next.start.getTime()?"CLOSED":"OPEN", nextCloseIn:next?Math.max(0,Math.floor((next.start.getTime()-now)/1000)):0, nextOpenIn:next?Math.max(0,Math.floor((next.end.getTime()-now)/1000)):0, phase:next?{start:next.start.toISOString(),end:next.end.toISOString(),durationMinutes:Math.round((next.end.getTime()-next.start.getTime())/60000),trainCount:next.trains.length,trains:next.trains}:null, closureCount:visible.length, closures:visible.map(c=>({start:c.start.toISOString(),end:c.end.toISOString(),durationMinutes:Math.round((c.end.getTime()-c.start.getTime())/60000),trainCount:c.trains.length,trains:c.trains})), trainCount:trains.length,trains,divertedTrains:[],lineHints };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id }=await params; const cacheKey=`status:${id}`; const cached=await readCrossingForecastCache<any>(cacheKey,30_000);
  if(cached)return Response.json(cached,{headers:{"X-Crossing-Status-Cache":"HIT"}});
  const crossing=(await loadCrossing(id))||staticCrossings.find(c=>c.id===id);
  if(!crossing)return Response.json({error:"Crossing not found"},{status:404});
  const lineHints=lineHintsForCrossing(crossing);

  // Keep the legacy infrastructure forecast only for the old implicit S28
  // configuration. Explicitly selected lines are handled by the station/snapshot
  // analysis so that adjacent stations remain the primary data source.
  const useLegacyInfrastructureForecast = explicitLineHintsForCrossing(crossing).length === 0 && lineHints.length === 1 && lineHints[0] === "S28";
  if(useLegacyInfrastructureForecast){ try { const { GET: getInfrastructureForecast }=await import("../../../admin/crossings/[id]/forecast/route"); const response=await getInfrastructureForecast(_request,{params:Promise.resolve({id})}); if(response.ok){ const forecast:any=await response.json(); const payload={crossing:{id:crossing.id,name:crossing.name,lat:crossing.lat,lon:crossing.lon},state:forecast.state||"OPEN",nextCloseIn:forecast.nextClosure?.closeInSeconds||0,nextOpenIn:forecast.nextClosure?.openInSeconds||0,phase:forecast.nextClosure?{start:forecast.nextClosure.start,end:forecast.nextClosure.end,durationMinutes:Math.round((Date.parse(forecast.nextClosure.end)-Date.parse(forecast.nextClosure.start))/60000),trainCount:forecast.nextClosure.trains?.length||0,trains:forecast.nextClosure.trains||[]}:null,closureCount:Array.isArray(forecast.closures)?forecast.closures.length:0,closures:forecast.closures||[],trainCount:Array.isArray(forecast.trains)?forecast.trains.length:0,trains:forecast.trains||[],divertedTrains:[],lineHints:forecast.crossing?.lineHints||lineHints}; await writeCrossingForecastCache(cacheKey,payload); return Response.json(payload,{headers:{"X-Crossing-Status-Cache":"MISS","X-Crossing-Status-Source":"infrastructure-forecast"}}); } } catch(error){ console.warn("[STATUS] infrastructure forecast failed",error); } }

  // Primary path: use the worker-fed Mobilithek snapshot. This is a single Turso
  // query and does not contact the DB Timetables API or Overpass during page load.
  try {
    const snapshot=await getSnapshotThroughTrains(db,crossing);
    const trains:any[]=[];
    for(const train of (snapshot||[]).filter((t:any)=>lineMatches(t,lineHints))) {
      const crossingTime=new Date(train.crossingTime);
      trains.push({id:`${train.category}-${train.journeyNumber}-${train.observationEva}`,line:train.line,category:train.category,journeyNumber:train.journeyNumber,origin:train.origin,destination:train.destination,platform:undefined,isStoppingTrain:false,direction:train.direction||getCrossingDirection(train.route),directionLabel:train.direction==="unknown"?"Durchfahrt":`Richtung ${train.direction}`,delayMinutes:train.delayMinutes,crossingTime:crossingTime.toISOString(),arrival:crossingTime.toISOString(),etaSeconds:Math.floor((crossingTime.getTime()-Date.now())/1000)});
    }
    // For a crossing with a concrete EVA we make only one direct station call.
    // Observation-only crossings stay fully snapshot-backed for the fast test path.
    if(crossing.eva && process.env.DB_CLIENT_ID && process.env.DB_API_KEY) {
      const direct=await getStationTimetable(crossing.eva,1).catch(()=>[]);
      for(const train of direct.filter((t:any)=>!t.cancelled && lineMatches(t,lineHints))) { const crossingTime=train.actualTime; if(crossingTime.getTime()<Date.now()-60_000||crossingTime.getTime()>Date.now()+3*60*60_000)continue; trains.push({id:`direct-${train.category}-${train.journeyNumber}`,line:train.line,category:train.category,journeyNumber:train.journeyNumber,origin:train.origin,destination:train.destination,platform:train.platform,isStoppingTrain:true,direction:getCrossingDirection(train.route||[]),directionLabel:train.destination?`Richtung ${train.destination}`:null,delayMinutes:train.delayMinutes,crossingTime:crossingTime.toISOString(),arrival:crossingTime.toISOString(),etaSeconds:Math.floor((crossingTime.getTime()-Date.now())/1000)}); }
    }
    const unique=Array.from(new Map(trains.map(t=>[`${t.line}-${t.category}-${t.journeyNumber}`,t])).values()); const payload=toPayload(crossing,unique,lineHints); await writeCrossingForecastCache(cacheKey,payload); return Response.json(payload,{headers:{"X-Crossing-Status-Cache":"MISS","X-Crossing-Status-Source":"mobilithek-snapshot"}});
  } catch(error) { console.error("[STATUS] snapshot path failed",error); return Response.json({error:"Forecast temporarily unavailable"},{status:503}); }
}
