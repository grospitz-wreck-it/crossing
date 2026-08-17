import { NextResponse } from "next/server";

function pointSegmentDistanceMeters(lat:number,lon:number,a:{lat:number;lon:number},b:{lat:number;lon:number}){const scale=111320;const x=(lon-a.lon)*scale*Math.cos(lat*Math.PI/180);const y=(lat-a.lat)*scale;const bx=(b.lon-a.lon)*scale*Math.cos(lat*Math.PI/180);const by=(b.lat-a.lat)*scale;const denom=bx*bx+by*by;let t=denom?((x*bx)+(y*by))/denom:0;t=Math.max(0,Math.min(1,t));const dx=x-bx*t,dy=y-by*t;return Math.sqrt(dx*dx+dy*dy);}
function geometryDistanceMeters(lat:number,lon:number,geometry:any[]){let best=Infinity;for(let i=1;i<geometry.length;i++){const a=geometry[i-1],b=geometry[i];if(Number.isFinite(a?.lat)&&Number.isFinite(a?.lon)&&Number.isFinite(b?.lat)&&Number.isFinite(b?.lon))best=Math.min(best,pointSegmentDistanceMeters(lat,lon,a,b));}return best;}

export async function GET(request:Request){
  const {searchParams}=new URL(request.url);const lat=Number(searchParams.get("lat")),lon=Number(searchParams.get("lon"));
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return NextResponse.json({status:"INVALID_COORDINATES",candidates:[]},{status:400});
  const query=`[out:json][timeout:20];way(around:150,${lat},${lon})[railway=rail];out geom;rel(bw);out tags;`;
  const endpoints=["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter","https://overpass.private.coffee/api/interpreter"];
  let lastError="";
  for(const endpoint of endpoints){
    try{
      const response=await fetch(`${endpoint}?${new URLSearchParams({data:query}).toString()}`,{cache:"no-store",headers:{accept:"application/json"}});
      if(!response.ok){lastError=`HTTP_${response.status}`;continue;}
      const data=await response.json();const elements=Array.isArray(data?.elements)?data.elements:[];
      const ways=elements.filter((e:any)=>e.type==="way"&&Array.isArray(e.geometry));const relations=elements.filter((e:any)=>e.type==="relation");
      const relationByWay=new Map<number,any[]>();
      for(const rel of relations){const route=String(rel.tags?.route||"");if(rel.tags?.type!=="route"||(route!=="tracks"&&route!=="railway"))continue;for(const member of rel.members||[]){if(member.type!=="way")continue;const list=relationByWay.get(Number(member.ref))||[];list.push({routeType:route,ref:String(rel.tags?.ref||""),name:String(rel.tags?.name||""),from:String(rel.tags?.from||""),to:String(rel.tags?.to||""),relationId:Number(rel.id)});relationByWay.set(Number(member.ref),list);}}
      const candidates:any[]=[];
      for(const way of ways){const distanceMeters=geometryDistanceMeters(lat,lon,way.geometry);if(!Number.isFinite(distanceMeters)||distanceMeters>150)continue;const rels=relationByWay.get(Number(way.id))||[];if(rels.length){for(const rel of rels)candidates.push({kind:"route",routeType:rel.routeType,ref:rel.ref||String(way.tags?.ref||""),name:rel.name||String(way.tags?.name||""),from:rel.from,to:rel.to,distanceMeters:Math.round(distanceMeters),wayId:Number(way.id),relationId:rel.relationId,source:"openstreetmap"});}else candidates.push({kind:"track",routeType:"track",ref:String(way.tags?.ref||""),name:String(way.tags?.name||""),from:"",to:"",distanceMeters:Math.round(distanceMeters),wayId:Number(way.id),relationId:null,source:"openstreetmap"});}
      const dedup=new Map<string,any>();for(const candidate of candidates){const key=`${candidate.routeType}:${candidate.ref||"way"}:${candidate.relationId||candidate.wayId}`;if(!dedup.has(key)||candidate.distanceMeters<dedup.get(key).distanceMeters)dedup.set(key,candidate);}
      const sorted=[...dedup.values()].sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,12);
      return NextResponse.json({status:"OK",candidates:sorted,endpoint});
    }catch(error){lastError=error instanceof Error?error.message:String(error);}
  }
  return NextResponse.json({status:"OVERPASS_ERROR",error:lastError,candidates:[]});
}
