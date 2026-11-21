import { NextResponse } from "next/server";
import { db } from "../../../../lib/db";

type Point = { lat: number; lon: number };
type StationCandidate = {
  eva: string;
  stationName: string;
  ril100?: string;
  ibnr?: string;
  lat: number;
  lon: number;
  distanceKm: number;
  trackDistanceMeters: number;
};

function pointSegmentDistanceMeters(lat:number,lon:number,a:Point,b:Point){
  const scale=111320;
  const x=(lon-a.lon)*scale*Math.cos(lat*Math.PI/180),y=(lat-a.lat)*scale;
  const bx=(b.lon-a.lon)*scale*Math.cos(lat*Math.PI/180),by=(b.lat-a.lat)*scale;
  const denom=bx*bx+by*by;
  let t=denom?(x*bx+y*by)/denom:0;
  t=Math.max(0,Math.min(1,t));
  return Math.hypot(x-bx*t,y-by*t);
}
function geometryDistanceMeters(point:Point,segments:Point[][]){
  let best=Infinity;
  for(const segment of segments) for(let i=1;i<segment.length;i++) best=Math.min(best,pointSegmentDistanceMeters(point.lat,point.lon,segment[i-1],segment[i]));
  return best;
}
function distanceKm(lat1:number,lon1:number,lat2:number,lon2:number){
  const r=6371,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return r*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function routeBBox(segments:Point[][],lat:number,lon:number,radiusKm:number){
  const points=segments.flat(),all=points.length?points:[{lat,lon}];
  const lats=all.map(p=>p.lat),lons=all.map(p=>p.lon);
  const padLat=radiusKm/111,padLon=radiusKm/(111*Math.max(Math.cos(lat*Math.PI/180),.1));
  return {
    south:Math.max(-90,Math.min(...lats)-padLat),
    west:Math.max(-180,Math.min(...lons)-padLon),
    north:Math.min(90,Math.max(...lats)+padLat),
    east:Math.min(180,Math.max(...lons)+padLon)
  };
}

async function loadRoute(relationId:number){
  const query=`[out:json][timeout:12];rel(${Math.trunc(relationId)});way(r);out geom;`;
  for(const endpoint of ["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter"]){
    try{
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),13000);
      try{
        const response=await fetch(`${endpoint}?${new URLSearchParams({data:query})}`,{
          cache:"no-store",signal:controller.signal,
          headers:{accept:"application/json","user-agent":"Crossings/1.0 (meineschranke.com)"}
        });
        if(!response.ok) continue;
        const data=await response.json();
        const segments=(data?.elements||[])
          .filter((e:any)=>e?.type==="way"&&Array.isArray(e?.geometry))
          .map((e:any)=>e.geometry.map((p:any)=>({lat:Number(p.lat),lon:Number(p.lon)})).filter((p:Point)=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)))
          .filter((s:Point[])=>s.length>=2);
        if(segments.length) return segments;
      }finally{clearTimeout(timeout);}
    }catch{}
  }
  return [];
}

export async function GET(request:Request){
  const {searchParams}=new URL(request.url);
  const lat=Number(searchParams.get("lat")),lon=Number(searchParams.get("lon")),relationId=Number(searchParams.get("relationId"));
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(relationId)||relationId<=0){
    return NextResponse.json({status:"INVALID_REQUEST",stations:[]},{status:400});
  }
  const segments=await loadRoute(relationId);
  if(!segments.length) return NextResponse.json({status:"ROUTE_UNAVAILABLE",stations:[]},{status:502});
  const bbox=routeBBox(segments,lat,lon,80);
  try{
    const result=await db.execute({
      sql:`SELECT eva,name,lat,lon,ril100,ibnr
            FROM railway_station_catalog
            WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`,
      args:[bbox.south,bbox.north,bbox.west,bbox.east]
    });
    const stations=(result.rows as any[])
      .map(row=>{
        const stationLat=Number(row.lat),stationLon=Number(row.lon);
        return {
          eva:String(row.eva||""),
          stationName:String(row.name||row.eva||""),
          ril100:row.ril100?String(row.ril100):undefined,
          ibnr:row.ibnr?String(row.ibnr):undefined,
          lat:stationLat,lon:stationLon,
          distanceKm:distanceKm(lat,lon,stationLat,stationLon),
          trackDistanceMeters:geometryDistanceMeters({lat:stationLat,lon:stationLon},segments)
        } as StationCandidate;
      })
      .filter(s=>s.eva&&Number.isFinite(s.lat)&&Number.isFinite(s.lon)&&s.distanceKm<=80&&s.trackDistanceMeters<=2500)
      .sort((a,b)=>a.distanceKm-b.distanceKm)
      .slice(0,20);
    return NextResponse.json({status:"OK",stations});
  }catch(error){
    return NextResponse.json({status:"DB_ERROR",error:error instanceof Error?error.message:String(error),stations:[]},{status:500});
  }
}
