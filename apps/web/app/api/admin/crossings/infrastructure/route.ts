import { NextResponse } from "next/server";

type Point={lat:number;lon:number};
function pointSegmentDistanceMeters(lat:number,lon:number,a:Point,b:Point){const scale=111320;const x=(lon-a.lon)*scale*Math.cos(lat*Math.PI/180);const y=(lat-a.lat)*scale;const bx=(b.lon-a.lon)*scale*Math.cos(lat*Math.PI/180);const by=(b.lat-a.lat)*scale;const denom=bx*bx+by*by;let t=denom?((x*bx)+(y*by))/denom:0;t=Math.max(0,Math.min(1,t));return Math.hypot(x-bx*t,y-by*t);}
function geometryDistanceMeters(lat:number,lon:number,geometry:Point[]){let best=Infinity;for(let i=1;i<geometry.length;i++)best=Math.min(best,pointSegmentDistanceMeters(lat,lon,geometry[i-1],geometry[i]));return best;}
function parseOsmMap(xml:string,lat:number,lon:number){
  const nodes=new Map<string,Point>();
  for(const m of xml.matchAll(/<node\b[^>]*\bid="(\d+)"[^>]*\blat="([+-]?[\d.]+)"[^>]*\blon="([+-]?[\d.]+)"[^>]*\/>/g))nodes.set(m[1],{lat:Number(m[2]),lon:Number(m[3])});
  const candidates:any[]=[];
  for(const wm of xml.matchAll(/<way\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)){
    const body=wm[2];const tags:any={};for(const tm of body.matchAll(/<tag\b[^>]*\bk="([^"]+)"[^>]*\bv="([^"]*)"[^>]*\/>/g))tags[tm[1]]=tm[2];if(tags.railway!=="rail")continue;
    const geometry:Point[]=[];for(const nm of body.matchAll(/<nd\b[^>]*\bref="(\d+)"[^>]*\/>/g)){const p=nodes.get(nm[1]);if(p)geometry.push(p);}if(geometry.length<2)continue;
    const distanceMeters=geometryDistanceMeters(lat,lon,geometry);if(!Number.isFinite(distanceMeters)||distanceMeters>200)continue;
    candidates.push({kind:"track",routeType:"track",ref:String(tags.ref||""),name:String(tags.name||""),from:String(tags.from||""),to:String(tags.to||""),distanceMeters:Math.round(distanceMeters),wayId:Number(wm[1]),relationId:null,source:"openstreetmap-map-api"});
  }
  const dedup=new Map<string,any>();for(const c of candidates){const key=`${c.ref||"way"}:${c.name}:${c.wayId}`;dedup.set(key,c);}return [...dedup.values()].sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,12);
}

async function tryOverpass(lat:number,lon:number){
  const query=`[out:json][timeout:12];way(around:200,${lat},${lon})[railway=rail];out geom tags;`;
  const endpoints=["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter","https://overpass.private.coffee/api/interpreter"];
  let lastError="";
  for(const endpoint of endpoints){try{const response=await fetch(`${endpoint}?${new URLSearchParams({data:query}).toString()}`,{cache:"no-store",headers:{accept:"application/json",user-agent:"Crossings/1.0 (meineschranke.com)"}});if(!response.ok){const body=await response.text().catch(()=>"");lastError=`${endpoint} HTTP_${response.status}${body?` ${body.slice(0,180)}`:""}`;continue;}const data=await response.json();const ways=(Array.isArray(data?.elements)?data.elements:[]).filter((e:any)=>e.type==="way"&&Array.isArray(e.geometry));const candidates=ways.map((way:any)=>{const geometry=way.geometry.map((p:any)=>({lat:Number(p.lat),lon:Number(p.lon)}));const distanceMeters=geometryDistanceMeters(lat,lon,geometry);return{kind:"track",routeType:"track",ref:String(way.tags?.ref||""),name:String(way.tags?.name||""),from:String(way.tags?.from||""),to:String(way.tags?.to||""),distanceMeters:Math.round(distanceMeters),wayId:Number(way.id),relationId:null,source:"openstreetmap"};}).filter((c:any)=>Number.isFinite(c.distanceMeters)&&c.distanceMeters<=200).sort((a:any,b:any)=>a.distanceMeters-b.distanceMeters).slice(0,12);return{status:"OK",candidates,endpoint,wayCount:ways.length};}catch(error){lastError=error instanceof Error?error.message:String(error);}}
  return{status:"OVERPASS_ERROR",error:lastError,candidates:[]};
}

export async function GET(request:Request){
  const {searchParams}=new URL(request.url);const lat=Number(searchParams.get("lat")),lon=Number(searchParams.get("lon"));
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return NextResponse.json({status:"INVALID_COORDINATES",candidates:[]},{status:400});
  const overpass=await tryOverpass(lat,lon);if(overpass.status==="OK")return NextResponse.json(overpass);
  try{const delta=0.0022;const bbox=`${lon-delta},${lat-delta},${lon+delta},${lat+delta}`;const response=await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`,{cache:"no-store",headers:{accept:"application/xml",user-agent:"Crossings/1.0 (meineschranke.com)"}});if(response.ok){const xml=await response.text();const candidates=parseOsmMap(xml,lat,lon);return NextResponse.json({status:"OK",candidates,endpoint:"openstreetmap-map-api",fallbackFrom:overpass.error||"OVERPASS_ERROR",wayCount:candidates.length});}}catch(error){return NextResponse.json({status:"OSM_ERROR",error:error instanceof Error?error.message:String(error),overpassError:overpass.error,candidates:[]});}
  return NextResponse.json({status:"OSM_ERROR",error:"OpenStreetMap infrastructure lookup failed",overpassError:overpass.error,candidates:[]});
}
