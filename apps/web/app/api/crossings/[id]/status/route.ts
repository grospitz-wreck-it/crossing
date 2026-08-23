import { db } from "../../../../lib/db";
import { getStationTimetable } from "../../../../../../../packages/db-api-client/src/getStationTimetable";
import { getThroughTrains } from "../../../../../../../packages/db-api-client/src/getThroughTrains";
import { getDivertedTrains } from "../../../../../../../packages/db-api-client/src/getDivertedTrains";
import { getReroutedTrains } from "../../../../../../../packages/db-api-client/src/getReroutedTrains";
import { getCrossingDirection } from "../../../../../../../packages/prediction-engine/src/getCrossingDirection";
import { crossings as staticCrossings } from "../../../../../../../packages/crossing-model/src/crossings";
import { withMemoryCache } from "../../../../../../../packages/db-api-client/src/memoryCache";
import { filterTrainByCrossingOsm } from "../../../../lib/crossingOsmFilter";
import { isTrainRouteNearCrossing } from "../../../../lib/crossingRouteProximity";
import { readCrossingForecastCache, writeCrossingForecastCache } from "../../../../lib/crossingForecastCache";

function jsonArray(value: unknown): any[] { if (Array.isArray(value)) return value; try { return value ? JSON.parse(String(value)) : []; } catch { return []; } }
function normalizeLine(value: unknown) { return String(value || "").toUpperCase().replace(/\s+/g, "").replace(/[._-]/g, ""); }
function lineMatchesHints(train:any,lineHints:string[]){if(!lineHints.length)return true;const line=normalizeLine(train?.line),category=normalizeLine(train?.category);return lineHints.some((hint)=>{const h=normalizeLine(hint);return h&&(line===h||line.includes(h)||h.includes(line)||category===h);});}
function buildCrossingFromDb(row: any, stationRows: any[]): any {
  let observationEvas = jsonArray(row.observation_evas).map(String).filter(Boolean);
  if (!observationEvas.length) observationEvas = stationRows.filter(station => !station.role || station.role === "observation" || station.role === "automatic").map(station => String(station.eva || "").trim()).filter(Boolean);
  if (row.eva && !observationEvas.includes(String(row.eva))) observationEvas.unshift(String(row.eva));
  const contextEvas = jsonArray(row.context_evas).map(String).filter(Boolean);
  const requiredRouteStops = jsonArray(row.required_route_stops).map(String).filter(Boolean);
  const throughRules = jsonArray(row.through_rules);
  const diversionRules = jsonArray(row.diversion_rules);
  const rerouteWatchRules = jsonArray(row.reroute_watch_rules);
  const stationNameByEva = new Map<string,string>();
  for (const station of stationRows) { const eva=String(station.eva||"").trim(); if(eva) stationNameByEva.set(eva,String(station.station_name||station.name||eva)); }
  const sourceRules = throughRules.length ? throughRules : observationEvas.map((eva) => ({ observationEva: eva, observationStation: stationNameByEva.get(eva) || eva, categories: [], trackDistanceMeters: 0, fallbackOffsetSeconds: 300, direction: "unknown" }));
  const normalizedThroughRules = sourceRules.map((rule:any)=>({ ...rule, observationEva:String(rule.observationEva||"").trim(), observationStation:String(rule.observationStation||stationNameByEva.get(String(rule.observationEva||""))||rule.observationEva||""), categories:Array.isArray(rule.categories)?rule.categories:[], trackDistanceMeters:Number(rule.trackDistanceMeters||0), fallbackOffsetSeconds:Number(rule.fallbackOffsetSeconds||300), direction:rule.direction||"unknown" })).filter((rule:any)=>rule.observationEva);
  return { id:String(row.id), name:String(row.name||row.id), eva:String(row.eva||""), observationEvas, contextEvas, requiredRouteStops, lat:Number(row.lat), lon:Number(row.lon), closeOffsetSeconds:Number(row.close_offset_seconds||80), openOffsetSeconds:Number(row.open_offset_seconds||20), rules:[], throughRules:normalizedThroughRules, diversionRules, rerouteWatchRules, confidence:Number(row.confidence||0.5) };
}
async function loadCrossing(id:string):Promise<any|null>{try{const result=await db.execute({sql:`SELECT id,name,eva,lat,lon,close_offset_seconds,open_offset_seconds,confidence,status,observation_evas,context_evas,required_route_stops,through_rules,diversion_rules,reroute_watch_rules FROM crossings WHERE id = ? LIMIT 1`,args:[id]});const row:any=result.rows[0];if(!row)return null;let stationRows:any[]=[];try{const stations=await db.execute({sql:`SELECT eva,station_name,role FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order ASC`,args:[id]});stationRows=stations.rows as any[];}catch{}return buildCrossingFromDb(row,stationRows);}catch(error){console.error("Failed to load crossing from DB:",error);return null;}}
function isDirectObservationTrain(train:any):boolean{return train?.source==="observation"||train?.detection==="station-observation";}
async function allowTrainForCrossing(crossingId:string,crossing:any,train:any):Promise<boolean>{if(isDirectObservationTrain(train))return true;const route=Array.isArray(train?.route)?train.route.map(String).filter(Boolean):[];if(route.length>=2&&!await isTrainRouteNearCrossing(crossing,route)){console.info("Route geographically unrelated to crossing",{crossingId,journeyNumber:train.journeyNumber,line:train.line});return false;}if(!route.length)return true;const result=await filterTrainByCrossingOsm(crossingId,route);if(result.status==="rejected"){console.info("OSM rejected train for crossing",{crossingId,journeyNumber:train.journeyNumber,line:train.line,score:result.score,railwayWayId:result.railwayWayId,ref:result.ref});return false;}return true;}
const STATUS_TIMETABLE_HOURS=1;
const STATUS_CACHE_TTL_MS=30_000;

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const{id}=await params;
  const cacheKey=`status:${id}`;
  const cached=await readCrossingForecastCache<any>(cacheKey,STATUS_CACHE_TTL_MS);
  if(cached)return Response.json(cached,{headers:{"X-Crossing-Status-Cache":"HIT"}});
  const crossing=(await loadCrossing(id))||staticCrossings.find(c=>c.id===id);if(!crossing)return Response.json({error:"Crossing not found"},{status:404});
  const lineHints=!crossing.eva&&((crossing.requiredRouteStops||[]).includes("2530")||String(crossing.name||"").includes("2530"))?["S28"]:[];

  // Infrastructure crossings have no EVA and must use the same forecast pipeline
  // as the admin view. This avoids a second, independent timetable calculation
  // (which previously returned unrelated station data and could briefly show
  // the last selected crossing's status in the app).
  if(lineHints.length){
    const { GET: getInfrastructureForecast } = await import("../../admin/crossings/[id]/forecast/route");
    const forecastResponse = await getInfrastructureForecast(request,{params:Promise.resolve({id})});
    if(forecastResponse.ok){
      const forecast:any = await forecastResponse.json();
      const next = forecast.nextClosure;
      const now = Date.now();
      const closures = Array.isArray(forecast.closures) ? forecast.closures : [];
      const nextStart = next?.start ? new Date(next.start).getTime() : 0;
      const nextEnd = next?.end ? new Date(next.end).getTime() : 0;
      const payload = {
        crossing: { id: crossing.id, name: crossing.name, lat: crossing.lat, lon: crossing.lon },
        state: forecast.state || "OPEN",
        nextCloseIn: next?.closeInSeconds ?? (nextStart > now ? Math.floor((nextStart-now)/1000) : 0),
        nextOpenIn: next?.openInSeconds ?? (nextEnd > now ? Math.floor((nextEnd-now)/1000) : 0),
        phase: next ? { start: next.start, end: next.end, durationMinutes: Math.round((nextEnd-nextStart)/60000), trainCount: Array.isArray(next.trains)?next.trains.length:0, trains: next.trains || [] } : null,
        closureCount: closures.length,
        closures,
        trainCount: Array.isArray(forecast.trains)?forecast.trains.length:0,
        trains: forecast.trains || [],
        divertedTrains: [],
        lineHints: forecast.crossing?.lineHints || lineHints,
      };
      await writeCrossingForecastCache(cacheKey,payload);
      return Response.json(payload,{headers:{"X-Crossing-Status-Cache":"MISS","X-Crossing-Status-Source":"infrastructure-forecast"}});
    }
  }

  const localEventsPromise=crossing.eva?getStationTimetable(crossing.eva,STATUS_TIMETABLE_HOURS).catch(()=>[]):Promise.resolve([]);
  const observationEventsPromise=!crossing.eva&&crossing.observationEvas?.length?Promise.all(crossing.observationEvas.map((eva:string)=>getStationTimetable(eva,STATUS_TIMETABLE_HOURS).catch(()=>[]))).then(sets=>sets.flat()):Promise.resolve([]);
  const throughPromise=withMemoryCache(`through-${crossing.id}`,5000,()=>getThroughTrains(crossing)).catch(()=>[]);
  const divertedPromise=withMemoryCache(`diverted-${crossing.id}`,5000,()=>getDivertedTrains(crossing)).catch(()=>[]);
  const reroutedPromise=withMemoryCache(`rerouted-${crossing.id}`,5000,()=>getReroutedTrains(crossing)).catch(()=>[]);
  const[localEvents,observationEvents,throughTrains,divertedTrains,reroutedTrains]=await Promise.all([localEventsPromise,observationEventsPromise,throughPromise,divertedPromise,reroutedPromise]);
  const trains:any[]=[];
  const directEvents=(crossing.eva?localEvents:observationEvents.map((train:any)=>({...train,source:"observation",detection:"station-observation"}))).filter((train:any)=>!train.cancelled&&lineMatchesHints(train,lineHints));
  const eligibleDirect=await Promise.all(directEvents.map(async(train:any)=>({train,allowed:await allowTrainForCrossing(crossing.id,crossing,train)})));
  for(const{train,allowed}of eligibleDirect){if(!allowed)continue;const isStoppingTrain=train.platform==="1"||train.platform==="2";const crossingTime=train.actualTime;const etaSeconds=Math.floor((crossingTime.getTime()-Date.now())/1000);if(!crossing.eva&&crossingTime.getTime()<=Date.now()-60000)continue;trains.push({id:`${train.category}-${train.journeyNumber}-${train.id}`,line:train.line,category:train.category,journeyNumber:train.journeyNumber,origin:train.origin,destination:train.destination,platform:train.platform,isStoppingTrain,direction:getCrossingDirection(train.route),directionLabel:train.destination?`Richtung ${train.destination}`:null,delayMinutes:train.delayMinutes,crossingTime:crossingTime.toISOString(),arrival:crossingTime.toISOString(),etaSeconds,...(!crossing.eva?{estimatedFrom:{observationEva:train.observationEva}}:{})});}
  const existingKeys=new Set(trains.map(t=>`${t.category}-${t.journeyNumber}`));
  const eligibleThrough=await Promise.all(throughTrains.filter((train:any)=>lineMatchesHints(train,lineHints)).map(async(train:any)=>({train,allowed:await allowTrainForCrossing(crossing.id,crossing,train)})));
  for(const{train,allowed}of eligibleThrough){if(!allowed)continue;const key=`${train.category}-${train.journeyNumber}`;if(existingKeys.has(key))continue;existingKeys.add(key);const crossingTime=new Date(train.crossingTime);trains.push({id:`${train.category}-${train.journeyNumber}`,line:train.line,category:train.category,journeyNumber:train.journeyNumber,origin:train.origin,destination:train.destination,platform:train.direction==="westbound"?"1":train.direction==="eastbound"?"2":undefined,isStoppingTrain:false,direction:train.direction,directionLabel:"Durchfahrt",delayMinutes:train.delayMinutes,crossingTime:crossingTime.toISOString(),arrival:crossingTime.toISOString(),etaSeconds:Math.floor((crossingTime.getTime()-Date.now())/1000),estimatedFrom:{observationStation:train.observationStation,observationActualTime:train.observationActualTime,fallbackOffsetSeconds:train.fallbackOffsetSeconds}});}
  const eligibleRerouted=await Promise.all(reroutedTrains.filter((train:any)=>lineMatchesHints(train,lineHints)).map(async(train:any)=>({train,allowed:await allowTrainForCrossing(crossing.id,crossing,train)})));
  for(const{train,allowed}of eligibleRerouted){if(!allowed)continue;const key=`${train.category}-${train.journeyNumber}`;if(existingKeys.has(key))continue;existingKeys.add(key);const crossingTime=new Date(train.crossingTime);trains.push({id:`${train.category}-${train.journeyNumber}-rerouted`,line:train.line,category:train.category,journeyNumber:train.journeyNumber,origin:train.origin,destination:train.destination,platform:undefined,isStoppingTrain:false,direction:train.direction,directionLabel:"Umleitung",delayMinutes:train.delayMinutes,crossingTime:crossingTime.toISOString(),arrival:crossingTime.toISOString(),etaSeconds:Math.floor((crossingTime.getTime()-Date.now())/1000),estimatedFrom:{observationStation:train.observationStation,observationActualTime:train.observationActualTime,fallbackOffsetSeconds:train.fallbackOffsetSeconds},rerouted:true,note:train.note});}
  trains.sort((a,b)=>new Date(a.crossingTime).getTime()-new Date(b.crossingTime).getTime());const MAX_LOOKAHEAD_MINUTES=30;const MERGE_GAP_SECONDS=30;const closures:{start:Date;end:Date;trains:any[]}[]=[];for(const train of trains.filter(t=>t.etaSeconds>0)){const crossingTime=new Date(train.crossingTime);let closeOffset=crossing.closeOffsetSeconds;let openOffset=crossing.openOffsetSeconds;const rule=(crossing as any).rules?.find((rule:any)=>rule.platform===train.platform&&rule.stopping===train.isStoppingTrain);if(rule){closeOffset=rule.closeOffsetSeconds??closeOffset;openOffset=rule.openOffsetSeconds??openOffset;}const closeAt=new Date(crossingTime.getTime()-closeOffset*1000),openAt=new Date(crossingTime.getTime()+openOffset*1000),last=closures[closures.length-1];if(!last||closeAt.getTime()>last.end.getTime()+MERGE_GAP_SECONDS*1000)closures.push({start:closeAt,end:openAt,trains:[train]});else{if(openAt.getTime()>last.end.getTime())last.end=openAt;last.trains.push(train);}}
  const visibleClosures=closures.filter(c=>c.start.getTime()<=Date.now()+MAX_LOOKAHEAD_MINUTES*60*1000);const nextClosure=closures.find(c=>c.end.getTime()>Date.now())||null;let state="OPEN",nextCloseIn=0,nextOpenIn=0;let phaseStart:string|null=null,phaseEnd:string|null=null;if(nextClosure){phaseStart=nextClosure.start.toISOString();phaseEnd=nextClosure.end.toISOString();const nowMs=Date.now();if(nowMs<nextClosure.start.getTime())nextCloseIn=Math.floor((nextClosure.start.getTime()-nowMs)/1000);else{state="CLOSED";nextOpenIn=Math.floor((nextClosure.end.getTime()-nowMs)/1000);}}
  const payload={crossing:{id:crossing.id,name:crossing.name,lat:crossing.lat,lon:crossing.lon},state,nextCloseIn,nextOpenIn,phase:nextClosure?{start:phaseStart,end:phaseEnd,durationMinutes:Math.round((nextClosure.end.getTime()-nextClosure.start.getTime())/60000),trainCount:nextClosure.trains.length,trains:nextClosure.trains}:null,closureCount:visibleClosures.length,closures:visibleClosures.map(c=>({start:c.start.toISOString(),end:c.end.toISOString(),durationMinutes:Math.round((c.end.getTime()-c.start.getTime())/60000),trainCount:c.trains.length,trains:c.trains})),trainCount:trains.length,trains,divertedTrains,lineHints};
  await writeCrossingForecastCache(cacheKey,payload);
  return Response.json(payload,{headers:{"X-Crossing-Status-Cache":"MISS"}});
}
