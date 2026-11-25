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
  alongTrackDistanceMeters: number | null;
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

function projectOnSegment(point:Point,a:Point,b:Point,latitude:number){
  const scale=111320,cos=Math.cos(latitude*Math.PI/180);
  const ax=(a.lon-point.lon)*scale*cos, ay=(a.lat-point.lat)*scale;
  const bx=(b.lon-a.lon)*scale*cos, by=(b.lat-a.lat)*scale;
  const length=Math.hypot(bx,by);
  const t=length ? Math.max(0,Math.min(1,-(ax*bx+ay*by)/(length*length))) : 0;
  return { distance:Math.hypot(ax+bx*t,ay+by*t), along:t*length };
}
function alongTrackDistance(point:Point,crossing:Point,segments:Point[][]){
  let best:{score:number;delta:number}|null=null;
  for(const segment of segments){
    if(segment.length<2) continue;
    let stationAlong=0,crossingAlong=0,walked=0,stationDistance=Infinity,crossingDistance=Infinity;
    for(let i=1;i<segment.length;i++){
      const a=segment[i-1],b=segment[i];
      const length=Math.hypot((b.lon-a.lon)*111320*Math.cos(crossing.lat*Math.PI/180),(b.lat-a.lat)*111320);
      const ps=projectOnSegment(point,a,b,crossing.lat),pc=projectOnSegment(crossing,a,b,crossing.lat);
      if(ps.distance<stationDistance){stationDistance=ps.distance;stationAlong=walked+ps.along;}
      if(pc.distance<crossingDistance){crossingDistance=pc.distance;crossingAlong=walked+pc.along;}
      walked+=length;
    }
    const score=stationDistance+crossingDistance;
    if(!best||score<best.score) best={score,delta:Math.abs(stationAlong-crossingAlong)};
  }
  return best && best.score<5000 ? Math.round(best.delta) : null;
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

async function loadRoute(wayIds:number[]){
  const ids=wayIds.filter((id)=>Number.isFinite(id)&&id>0).slice(0,80);
  if(!ids.length) return [];
  const query=`[out:json][timeout:10];way(id:${ids.map((id)=>Math.trunc(id)).join(",")});out geom;`;
  for(const endpoint of ["https://overpass.private.coffee/api/interpreter","https://ovp.dresel.systems/api/interpreter"]){
    try{
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),12000);
      try{
        const response=await fetch(endpoint,{method:"POST",cache:"no-store",signal:controller.signal,headers:{accept:"application/json","content-type":"application/x-www-form-urlencoded;charset=UTF-8","user-agent":"Crossings/1.0 (meineschranke.com)"},body:new URLSearchParams({data:query}).toString()});
        if(!response.ok) continue;
        const data=await response.json();
        const segments=(data?.elements||[])
          .filter((e:any)=>e?.type==="way"&&Array.isArray(e?.geometry))
          .map((e:any)=>e.geometry.map((p:any)=>({lat:Number(p.lat),lon:Number(p.lon)})).filter((p:Point)=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)))
          .filter((segment:Point[])=>segment.length>=2);
        if(segments.length) return segments;
      }finally{clearTimeout(timeout);}
    }catch{}
  }
  return [];
}


type OsmStation = { id: string; name: string; lat: number; lon: number; uicRef?: string; ril100?: string; railway: string; publicTransport?: string };
async function loadOsmStations(bbox:{south:number;west:number;north:number;east:number}):Promise<OsmStation[]>{
  const box=`${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const query=`[out:json][timeout:15];(node["railway"~"^(station|halt|stop)$"](${box});way["railway"~"^(station|halt)$"](${box});relation["railway"~"^(station|halt)$"](${box});node["public_transport"~"^(station|stop_position)$"](${box});way["public_transport"="station"](${box});relation["public_transport"="station"](${box}););out center tags;`;
  for(const endpoint of ["https://overpass.private.coffee/api/interpreter","https://ovp.dresel.systems/api/interpreter"]){
    try{
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),16000);
      try{
        const response=await fetch(endpoint,{method:"POST",cache:"no-store",signal:controller.signal,headers:{accept:"application/json","content-type":"application/x-www-form-urlencoded;charset=UTF-8","user-agent":"Crossings/1.0 (meineschranke.com)"},body:new URLSearchParams({data:query}).toString()});
        if(!response.ok)continue;
        const data=await response.json();
        return (data?.elements||[]).map((item:any)=>{
          const tags=item.tags||{},lat=Number(item.lat??item.center?.lat),lon=Number(item.lon??item.center?.lon);
          return {id:`osm:${item.type}:${item.id}`,name:String(tags.name||tags["name:de"]||tags.ref||"Unbenannter Halt"),lat,lon,uicRef:String(tags.uic_ref||tags["uic_ref:DB"]||""),ril100:String(tags["railway:ref"]||tags["ref:DB"]||""),railway:String(tags.railway||""),publicTransport:String(tags.public_transport||"")};
        }).filter((s:OsmStation)=>s.name&&Number.isFinite(s.lat)&&Number.isFinite(s.lon));
      }finally{clearTimeout(timeout);}
    }catch{}
  }
  return [];
}
function normalizeStationName(value:string){return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/\b(hbf|bahnhof|haltepunkt|s-bahn)\b/g,"").replace(/[^a-z0-9]+/g," ").trim();}

export async function GET(request:Request){
  const {searchParams}=new URL(request.url);
  const lat=Number(searchParams.get("lat")),lon=Number(searchParams.get("lon")),wayIds=(searchParams.get("wayIds")||String(searchParams.get("wayId")||"")).split(",").map((value)=>Number(value)).filter((value)=>Number.isFinite(value)&&value>0);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||!wayIds.length){
    return NextResponse.json({status:"INVALID_REQUEST",stations:[]},{status:400});
  }
  const segments=await loadRoute(wayIds);
  if(!segments.length) return NextResponse.json({status:"ROUTE_UNAVAILABLE",stations:[]},{status:502});
  const bbox=routeBBox(segments,lat,lon,80);
  try{
    const [result,osmStations]=await Promise.all([
      db.execute({
        sql:`SELECT eva,name,lat,lon,ril100,ibnr
              FROM railway_station_catalog
              WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`,
        args:[bbox.south,bbox.north,bbox.west,bbox.east]
      }),
      loadOsmStations(bbox)
    ]);
    const catalog=(result.rows as any[]).map(row=>({
      eva:String(row.eva||""),stationName:String(row.name||row.eva||""),
      ril100:String(row.ril100||""),ibnr:String(row.ibnr||""),
      lat:Number(row.lat),lon:Number(row.lon)
    })).filter(s=>s.eva&&Number.isFinite(s.lat)&&Number.isFinite(s.lon));
    const osmCandidates=osmStations.map(osm=>{
      const direct=catalog.find(dbStation=>(osm.uicRef&&(osm.uicRef===dbStation.ibnr||osm.uicRef===dbStation.eva))||(osm.ril100&&osm.ril100===dbStation.ril100));
      const named=catalog.filter(dbStation=>normalizeStationName(dbStation.stationName)===normalizeStationName(osm.name))
        .sort((x,y)=>distanceKm(osm.lat,osm.lon,x.lat,x.lon)-distanceKm(osm.lat,osm.lon,y.lat,y.lon))[0];
      const matched=direct||((named&&distanceKm(osm.lat,osm.lon,named.lat,named.lon)<=1.0)?named:null);\n      // German UIC/IBNR station numbers (800xxxx) are also the EVA identifiers used by DB timetable APIs.\n      const osmEva=!matched&&/^8\\d{6}$/.test(osm.uicRef||"")?osm.uicRef:"";
      const stationLat=matched?.lat??osm.lat,stationLon=matched?.lon??osm.lon;
      const trackDistanceMeters=geometryDistanceMeters({lat:stationLat,lon:stationLon},segments);
      const along=alongTrackDistance({lat:stationLat,lon:stationLon},{lat,lon},segments);
      const distance=distanceKm(lat,lon,stationLat,stationLon);
      const isStopPosition=osm.publicTransport==="stop_position"||osm.railway==="stop";
      return {
        id:osm.id,eva:matched?.eva||osmEva,stationName:osm.name,
        ril100:matched?.ril100||osm.ril100||undefined,ibnr:matched?.ibnr||osm.uicRef||undefined,
        lat:stationLat,lon:stationLon,distanceKm:distance,trackDistanceMeters,
        alongTrackDistanceMeters:along,source:matched?"db+osm":"osm",
        selectable:Boolean(matched),osmRailway:osm.railway,osmPublicTransport:osm.publicTransport,
        maxTrackDistanceMeters:isStopPosition?600:2500
      };
    }).filter(s=>s.distanceKm<=80&&s.trackDistanceMeters<=s.maxTrackDistanceMeters&&s.alongTrackDistanceMeters!=null);
    const catalogOnly=catalog.map(station=>{
      const stationLat=station.lat,stationLon=station.lon;
      return {id:`db:${station.eva}`,eva:station.eva,stationName:station.stationName,ril100:station.ril100||undefined,ibnr:station.ibnr||undefined,lat:stationLat,lon:stationLon,distanceKm:distanceKm(lat,lon,stationLat,stationLon),trackDistanceMeters:geometryDistanceMeters({lat:stationLat,lon:stationLon},segments),alongTrackDistanceMeters:alongTrackDistance({lat:stationLat,lon:stationLon},{lat,lon},segments),source:"db",selectable:true};
    }).filter(s=>s.distanceKm<=80&&s.trackDistanceMeters<=2500&&s.alongTrackDistanceMeters!=null);
    const byEva=new Map<string,any>();
    for(const station of [...catalogOnly,...osmCandidates])if(station.eva){
      const previous=byEva.get(station.eva);
      if(!previous||station.source==="db+osm")byEva.set(station.eva,station);
    }
    const unmatchedOsm=osmCandidates.filter(s=>!s.eva);
    const stations=[...byEva.values(),...unmatchedOsm].sort((x,y)=>x.distanceKm-y.distanceKm).slice(0,40);
    return NextResponse.json({status:"OK",stations,counts:{db:catalogOnly.length,osm:osmCandidates.length,unmatchedOsm:unmatchedOsm.length}});
  }catch(error){
    return NextResponse.json({status:"DB_ERROR",error:error instanceof Error?error.message:String(error),stations:[]},{status:500});
  }
}
