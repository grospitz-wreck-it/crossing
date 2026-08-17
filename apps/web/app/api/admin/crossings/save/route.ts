import { randomUUID } from "crypto";
import { db } from "../../../../lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const routeRef = String(body.routeRef || body.selectedRouteRef || "").trim();
    const routeName = String(body.routeName || body.selectedRouteName || "").trim();
    const suppliedName = String(body.name || "").trim();
    const name = suppliedName || ["Bahnübergang", routeRef ? `Strecke ${routeRef}` : routeName].filter(Boolean).join(" ");
    const id = `crossing-${randomUUID()}`;
    const eva = String(body.eva || "").trim();
    const lat = Number(body.lat), lon = Number(body.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Response.json({ error: "Standortkoordinaten fehlen. Bitte zuerst den Plus Code prüfen." }, { status: 400 });

    const stations = Array.isArray(body.stations) ? body.stations : [];
    const observationEvas = stations.map((s: any) => String(s.eva || "").trim()).filter(Boolean);
    if (eva && !observationEvas.includes(eva)) observationEvas.unshift(eva);
    const routeStops = Array.isArray(body.requiredRouteStops) ? body.requiredRouteStops.map((v: any) => String(v).trim()).filter(Boolean) : routeRef ? [routeRef] : [];

    await db.execute({
      sql: `INSERT INTO crossings (id,name,eva,observation_evas,required_route_stops,lat,lon,close_offset_seconds,open_offset_seconds,rules,through_rules,diversion_rules,reroute_watch_rules,confidence,source,status) VALUES (?,?,?,?,?,?,?,?,?,?,'[]','[]','[]',?,'manual','active')`,
      args: [id, name, eva, JSON.stringify(observationEvas), JSON.stringify(routeStops), lat, lon, Number(body.closeOffsetSeconds ?? 80), Number(body.openOffsetSeconds ?? 20), JSON.stringify(body.rules || []), Number(body.confidence ?? 0.5)],
    });

    for (let i = 0; i < stations.length; i++) {
      const station = stations[i];
      const stationEva = String(station.eva || "").trim();
      if (!stationEva) continue;
      await db.execute({ sql: `INSERT OR IGNORE INTO railway_stations (eva,name) VALUES (?,?)`, args: [stationEva, String(station.stationName || station.name || stationEva)] });
      await db.execute({
        sql: `INSERT OR REPLACE INTO crossing_station_links (id,crossing_id,eva,station_name,role,categories,direction,fallback_offset_seconds,track_distance_meters,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        args: [randomUUID(), id, stationEva, String(station.stationName || station.name || stationEva), station.role || (stationEva === eva ? "primary" : "observation"), JSON.stringify(station.categories || []), station.direction || "unknown", Number(station.fallbackOffsetSeconds || 0), Number(station.trackDistanceMeters || 0), i],
      });
    }

    return Response.json({ id, ok: true }, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/crossings/save failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
