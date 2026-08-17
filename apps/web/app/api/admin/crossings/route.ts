import { randomUUID } from "crypto";
import { db } from "../../../lib/db";

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCoordinates(value: string) {
  const match = value.replace(/,/g, " ").match(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

async function loadCrossings() {
  const result = await db.execute(`SELECT id,name,eva,lat,lon,confidence,status,source,observation_evas,required_route_stops,close_offset_seconds,open_offset_seconds,created_at,updated_at FROM crossings ORDER BY name COLLATE NOCASE`);
  return result.rows;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const coordinateInput = searchParams.get("coordinates");
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const rows = await loadCrossings();

  if (coordinateInput || (Number.isFinite(lat) && Number.isFinite(lon))) {
    const coords = coordinateInput ? parseCoordinates(coordinateInput) : { lat, lon };
    if (!coords) return Response.json({ error: "Ungültige Koordinaten" }, { status: 400 });
    const nearest = rows.map((row) => ({ ...row, distanceKm: distanceKm(coords.lat, coords.lon, Number(row.lat), Number(row.lon)) })).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 5);
    return Response.json({ input: coords, nearest });
  }

  const withStations = await Promise.all(rows.map(async (row) => {
    const stations = await db.execute({ sql: `SELECT id,eva,station_name,role,categories,direction,fallback_offset_seconds,track_distance_meters,sort_order FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order`, args: [row.id] });
    return { ...row, stations: stations.rows };
  }));
  return Response.json(withStations);
}

export async function POST(request: Request) {
  const body = await request.json();
  const id = String(body.id || body.name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const name = String(body.name || "").trim();
  const eva = String(body.eva || "").trim();
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!id || !name || !eva || !Number.isFinite(lat) || !Number.isFinite(lon)) return Response.json({ error: "Name, EVA, Breite und Länge sind erforderlich." }, { status: 400 });

  const stations = Array.isArray(body.stations) ? body.stations : [];
  const observationEvas = stations.map((s: any) => String(s.eva || "").trim()).filter(Boolean);
  if (!observationEvas.includes(eva)) observationEvas.unshift(eva);
  const routeStops = Array.isArray(body.requiredRouteStops) ? body.requiredRouteStops : [];
  const rules = Array.isArray(body.rules) ? body.rules : [];

  await db.execute({
    sql: `INSERT INTO crossings (id,name,eva,observation_evas,required_route_stops,lat,lon,close_offset_seconds,open_offset_seconds,rules,through_rules,diversion_rules,reroute_watch_rules,confidence,source,status) VALUES (?,?,?,?,?,?,?,?,?,?,'[]','[]','[]',?,'manual','active')`,
    args: [id,name,eva,JSON.stringify(observationEvas),JSON.stringify(routeStops),lat,lon,Number(body.closeOffsetSeconds ?? 80),Number(body.openOffsetSeconds ?? 20),JSON.stringify(rules),Number(body.confidence ?? 0.5)],
  });

  for (let i = 0; i < stations.length; i++) {
    const station = stations[i];
    const stationEva = String(station.eva || "").trim();
    if (!stationEva) continue;
    await db.execute({ sql: `INSERT OR IGNORE INTO railway_stations (eva,name) VALUES (?,?)`, args: [stationEva,String(station.stationName || station.name || stationEva)] });
    await db.execute({ sql: `INSERT OR REPLACE INTO crossing_station_links (id,crossing_id,eva,station_name,role,categories,direction,fallback_offset_seconds,track_distance_meters,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`, args: [randomUUID(),id,stationEva,String(station.stationName || station.name || stationEva),station.role || (stationEva === eva ? "primary" : "observation"),JSON.stringify(station.categories || []),station.direction || "unknown",Number(station.fallbackOffsetSeconds || 0),Number(station.trackDistanceMeters || 0),i] });
  }
  return Response.json({ id, ok: true }, { status: 201 });
}
