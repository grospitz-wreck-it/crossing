import { NextResponse } from "next/server";

export const maxDuration = 25;

type Point = { lat: number; lon: number };
type LineRelation = { id: number; routeType: string; ref: string; name: string; from: string; to: string; network?: string; operator?: string };
type Candidate = { kind: "track"; routeType: "track" | "tram" | "light_rail"; infrastructureType: "rail" | "tram" | "light_rail"; ref: string; name: string; from: string; to: string; distanceMeters: number; wayId: number; relationId: number | null; lineRelations: LineRelation[]; source: string; waysCount: 1; segments: Point[][] };

const INFRASTRUCTURE_TYPES = new Set(["rail", "tram", "light_rail"]);
const ROUTE_RELATION_TYPES = new Set(["train", "tram", "light_rail", "railway", "tracks"]);
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

function pointSegmentDistanceMeters(lat: number, lon: number, a: Point, b: Point) {
  const scale = 111320, x = (lon-a.lon)*scale*Math.cos(lat*Math.PI/180), y=(lat-a.lat)*scale;
  const bx=(b.lon-a.lon)*scale*Math.cos(lat*Math.PI/180), by=(b.lat-a.lat)*scale, denom=bx*bx+by*by;
  let t=denom?(x*bx+y*by)/denom:0; t=Math.max(0,Math.min(1,t));
  return Math.hypot(x-bx*t,y-by*t);
}
function geometryDistanceMeters(lat:number,lon:number,geometry:Point[]) {
  let best=Infinity; for(let i=1;i<geometry.length;i++) best=Math.min(best,pointSegmentDistanceMeters(lat,lon,geometry[i-1],geometry[i])); return best;
}
async function queryOverpass(endpoint:string,query:string,timeoutMs:number) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetch(`${endpoint}?${new URLSearchParams({data:query})}`,{cache:"no-store",signal:controller.signal,headers:{accept:"application/json","user-agent":"Crossings/1.0 (meineschranke.com)"}});
    if(!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}
async function fetchWays(lat:number,lon:number) {
  // First request only the physical track geometries. Route-relation lookups are
  // deliberately separate and optional: a slow relation endpoint must not hide the tracks.
  const query=`[out:json][timeout:14];way(around:250,${lat},${lon})[railway~"^(rail|tram|light_rail)$"];out tags geom;`;
  const results=await Promise.allSettled(ENDPOINTS.map(endpoint=>queryOverpass(endpoint,query,16000)));
  const success=results.find((result):result is PromiseFulfilledResult<any>=>result.status==="fulfilled");
  if(success) return {elements:Array.isArray(success.value?.elements)?success.value.elements:[],errors:results.filter((r):r is PromiseRejectedResult=>r.status==="rejected").map(r=>String(r.reason?.message||r.reason))};
  throw new Error(results.map(r=>r.status==="rejected"?String(r.reason?.message||r.reason):"").filter(Boolean).join("; ") || "Keine Overpass-Antwort");
}
async function fetchRelations(wayIds:number[]) {
  if(!wayIds.length) return {relations:[] as any[],errors:[] as string[]};
  const ids=wayIds.slice(0,80).join(",");
  const query=`[out:json][timeout:5];way(id:${ids})->.localWays;rel(bw.localWays)[type=route][route~"^(train|tram|light_rail|railway|tracks)$"];out body;`;
  const results=await Promise.allSettled(ENDPOINTS.map(endpoint=>queryOverpass(endpoint,query,6500)));
  const success=results.find((result):result is PromiseFulfilledResult<any>=>result.status==="fulfilled");
  if(success) return {relations:(success.value?.elements||[]).filter((e:any)=>e?.type==="relation"),errors:results.filter((r):r is PromiseRejectedResult=>r.status==="rejected").map(r=>String(r.reason?.message||r.reason))};
  return {relations:[] as any[],errors:results.map(r=>r.status==="rejected"?String(r.reason?.message||r.reason):"").filter(Boolean)};
}
export async function GET(request:Request) {
  const params=new URL(request.url).searchParams,lat=Number(params.get("lat")),lon=Number(params.get("lon"));
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)
    return NextResponse.json({status:"INVALID_COORDINATES",candidates:[]},{status:400});
  try {
    const {elements,errors:wayErrors}=await fetchWays(lat,lon);
    const ways=elements.filter((e:any)=>e?.type==="way"&&Array.isArray(e.geometry)&&INFRASTRUCTURE_TYPES.has(String(e.tags?.railway||"")));
    const candidates:Candidate[]=ways.map((way:any)=>{
      const geometry:Point[]=way.geometry.map((p:any)=>({lat:Number(p.lat),lon:Number(p.lon)})).filter((p:Point)=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
      if(geometry.length<2) return null;
      const distanceMeters=geometryDistanceMeters(lat,lon,geometry);
      if(!Number.isFinite(distanceMeters)||distanceMeters>250) return null;
      const infrastructureType=String(way.tags?.railway)==="tram"?"tram":String(way.tags?.railway)==="light_rail"?"light_rail":"rail";
      return {kind:"track",routeType:infrastructureType==="rail"?"track":infrastructureType,infrastructureType,ref:String(way.tags?.ref||""),name:String(way.tags?.name||""),from:String(way.tags?.from||""),to:String(way.tags?.to||""),distanceMeters:Math.round(distanceMeters),wayId:Number(way.id),relationId:null,lineRelations:[],source:"openstreetmap",waysCount:1,segments:[geometry]} as Candidate;
    }).filter((c:Candidate|null):c is Candidate=>Boolean(c)).sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,80);
    const {relations,errors:relationErrors}=await fetchRelations(candidates.map(c=>c.wayId));
    const relationsByWay=new Map<number,LineRelation[]>();
    for(const relation of relations) {
      const routeType=String(relation.tags?.route||"");
      if(relation.tags?.type!=="route"||!ROUTE_RELATION_TYPES.has(routeType)) continue;
      const info:LineRelation={id:Number(relation.id),routeType,ref:String(relation.tags?.ref||""),name:String(relation.tags?.name||""),from:String(relation.tags?.from||""),to:String(relation.tags?.to||""),network:relation.tags?.network?String(relation.tags.network):undefined,operator:relation.tags?.operator?String(relation.tags.operator):undefined};
      for(const member of relation.members||[]) if(member.type==="way") {
        const id=Number(member.ref); if(!candidates.some(c=>c.wayId===id)) continue;
        const list=relationsByWay.get(id)||[]; list.push(info); relationsByWay.set(id,list);
      }
    }
    for(const candidate of candidates) {
      candidate.lineRelations=relationsByWay.get(candidate.wayId)||[];
      const first=candidate.lineRelations[0];
      if(first) { candidate.relationId=first.id; candidate.ref=candidate.ref||first.ref; candidate.name=candidate.name||first.name; candidate.from=candidate.from||first.from; candidate.to=candidate.to||first.to; }
    }
    return NextResponse.json({status:"OK",candidates,wayCount:ways.length,relationCount:relations.length,relationsStatus:relationErrors.length?"PARTIAL":"OK",warnings:[...wayErrors,...relationErrors]});
  } catch(error) {
    return NextResponse.json({status:"OSM_ERROR",error:`OSM-Gleise konnten nicht geladen werden. Bitte erneut versuchen. (${error instanceof Error?error.message:String(error)})`,candidates:[],warnings:[]},{status:503});
  }
}
